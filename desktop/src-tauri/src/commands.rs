//! Tauri commands: agent proxy and sidecar lifecycle.

pub const AGENT_PORT: u16 = 12345;
pub const AGENT_PORT_STR: &str = "12345";

/// Proxy a request to the local agent (avoids CORS from WebView).
/// Body: { "method": "GET"|"POST", "path": "/health", "body": optional_string }
#[tauri::command]
pub async fn agent_request(
    method: String,
    path: String,
    body: Option<String>,
) -> Result<String, String> {
    let url = format!("http://127.0.0.1:{}{}", AGENT_PORT_STR, path);
    let client = reqwest::Client::new();

    let response = match method.to_uppercase().as_str() {
        "GET" => client.get(&url).send().await,
        "POST" => {
            let req = client.post(&url);
            if let Some(ref b) = body {
                req.header("Content-Type", "application/json").body(b.clone())
            } else {
                req
            }
            .send()
            .await
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
