use plugin_sdk::{http, secure};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

const REDIRECT: &str = "http://127.0.0.1:43821/callback";
const SCOPES: &str =
    "user-library-read user-library-modify user-read-playback-state user-modify-playback-state";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: u64,
}

pub fn valid_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit())
}

pub fn valid_tokens(tokens: &Tokens) -> bool {
    [&tokens.access_token, &tokens.refresh_token]
        .iter()
        .all(|s| !s.is_empty() && s.len() <= 8192 && s.bytes().all(|b| b.is_ascii_graphic()))
        && tokens.expires_at > 0
}

pub fn parse_tokens(body: &str, previous: Option<&Tokens>) -> Result<Tokens, String> {
    #[derive(Deserialize)]
    struct Response {
        access_token: String,
        refresh_token: Option<String>,
        expires_in: u64,
        token_type: String,
        scope: Option<String>,
    }
    if body.len() > 65_536 {
        return Err("Invalid Spotify token response".into());
    }
    let response: Response =
        serde_json::from_str(body).map_err(|_| "Invalid Spotify token response")?;
    let tokens = Tokens {
        access_token: response.access_token,
        refresh_token: response
            .refresh_token
            .or_else(|| previous.map(|t| t.refresh_token.clone()))
            .ok_or("Missing Spotify refresh token")?,
        expires_at: plugin_sdk::now()
            .checked_add(response.expires_in)
            .ok_or("Invalid Spotify expiry")?,
    };
    if !valid_tokens(&tokens)
        || !response.token_type.eq_ignore_ascii_case("bearer")
        || response.expires_in == 0
        || response.expires_in > 31_536_000
        || response.scope.is_some_and(|scope| {
            !SCOPES
                .split_whitespace()
                // Refresh cannot expand an older grant; keep its read/library features usable.
                .filter(|required| previous.is_none() || *required != "user-modify-playback-state")
                .all(|required| scope.split_whitespace().any(|s| s == required))
        })
    {
        return Err("Invalid Spotify token response".into());
    }
    Ok(tokens)
}

async fn exchange(fields: &[(&str, &str)], previous: Option<&Tokens>) -> Result<Tokens, String> {
    let response = http::send(
        "POST",
        "https://accounts.spotify.com/api/token",
        &[],
        Some(&http::form(fields)),
    )
    .await?;
    token_response(response, previous)
}

pub fn token_response(
    response: http::Response,
    previous: Option<&Tokens>,
) -> Result<Tokens, String> {
    if response.status != 200 {
        if serde_json::from_str::<serde_json::Value>(&response.body)
            .ok()
            .is_some_and(|v| v["error"] == "invalid_grant")
        {
            return Err("Connect Spotify first".into());
        }
        return Err("Spotify authorization failed".into());
    }
    parse_tokens(&response.body, previous)
}

pub async fn refresh(id: &str, tokens: &Tokens) -> Result<Tokens, String> {
    exchange(
        &[
            ("client_id", id),
            ("grant_type", "refresh_token"),
            ("refresh_token", &tokens.refresh_token),
        ],
        Some(tokens),
    )
    .await
}

fn decode(value: &str) -> Result<String, String> {
    let mut bytes = Vec::new();
    let mut input = value.bytes();
    while let Some(byte) = input.next() {
        bytes.push(match byte {
            b'+' => b' ',
            b'%' => {
                let a = input
                    .next()
                    .and_then(|b| (b as char).to_digit(16))
                    .ok_or("Invalid Spotify callback")?;
                let b = input
                    .next()
                    .and_then(|b| (b as char).to_digit(16))
                    .ok_or("Invalid Spotify callback")?;
                (a * 16 + b) as u8
            }
            b => b,
        });
    }
    String::from_utf8(bytes).map_err(|_| "Invalid Spotify callback".into())
}

pub fn callback(request: &str, state: &str) -> Result<String, String> {
    let line = request.lines().next().ok_or("Invalid Spotify callback")?;
    let mut parts = line.split_whitespace();
    if parts.next() != Some("GET") {
        return Err("Invalid Spotify callback".into());
    }
    let query = parts
        .next()
        .and_then(|p| p.strip_prefix("/callback?"))
        .ok_or("Invalid Spotify callback")?;
    if parts.next() != Some("HTTP/1.1") || parts.next().is_some() {
        return Err("Invalid Spotify callback".into());
    }
    let mut params = std::collections::HashMap::new();
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').ok_or("Invalid Spotify callback")?;
        if params.insert(decode(key)?, decode(value)?).is_some() {
            return Err("Invalid Spotify callback".into());
        }
    }
    if params.get("state").map(String::as_str) != Some(state) {
        return Err("Invalid Spotify callback state".into());
    }
    if params.contains_key("error") {
        return Err("Spotify connection cancelled".into());
    }
    params
        .remove("code")
        .filter(|s| !s.is_empty() && s.len() <= 8192 && s.bytes().all(|b| b.is_ascii_graphic()))
        .ok_or("Invalid Spotify authorization code".into())
}

pub async fn authorize(id: &str) -> Result<Tokens, String> {
    let listener = TcpListener::bind("127.0.0.1:43821")
        .await
        .map_err(|_| "Spotify callback port is busy")?;
    let (verifier, challenge) = secure::pkce()?;
    let (state, _) = secure::pkce()?;
    let url = format!(
        "https://accounts.spotify.com/authorize?{}",
        http::form(&[
            ("response_type", "code"),
            ("client_id", id),
            ("redirect_uri", REDIRECT),
            ("state", &state),
            ("code_challenge_method", "S256"),
            ("code_challenge", &challenge),
            ("scope", SCOPES)
        ])
    );
    plugin_sdk::open(&url).map_err(|_| "Could not open Spotify consent")?;
    tokio::time::timeout(Duration::from_secs(300), async {
        let code = receive_callback(listener, &state).await?;
        exchange(
            &[
                ("grant_type", "authorization_code"),
                ("code", &code),
                ("redirect_uri", REDIRECT),
                ("client_id", id),
                ("code_verifier", &verifier),
            ],
            None,
        )
        .await
    })
    .await
    .map_err(|_| "Spotify connection timed out")?
}

pub async fn receive_callback(listener: TcpListener, state: &str) -> Result<String, String> {
    // One connection only; dropping the listener prevents callback replay.
    let (mut stream, _) = listener
        .accept()
        .await
        .map_err(|_| "Spotify callback failed")?;
    drop(listener);
    let mut bytes = Vec::new();
    let mut chunk = [0; 1024];
    while !bytes.windows(4).any(|b| b == b"\r\n\r\n") {
        let count = stream
            .read(&mut chunk)
            .await
            .map_err(|_| "Spotify callback failed")?;
        if count == 0 || bytes.len() + count > 16_384 {
            return Err("Invalid Spotify callback".into());
        }
        bytes.extend_from_slice(&chunk[..count]);
    }
    let code = callback(
        std::str::from_utf8(&bytes).map_err(|_| "Invalid Spotify callback")?,
        state,
    );
    let status = if code.is_ok() {
        "200 OK"
    } else {
        "400 Bad Request"
    };
    let body = "You can close this tab.";
    stream.write_all(format!("HTTP/1.1 {status}\r\nContent-Type: text/plain\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len()).as_bytes()).await.map_err(|_| "Spotify callback failed")?;
    code
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn callback_closes_listener_after_first_request() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let receive = tokio::spawn(receive_callback(listener, "expected"));
        let mut client = tokio::net::TcpStream::connect(address).await.unwrap();
        client
            .write_all(
                b"GET /callback?state=expected&code=once HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
            )
            .await
            .unwrap();
        let mut response = String::new();
        client.read_to_string(&mut response).await.unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK"));
        assert_eq!(receive.await.unwrap().unwrap(), "once");
        assert!(tokio::net::TcpStream::connect(address).await.is_err());
    }
    #[test]
    fn rejects_callback_forgery_and_denial() {
        assert_eq!(
            callback("GET /callback?code=a%2Bb&state=ok HTTP/1.1\r\n", "ok").unwrap(),
            "a+b"
        );
        for request in [
            "GET /callback?code=x&state=bad HTTP/1.1",
            "GET /callback?code=x&state=ok&state=ok HTTP/1.1",
            "GET /other?code=x&state=ok HTTP/1.1",
            "GET /callback?code=%XX&state=ok HTTP/1.1",
        ] {
            assert!(callback(request, "ok").is_err());
        }
        assert_eq!(
            callback("GET /callback?error=access_denied&state=ok HTTP/1.1", "ok").unwrap_err(),
            "Spotify connection cancelled"
        );
    }
    #[test]
    fn preserves_or_rotates_refresh_tokens_and_rejects_invalid_grants() {
        let old = Tokens {
            access_token: "old".into(),
            refresh_token: "keep".into(),
            expires_at: 1,
        };
        let legacy = r#"{"access_token":"new","refresh_token":"keep","expires_in":3600,"token_type":"Bearer","scope":"user-library-read user-library-modify user-read-playback-state"}"#;
        assert!(parse_tokens(legacy, Some(&old)).is_ok());
        assert!(parse_tokens(legacy, None).is_err());
        for (body, expected) in [
            (
                r#"{"access_token":"new","expires_in":3600,"token_type":"Bearer"}"#,
                "keep",
            ),
            (
                r#"{"access_token":"new","refresh_token":"rotated","expires_in":3600,"token_type":"Bearer"}"#,
                "rotated",
            ),
        ] {
            assert_eq!(
                parse_tokens(body, Some(&old)).unwrap().refresh_token,
                expected
            );
        }
        assert!(parse_tokens(r#"{"error":"invalid_grant"}"#, Some(&old)).is_err());
        assert_eq!(
            token_response(
                http::Response {
                    status: 400,
                    body: r#"{"error":"invalid_grant"}"#.into(),
                    retry_after: None
                },
                Some(&old)
            )
            .err()
            .as_deref(),
            Some("Connect Spotify first")
        );
    }
}
