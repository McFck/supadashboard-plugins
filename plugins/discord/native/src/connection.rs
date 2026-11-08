use super::{Client, Phase};
use crate::{auth, model, rpc::Rpc, store::Credentials};
use plugin_sdk::secure as crypto;
use serde_json::json;
use std::time::Duration;
use tokio::time::timeout;

impl Client {
    pub(super) async fn refresh(&mut self) -> Result<(), String> {
        let mut credentials = self
            .store
            .credentials
            .clone()
            .ok_or("Connect Discord first")?;
        credentials.tokens = timeout(
            Duration::from_secs(20),
            auth::refresh(&credentials.client_id, &credentials.tokens),
        )
        .await
        .map_err(|_| "Discord refresh timed out")??;
        self.store.save(Some(credentials))
    }

    async fn authenticate(&mut self) -> Result<(), String> {
        self.phase = Phase::Authenticating;
        self.publish();
        if self
            .store
            .credentials
            .as_ref()
            .is_some_and(|c| c.tokens.needs_refresh(plugin_sdk::now()))
            && let Err(error) = self.refresh().await
        {
            self.phase = Phase::NeedsAuth;
            return Err(error);
        }
        let token = self
            .store
            .credentials
            .as_ref()
            .ok_or("Connect Discord first")?
            .tokens
            .access_token
            .clone();
        let mut response = self
            .request("AUTHENTICATE", json!({"access_token":token}))
            .await;
        if response
            .as_ref()
            .is_err_and(|error| error == "Discord rejected AUTHENTICATE")
        {
            if let Err(error) = self.refresh().await {
                self.phase = Phase::NeedsAuth;
                return Err(error);
            }
            let token = self
                .store
                .credentials
                .as_ref()
                .ok_or("Connect Discord first")?
                .tokens
                .access_token
                .clone();
            response = self
                .request("AUTHENTICATE", json!({"access_token":token}))
                .await;
            if response.is_err() {
                self.phase = Phase::NeedsAuth;
            }
        }
        let response = response?;
        if !auth::SCOPES.iter().all(|scope| {
            response["scopes"]
                .as_array()
                .is_some_and(|scopes| scopes.iter().any(|s| s == scope))
        }) {
            self.phase = Phase::NeedsAuth;
            return Err("Discord voice permission missing".into());
        }
        self.voice.user = Some(model::user(&response["user"]).ok_or("Invalid Discord user")?);
        Ok(())
    }

    pub(super) async fn connect(&mut self, authorize: Option<String>) -> Result<(), String> {
        let client_id = authorize
            .as_ref()
            .or(self.store.credentials.as_ref().map(|c| &c.client_id))
            .ok_or("Connect Discord first")?
            .clone();
        self.phase = Phase::Handshake;
        self.publish();
        self.rpc = Some(Rpc::connect(&client_id).await?);
        self.subscribed_channel = None;
        if authorize.is_some() {
            self.phase = Phase::Authorizing;
            self.publish();
            let (verifier, challenge) = crypto::pkce()?;
            let response = self.request("AUTHORIZE", json!({"client_id":client_id,"scopes":auth::SCOPES,"code_challenge":challenge,"code_challenge_method":"S256"})).await?;
            let code = response["code"]
                .as_str()
                .filter(|code| !code.is_empty() && code.len() <= 8192)
                .ok_or("Invalid Discord authorization")?;
            let tokens = timeout(
                Duration::from_secs(20),
                auth::exchange(&client_id, code, &verifier),
            )
            .await
            .map_err(|_| "Discord authorization timed out")??;
            self.store.save(Some(Credentials {
                client_id,
                tokens,
                last_channel: self.voice.last_channel.clone(),
            }))?;
        }
        self.authenticate().await?;
        for event in ["VOICE_CHANNEL_SELECT", "VOICE_SETTINGS_UPDATE"] {
            self.rpc
                .as_mut()
                .ok_or("Discord isn't running")?
                .request("SUBSCRIBE", json!({}), Some(event))
                .await?;
        }
        let settings = self.request("GET_VOICE_SETTINGS", json!({})).await?;
        self.voice = self.voice.event("VOICE_SETTINGS_UPDATE", &settings);
        if self.voice.settings.is_none() {
            return Err("Invalid Discord voice settings".into());
        }
        // Speaking state belongs to the old connection; the channel remains for leave/switch detection.
        self.voice.members.clear();
        self.selected().await?;
        self.phase = Phase::Ready;
        self.retry = 0;
        self.publish();
        Ok(())
    }
}
