use plugin_sdk::http;
use serde::Deserialize;

#[derive(Debug, PartialEq)]
pub enum Error {
    Unauthorized,
    Premium,
    NoPlayer,
    RateLimited(u64),
    Failed,
}

impl Error {
    pub fn message(&self) -> &'static str {
        match self {
            Self::Unauthorized => "Connect Spotify first",
            Self::Premium => "Spotify Premium required",
            Self::NoPlayer => "Spotify isn't playing",
            Self::RateLimited(_) => "Spotify rate limited",
            Self::Failed => "Spotify request failed",
        }
    }
}

pub fn check(response: &http::Response) -> Result<(), Error> {
    match response.status {
        200..=299 => Ok(()),
        401 => Err(Error::Unauthorized),
        403 if serde_json::from_str::<serde_json::Value>(&response.body)
            .ok()
            .is_some_and(|v| {
                v["error"]["reason"] == "PREMIUM_REQUIRED"
                    || v["error"]["message"] == "Premium required"
            }) =>
        {
            Err(Error::Premium)
        }
        404 => Err(Error::NoPlayer),
        429 => Err(Error::RateLimited(
            response
                .retry_after
                .as_ref()
                .and_then(|s| s.parse().ok())
                .unwrap_or(30)
                .max(1),
        )),
        _ => Err(Error::Failed),
    }
}

pub fn valid_uri(uri: &str) -> bool {
    uri.strip_prefix("spotify:track:")
        .is_some_and(|id| id.len() == 22 && id.bytes().all(|b| b.is_ascii_alphanumeric()))
}

#[derive(Default)]
pub struct Player {
    pub uri: Option<String>,
    pub playing: bool,
    pub smart_shuffle: bool,
    pub shuffle: bool,
    pub device_id: Option<String>,
}

pub fn player(body: &str) -> Result<Player, String> {
    #[derive(Deserialize)]
    struct Track {
        uri: String,
        #[serde(rename = "type")]
        kind: String,
    }
    #[derive(Deserialize)]
    struct Device {
        id: Option<String>,
    }
    #[derive(Deserialize)]
    struct Response {
        item: Option<Track>,
        is_playing: bool,
        #[serde(default)]
        smart_shuffle: bool,
        #[serde(default)]
        shuffle_state: bool,
        device: Option<Device>,
    }
    let response: Response = serde_json::from_str(body).map_err(|_| "Invalid Spotify player")?;
    let uri = match response.item {
        Some(track) if track.kind == "track" => {
            if !valid_uri(&track.uri) {
                return Err("Invalid Spotify track".into());
            }
            Some(track.uri)
        }
        _ => None,
    };
    let device_id = response.device.and_then(|device| device.id);
    if device_id
        .as_ref()
        .is_some_and(|id| id.is_empty() || id.len() > 512 || id.chars().any(char::is_control))
    {
        return Err("Invalid Spotify device".into());
    }
    Ok(Player {
        uri,
        playing: response.is_playing,
        smart_shuffle: response.smart_shuffle,
        shuffle: response.shuffle_state,
        device_id,
    })
}

pub fn contains(body: &str) -> Result<bool, String> {
    let values: Vec<bool> =
        serde_json::from_str(body).map_err(|_| "Invalid Spotify library response")?;
    if values.len() != 1 {
        return Err("Invalid Spotify library response".into());
    }
    Ok(values[0])
}

pub fn shuffle(body: &str) -> Result<bool, String> {
    #[derive(Deserialize)]
    struct Playback {
        shuffle_state: bool,
        #[serde(default)]
        smart_shuffle: bool,
    }
    let playback: Playback = serde_json::from_str(body).map_err(|_| "Invalid Spotify shuffle")?;
    Ok(playback.shuffle_state || playback.smart_shuffle)
}

pub fn user(body: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    struct User {
        id: String,
        display_name: Option<String>,
    }
    let user: User = serde_json::from_str(body).map_err(|_| "Invalid Spotify profile")?;
    let name = user
        .display_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(user.id);
    if name.trim().is_empty() || name.len() > 512 || name.chars().any(char::is_control) {
        return Err("Invalid Spotify profile".into());
    }
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_malformed_device_ids_before_targeting_playback() {
        let mut body =
            serde_json::json!({"item":null,"is_playing":false,"device":{"id":"desktop"}});
        assert_eq!(
            player(&body.to_string()).unwrap().device_id.as_deref(),
            Some("desktop")
        );
        for id in [
            serde_json::json!(""),
            serde_json::json!("bad\nname"),
            serde_json::json!(42),
        ] {
            body["device"]["id"] = id;
            assert!(player(&body.to_string()).is_err());
        }
    }
    #[test]
    fn rejects_unknown_shuffle_state_and_treats_smart_as_enabled() {
        for (body, expected) in [
            (r#"{"shuffle_state":false}"#, false),
            (r#"{"shuffle_state":true}"#, true),
            (r#"{"shuffle_state":false,"smart_shuffle":true}"#, true),
        ] {
            assert_eq!(shuffle(body).unwrap(), expected);
        }
        for body in [
            "{}",
            r#"{"shuffle_state":"false"}"#,
            r#"{"shuffle_state":true,"smart_shuffle":1}"#,
        ] {
            assert!(shuffle(body).is_err());
        }
    }
    #[test]
    fn rejects_bad_track_uris_and_malformed_library_results() {
        let body = r#"{"item":{"uri":"spotify:track:0123456789ABCDEFGHIJKL","type":"track"},"is_playing":true,"smart_shuffle":true,"unknown":"discard"}"#;
        let parsed = player(body).unwrap();
        assert!(parsed.playing && parsed.smart_shuffle);
        assert!(valid_uri(parsed.uri.as_deref().unwrap()));
        assert!(player(&body.replace("0123456789ABCDEFGHIJKL", "bad")).is_err());
        assert!(contains("[true]").unwrap());
        for body in ["[]", "[true,false]", "[1]", "{}"] {
            assert!(contains(body).is_err());
        }
    }
    #[test]
    fn maps_auth_device_premium_and_retry_errors() {
        for (status, body, retry, expected) in [
            (401, "", None, Error::Unauthorized),
            (
                403,
                r#"{"error":{"reason":"PREMIUM_REQUIRED"}}"#,
                None,
                Error::Premium,
            ),
            (404, "", None, Error::NoPlayer),
            (429, "", Some("123".into()), Error::RateLimited(123)),
        ] {
            assert_eq!(
                check(&http::Response {
                    status,
                    body: body.into(),
                    retry_after: retry
                }),
                Err(expected)
            );
        }
    }
}
