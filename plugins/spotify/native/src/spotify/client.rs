use super::{
    Command, Message, Operation, SpotifyHub, api, auth, shuffle,
    store::{Credentials, Store},
};
use plugin_sdk::http;
use serde_json::{Value, json};
use std::sync::Arc;
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};
use tokio::sync::mpsc;

struct Client {
    hub: Arc<SpotifyHub>,
    generation: u64,
    store: Store,
    player: api::Player,
    liked: Option<bool>,
    retry_at: Option<Instant>,
}

pub(super) async fn run(
    hub: Arc<SpotifyHub>,
    generation: u64,
    path: PathBuf,
    mut receiver: mpsc::Receiver<Message>,
) {
    let store = match Store::open(path) {
        Ok(store) => store,
        Err(error) => {
            hub.publish(generation, json!({"state":"needsAuth", "error":error}));
            while let Some(message) = receiver.recv().await {
                let _ = message
                    .reply
                    .send(Err("Could not read Spotify store".into()));
            }
            return;
        }
    };
    let mut client = Client {
        hub,
        generation,
        store,
        player: api::Player::default(),
        liked: None,
        retry_at: None,
    };
    loop {
        let error = client.poll().await.err();
        client.publish(error);
        let delay = if client.player.playing { 5 } else { 30 };
        match tokio::time::timeout(Duration::from_secs(delay), receiver.recv()).await {
            Ok(Some(message)) => {
                let result = client.operation(message.operation).await;
                client.publish(None);
                let _ = message.reply.send(result);
            }
            Ok(None) => break,
            Err(_) => {}
        }
    }
}

impl Client {
    fn publish(&self, error: Option<String>) {
        let view: Value = if self.store.credentials.tokens.is_some() {
            json!({"state":"ready", "user":self.store.credentials.user_name, "trackUri":self.player.uri, "liked":self.liked, "smartShuffle":self.player.smart_shuffle, "shuffle":self.player.shuffle, "error":error})
        } else {
            json!({"state":"needsAuth", "error":error})
        };
        self.hub.publish(self.generation, view);
    }

    async fn refresh(&mut self) -> Result<(), String> {
        let credentials = &self.store.credentials;
        let result = auth::refresh(
            &credentials.client_id,
            credentials.tokens.as_ref().ok_or("Connect Spotify first")?,
        )
        .await;
        match result {
            Ok(tokens) => self.store.save(Credentials {
                tokens: Some(tokens),
                ..credentials.clone()
            }),
            Err(error) => {
                if error == "Connect Spotify first" {
                    self.store.logout()?;
                }
                Err(error)
            }
        }
    }

    async fn request(&mut self, method: &str, path: &str) -> Result<http::Response, String> {
        if self.retry_at.is_some_and(|at| Instant::now() < at) {
            return Err("Spotify rate limited".into());
        }
        let tokens = self
            .store
            .credentials
            .tokens
            .as_ref()
            .ok_or("Connect Spotify first")?;
        if tokens.expires_at <= plugin_sdk::now().saturating_add(60) {
            self.refresh().await?;
        }
        for attempt in 0..2 {
            let tokens = self
                .store
                .credentials
                .tokens
                .as_ref()
                .ok_or("Connect Spotify first")?;
            let authorization = format!("Bearer {}", tokens.access_token);
            let response = http::send(
                method,
                &format!("https://api.spotify.com/v1{path}"),
                &[("Authorization", &authorization)],
                None,
            )
            .await?;
            match api::check(&response) {
                Ok(()) => return Ok(response),
                Err(api::Error::Unauthorized) if attempt == 0 => self.refresh().await?,
                Err(error) => {
                    match error {
                        api::Error::Unauthorized => self.store.logout()?,
                        api::Error::RateLimited(seconds) => {
                            self.retry_at = Instant::now().checked_add(Duration::from_secs(seconds))
                        }
                        _ => {}
                    }
                    return Err(error.message().into());
                }
            }
        }
        Err("Connect Spotify first".into())
    }

    async fn poll(&mut self) -> Result<(), String> {
        if self.store.credentials.tokens.is_none() {
            return Ok(());
        }
        self.read_player().await?;
        self.liked = None;
        if let Some(uri) = &self.player.uri {
            let path = format!("/me/library/contains?{}", http::form(&[("uris", uri)]));
            self.liked = Some(api::contains(&self.request("GET", &path).await?.body)?);
        }
        Ok(())
    }

    async fn read_player(&mut self) -> Result<Option<bool>, String> {
        let response = self.request("GET", "/me/player").await?;
        let active = if response.status == 204 {
            None
        } else {
            Some(api::shuffle(&response.body)?)
        };
        let player = if response.status == 204 {
            api::Player::default()
        } else {
            api::player(&response.body)?
        };
        if player.uri != self.player.uri {
            self.liked = None;
        }
        self.player = player;
        Ok(active)
    }

    async fn confirm_shuffle(&mut self, enabled: bool) -> Result<(), String> {
        for _ in 0..5 {
            tokio::time::sleep(Duration::from_millis(200)).await;
            let actual = self.read_player().await?.ok_or("Spotify isn't playing")?;
            if !self.player.smart_shuffle && actual == enabled {
                return Ok(());
            }
        }
        if self.player.smart_shuffle {
            return Err("Turn off smart shuffle in Spotify".into());
        }
        Err("Spotify ignored shuffle".into())
    }

    async fn operation(&mut self, operation: Operation) -> Result<(), String> {
        match operation {
            Operation::Authorize(id) => {
                self.hub
                    .publish(self.generation, json!({"state":"connecting"}));
                let tokens = auth::authorize(&id).await?;
                let response = http::send(
                    "GET",
                    "https://api.spotify.com/v1/me",
                    &[("Authorization", &format!("Bearer {}", tokens.access_token))],
                    None,
                )
                .await?;
                api::check(&response).map_err(|e| e.message())?;
                let user_name = api::user(&response.body)?;
                self.store.save(Credentials {
                    client_id: id,
                    tokens: Some(tokens),
                    user_name,
                })?;
                self.retry_at = None;
                Ok(())
            }
            Operation::Logout => {
                self.store.logout()?;
                self.player = api::Player::default();
                self.liked = None;
                Ok(())
            }
            Operation::Command(command) => self.command(command).await,
            Operation::Shuffle(mode) => {
                let result = self.shuffle(mode).await;
                if let Err(error) = &result {
                    eprintln!("Spotify shuffle failed: {error}");
                }
                result
            }
        }
    }

    async fn shuffle(&mut self, mode: shuffle::Mode) -> Result<(), String> {
        if self.store.credentials.tokens.is_none() {
            return self.player_command(mode.media_command()).await;
        }
        let current = self.read_player().await?.ok_or("Spotify isn't playing")?;
        let enabled = mode.enabled(current);
        if self.player.smart_shuffle {
            // Spotify ignores Off while Smart is active; a confirmed On first exits Smart.
            self.set_shuffle(true).await?;
        }
        if self.player.shuffle == enabled {
            return Ok(());
        }
        self.set_shuffle(enabled).await
    }

    async fn set_shuffle(&mut self, enabled: bool) -> Result<(), String> {
        let device_id = self.player.device_id.clone();
        let explicit = if enabled {
            shuffle::Mode::On
        } else {
            shuffle::Mode::Off
        };
        match self.player_command(explicit.media_command()).await {
            Ok(()) => match self.confirm_shuffle(enabled).await {
                Ok(()) => return Ok(()),
                Err(error) => eprintln!("{error}; using Spotify Web API shuffle"),
            },
            Err(error) => {
                eprintln!("{error}; using Spotify Web API shuffle");
            }
        }
        // An HTTP success only acknowledges the command; publish observations, never its target.
        let state = enabled.to_string();
        let mut fields = vec![("state", state.as_str())];
        if let Some(id) = device_id.as_deref() {
            fields.push(("device_id", id));
        }
        let write = self
            .request(
                "PUT",
                &format!("/me/player/shuffle?{}", http::form(&fields)),
            )
            .await;
        match self.confirm_shuffle(enabled).await {
            Ok(()) => Ok(()),
            Err(confirmation) => Err(write.err().unwrap_or(confirmation)),
        }
    }

    /// A transport command for the Spotify session through the app, which owns the Windows media sessions.
    async fn player_command(&self, command: &str) -> Result<(), String> {
        let sent = self
            .hub
            .host
            .call("media-command", json!({ "command": command }))
            .await?;
        if sent != Value::Bool(true) {
            return Err("Spotify isn't playing".into());
        }
        Ok(())
    }

    async fn command(&mut self, command: Command) -> Result<(), String> {
        let response = self.request("GET", "/me/player/currently-playing").await?;
        if response.status == 204 {
            return Err("Spotify isn't playing".into());
        }
        let uri = api::player(&response.body)?
            .uri
            .ok_or("Spotify isn't playing")?;
        let path = format!("/me/library?{}", http::form(&[("uris", &uri)]));
        let method = if matches!(command, Command::Like) {
            "PUT"
        } else {
            "DELETE"
        };
        self.request(method, &path).await?;
        self.player.uri = Some(uri);
        self.liked = Some(matches!(command, Command::Like));
        if matches!(command, Command::Dislike) {
            self.player_command("next").await?;
        }
        Ok(())
    }
}
