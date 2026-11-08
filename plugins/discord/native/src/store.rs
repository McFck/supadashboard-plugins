use super::{
    auth::Tokens,
    model::{Channel, valid_id},
};
use plugin_sdk::secure::ProtectedFile;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    pub client_id: String,
    pub tokens: Tokens,
    pub last_channel: Option<Channel>,
}

pub struct Store {
    file: ProtectedFile,
    pub credentials: Option<Credentials>,
}

impl Store {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        let (file, credentials) = ProtectedFile::open::<Credentials>(path, "Discord")?;
        if credentials.as_ref().is_some_and(|credentials| {
            !valid_id(&credentials.client_id)
                || credentials.tokens.access_token.is_empty()
                || credentials.tokens.refresh_token.is_empty()
                || credentials
                    .last_channel
                    .as_ref()
                    .is_some_and(|channel| !channel.valid() || channel.kind != "guild")
        }) {
            return Err("Invalid Discord credentials".into());
        }
        Ok(Self { file, credentials })
    }

    /// `None` deletes the store, for logout.
    pub fn save(&mut self, credentials: Option<Credentials>) -> Result<(), String> {
        self.file.save(credentials.as_ref())?;
        self.credentials = credentials;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypted_v1_round_trip_preserves_last_channel() {
        let dir = std::env::temp_dir().join(format!(
            "supa-discord-{}-{}",
            std::process::id(),
            plugin_sdk::now()
        ));
        let path = dir.join("discord.json");
        let mut store = Store::open(path.clone()).unwrap();
        store
            .save(Some(Credentials {
                client_id: "123456789012345678".into(),
                tokens: Tokens {
                    access_token: "private-access-token".into(),
                    refresh_token: "private-refresh-token".into(),
                    expires_at: 999,
                },
                last_channel: Some(Channel {
                    id: "223456789012345678".into(),
                    name: "Voice".into(),
                    kind: "guild".into(),
                    guild_id: Some("323456789012345678".into()),
                }),
            }))
            .unwrap();
        let loaded = Store::open(path.clone()).unwrap();
        assert_eq!(
            loaded
                .credentials
                .as_ref()
                .unwrap()
                .last_channel
                .as_ref()
                .unwrap()
                .name,
            "Voice"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
