//! Tauri commands: agent proxy and sidecar lifecycle.

use std::time::Duration;

pub const AGENT_PORT: u16 = 12345;
pub const AGENT_PORT_STR: &str = "12345";

/// Read the shared agent auth token written by the agent to
/// `~/.idento/agent_config.json` (key `auth_token`).
fn read_agent_token() -> Option<String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()?;
    let path = format!("{}/.idento/agent_config.json", home);
    let data = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&data).ok()?;
    v.get("auth_token")?.as_str().map(|s| s.to_string())
}

/// Build a safe URL for a request to the local agent, given a caller-supplied
/// `path` (fully controlled by WebView JS via `invoke("agent_request", ...)`).
///
/// Naively concatenating `format!("http://127.0.0.1:{}{}", port, path)` is
/// unsafe: a `path` like `"@evil.example.com/x"` produces
/// `"http://127.0.0.1:12345@evil.example.com/x"`, which URL parsers treat as
/// userinfo `127.0.0.1:12345` + host `evil.example.com`. That would send the
/// agent's Bearer token (and the request itself) to an attacker-controlled
/// host -- a token-leaking SSRF from the native process. To prevent this we
/// (1) restrict `path` to a strict, host-injection-proof charset, and (2)
/// re-verify the fully-parsed URL still targets `127.0.0.1:<AGENT_PORT>`
/// with no userinfo before it is ever used.
///
/// None of the current agent endpoints require query strings (all dynamic
/// values -- printer/scanner names, IPs, ports -- travel in the JSON body,
/// never in `path`), so the allowed charset is deliberately path-only:
/// `^/[A-Za-z0-9/_\-]*$`. `@`, `\`, `:`, whitespace, `.` and repeated `/`
/// (`//`) are all rejected.
fn build_agent_url(path: &str) -> Result<reqwest::Url, String> {
    if !path.starts_with('/') {
        return Err(format!("Invalid agent path (must start with '/'): {}", path));
    }
    if path.contains("//") {
        return Err(format!("Invalid agent path (contains '//'): {}", path));
    }
    let is_safe_charset = path
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'_' | b'-'));
    if !is_safe_charset {
        return Err(format!("Invalid agent path (disallowed characters): {}", path));
    }

    let base = reqwest::Url::parse(&format!("http://127.0.0.1:{}/", AGENT_PORT))
        .map_err(|e| e.to_string())?;
    let url = base
        .join(path.trim_start_matches('/'))
        .map_err(|e| e.to_string())?;

    // Defense in depth: re-verify the fully-parsed URL still points where we
    // expect, even after the charset check above.
    let points_at_agent = url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port() == Some(AGENT_PORT)
        && url.username().is_empty()
        && url.password().is_none();
    if !points_at_agent {
        return Err(format!(
            "Invalid agent path (resolved to unexpected URL): {}",
            path
        ));
    }

    Ok(url)
}

/// Proxy a request to the local agent (avoids CORS from WebView).
/// Body: { "method": "GET"|"POST", "path": "/health", "body": optional_string }
#[tauri::command]
pub async fn agent_request(
    method: String,
    path: String,
    body: Option<String>,
) -> Result<String, String> {
    let url = build_agent_url(&path)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let token = read_agent_token();

    let response = match method.to_uppercase().as_str() {
        "GET" => {
            let mut req = client.get(url);
            if let Some(ref t) = token {
                req = req.header("Authorization", format!("Bearer {}", t));
            }
            req.send().await
        }
        "POST" => {
            // The agent requires Content-Type: application/json on every mutating
            // request, so set it unconditionally (even for body-less POSTs).
            let mut req = client
                .post(url)
                .header("Content-Type", "application/json");
            if let Some(ref t) = token {
                req = req.header("Authorization", format!("Bearer {}", t));
            }
            if let Some(ref b) = body {
                req = req.body(b.clone());
            }
            req.send().await
        }
        _ => return Err(format!("Unsupported method: {}", method)),
    }
    .map_err(|e| e.to_string())?;

    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Agent error {}: {}", status, text));
    }
    Ok(text)
}

#[tauri::command]
pub fn get_agent_port() -> u16 {
    AGENT_PORT
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Assert the URL is a same-origin request to the local agent: plain
    /// `http`, host `127.0.0.1`, exactly `AGENT_PORT`, and no userinfo.
    fn assert_points_at_agent(url: &reqwest::Url) {
        assert_eq!(url.scheme(), "http");
        assert_eq!(url.host_str(), Some("127.0.0.1"));
        assert_eq!(url.port(), Some(AGENT_PORT));
        assert!(url.username().is_empty());
        assert!(url.password().is_none());
    }

    #[test]
    fn accepts_known_agent_paths() {
        let paths = [
            "/health",
            "/printers",
            "/printers/default",
            "/printers/add",
            "/printers/remove",
            "/print",
            "/scanners",
            "/scanners/add",
            "/scanners/ports",
            "/scan/last",
            "/scan/clear",
            // Hyphenated/underscored & nested segments, e.g. a
            // "/printers/{name}/fonts"-style path.
            "/printers/COM3/fonts",
            "/printers/my-printer_1/fonts",
        ];
        for path in paths {
            let url = build_agent_url(path)
                .unwrap_or_else(|e| panic!("expected {:?} to be accepted, got: {}", path, e));
            assert_points_at_agent(&url);
            assert_eq!(url.path(), path, "path round-tripped for {:?}", path);
        }
    }

    #[test]
    fn rejects_userinfo_host_injection() {
        // The original bug: naive concatenation of
        // "http://127.0.0.1:12345" + "@evil.example.com/x" produces a URL
        // whose host is evil.example.com and whose userinfo is
        // 127.0.0.1:12345.
        assert!(build_agent_url("@evil.example.com/x").is_err());
    }

    #[test]
    fn rejects_protocol_relative_double_slash() {
        assert!(build_agent_url("//evil.example.com").is_err());
    }

    #[test]
    fn rejects_embedded_scheme() {
        assert!(build_agent_url("http://evil").is_err());
    }

    #[test]
    fn rejects_at_sign_mid_path() {
        assert!(build_agent_url("/x@y").is_err());
    }

    #[test]
    fn rejects_path_traversal_with_backslashes() {
        assert!(build_agent_url("..\\..").is_err());
    }

    #[test]
    fn rejects_empty_path() {
        assert!(build_agent_url("").is_err());
    }

    #[test]
    fn rejects_path_missing_leading_slash() {
        assert!(build_agent_url("printers").is_err());
    }

    #[test]
    fn rejects_query_strings() {
        // No current agent endpoint needs query params; keep it path-only.
        assert!(build_agent_url("/health?x=1").is_err());
    }

    #[test]
    fn rejects_whitespace_and_control_chars() {
        assert!(build_agent_url("/health \t").is_err());
        assert!(build_agent_url("/heal\nth").is_err());
    }
}
