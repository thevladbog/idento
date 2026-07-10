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

/// Proxy a request to the local agent (avoids CORS from WebView).
/// Body: { "method": "GET"|"POST", "path": "/health", "body": optional_string }
#[tauri::command]
pub async fn agent_request(
    method: String,
    path: String,
    body: Option<String>,
) -> Result<String, String> {
    let url = format!("http://127.0.0.1:{}{}", AGENT_PORT_STR, path);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let token = read_agent_token();

    let response = match method.to_uppercase().as_str() {
        "GET" => {
            let mut req = client.get(&url);
            if let Some(ref t) = token {
                req = req.header("Authorization", format!("Bearer {}", t));
            }
            req.send().await
        }
        "POST" => {
            let mut req = client.post(&url);
            if let Some(ref t) = token {
                req = req.header("Authorization", format!("Bearer {}", t));
            }
            if let Some(ref b) = body {
                req = req.header("Content-Type", "application/json").body(b.clone());
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
