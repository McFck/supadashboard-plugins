use serde::{Deserialize, Serialize};

pub const SCOPES: [&str; 3] = ["rpc", "rpc.voice.read", "rpc.voice.write"];
const REDIRECT: &str = "http://127.0.0.1";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: u64,
}

impl Tokens {
    pub fn needs_refresh(&self, now: u64) -> bool {
        self.expires_at <= now.saturating_add(60)
    }
}

pub fn refresh_form(client_id: &str, token: &str) -> Vec<(String, String)> {
    vec![
        ("client_id".into(), client_id.into()),
        ("grant_type".into(), "refresh_token".into()),
        ("refresh_token".into(), token.into()),
    ]
}

#[derive(Deserialize)]
struct Response {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
    token_type: String,
    scope: Option<String>,
}

pub fn parse_tokens(body: &str, previous: Option<&Tokens>, now: u64) -> Result<Tokens, String> {
    if body.len() > 65_536 {
        return Err("Invalid Discord token response".into());
    }
    let data: Response =
        serde_json::from_str(body).map_err(|_| "Invalid Discord token response")?;
    let refresh_token = data
        .refresh_token
        .or_else(|| previous.map(|tokens| tokens.refresh_token.clone()))
        .ok_or("Missing Discord refresh token")?;
    let valid_token =
        |s: &str| !s.is_empty() && s.len() <= 8192 && s.bytes().all(|b| b.is_ascii_graphic());
    if !valid_token(&data.access_token)
        || !valid_token(&refresh_token)
        || !data.token_type.eq_ignore_ascii_case("bearer")
        || data.expires_in == 0
        || data.expires_in > 31_536_000
        || data.scope.as_ref().is_some_and(|scope| {
            !SCOPES
                .iter()
                .all(|required| scope.split_whitespace().any(|s| s == *required))
        })
    {
        return Err("Invalid Discord token response".into());
    }
    Ok(Tokens {
        access_token: data.access_token,
        refresh_token,
        expires_at: now
            .checked_add(data.expires_in)
            .ok_or("Invalid Discord token expiry")?,
    })
}

pub async fn exchange(client_id: &str, code: &str, verifier: &str) -> Result<Tokens, String> {
    request(
        vec![
            ("client_id".into(), client_id.into()),
            ("grant_type".into(), "authorization_code".into()),
            ("code".into(), code.into()),
            ("redirect_uri".into(), REDIRECT.into()),
            ("code_verifier".into(), verifier.into()),
        ],
        None,
    )
    .await
}

pub async fn refresh(client_id: &str, tokens: &Tokens) -> Result<Tokens, String> {
    request(refresh_form(client_id, &tokens.refresh_token), Some(tokens)).await
}

async fn request(form: Vec<(String, String)>, previous: Option<&Tokens>) -> Result<Tokens, String> {
    let fields: Vec<_> = form
        .iter()
        .map(|(key, value)| (key.as_str(), value.as_str()))
        .collect();
    let response = plugin_sdk::http::send(
        "POST",
        "https://discord.com/api/oauth2/token",
        &[],
        Some(&plugin_sdk::http::form(&fields)),
    )
    .await
    .map_err(|_| "Discord token exchange failed")?;
    if !(200..300).contains(&response.status) {
        return Err("Discord token exchange failed".into());
    }
    parse_tokens(&response.body, previous, plugin_sdk::now())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn refresh_preserves_unrotated_token_and_uses_server_expiry() {
        let old = Tokens {
            access_token: "old".into(),
            refresh_token: "keep".into(),
            expires_at: 100,
        };
        let body = json!({"access_token":"new","expires_in":3600,"token_type":"Bearer"});
        let tokens = parse_tokens(&body.to_string(), Some(&old), 200).unwrap();
        assert_eq!(tokens.refresh_token, "keep");
        assert_eq!(tokens.expires_at, 3800);
        assert!(tokens.needs_refresh(3740));
        assert!(!tokens.needs_refresh(3739));
        let rotated = parse_tokens(&json!({"access_token":"new","refresh_token":"rotated","expires_in":3600,"token_type":"Bearer"}).to_string(), Some(&old), 200).unwrap();
        assert_eq!(rotated.refresh_token, "rotated");
        assert_eq!(
            refresh_form("123", "a&b"),
            vec![
                ("client_id".into(), "123".into()),
                ("grant_type".into(), "refresh_token".into()),
                ("refresh_token".into(), "a&b".into())
            ]
        );
    }

    #[test]
    fn rejects_failed_expired_and_under_scoped_token_responses() {
        for body in [
            json!({"error":"invalid_grant"}),
            json!({"access_token":"x","refresh_token":"r","expires_in":0,"token_type":"Bearer"}),
            json!({"access_token":"x","refresh_token":"r","expires_in":10,"token_type":"Bearer","scope":"rpc"}),
        ] {
            assert!(parse_tokens(&body.to_string(), None, 0).is_err());
        }
    }
}
