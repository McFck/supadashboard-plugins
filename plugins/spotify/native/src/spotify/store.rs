use super::auth::{Tokens, valid_id, valid_tokens};
use plugin_sdk::secure::ProtectedFile;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    pub client_id: String,
    pub tokens: Option<Tokens>,
    pub user_name: String,
}

impl Credentials {
    fn valid(&self) -> bool {
        valid_id(&self.client_id) && self.tokens.as_ref().is_none_or(valid_tokens)
    }
}

pub struct Store {
    file: ProtectedFile,
    pub credentials: Credentials,
}

impl Store {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        let (file, credentials) = ProtectedFile::open::<Credentials>(path, "Spotify")?;
        if credentials.as_ref().is_some_and(|credentials| {
            !credentials.valid()
                || credentials.user_name.len() > 512
                || credentials.user_name.chars().any(char::is_control)
        }) {
            return Err("Invalid Spotify credentials".into());
        }
        Ok(Self {
            file,
            credentials: credentials.unwrap_or_default(),
        })
    }

    pub fn save(&mut self, credentials: Credentials) -> Result<(), String> {
        if !credentials.valid() {
            return Err("Invalid Spotify credentials".into());
        }
        self.file.save(Some(&credentials))?;
        self.credentials = credentials;
        Ok(())
    }

    /// Keeps the client ID so reconnecting needs no setup.
    pub fn logout(&mut self) -> Result<(), String> {
        if self.credentials.client_id.is_empty() {
            return Ok(());
        }
        self.save(Credentials {
            tokens: None,
            user_name: String::new(),
            ..self.credentials.clone()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn logout_keeps_client_id() {
        let dir = std::env::temp_dir().join(format!(
            "supa-spotify-{}-{}",
            std::process::id(),
            plugin_sdk::now()
        ));
        let path = dir.join("spotify.json");
        let mut store = Store::open(path.clone()).unwrap();
        let id = "0123456789abcdef0123456789abcdef";
        store
            .save(Credentials {
                client_id: id.into(),
                user_name: "Listener".into(),
                tokens: Some(Tokens {
                    access_token: "private-access".into(),
                    refresh_token: "private-refresh".into(),
                    expires_at: 999,
                }),
            })
            .unwrap();
        let mut loaded = Store::open(path.clone()).unwrap();
        assert_eq!(
            loaded.credentials.tokens.as_ref().unwrap().refresh_token,
            "private-refresh"
        );
        loaded.logout().unwrap();
        let logged_out = Store::open(path).unwrap();
        assert_eq!(logged_out.credentials.client_id, id);
        assert!(logged_out.credentials.tokens.is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
