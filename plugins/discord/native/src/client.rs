use super::{
    DiscordHub, Message, Operation, model,
    rpc::Rpc,
    store::Store,
    voice::{self, VoiceState},
};
use serde_json::{Value, json};
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::{
    sync::mpsc::Receiver,
    time::{Instant, timeout},
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Absent,
    Handshake,
    NeedsAuth,
    Authorizing,
    Authenticating,
    Ready,
}

struct Client {
    hub: Arc<DiscordHub>,
    generation: u64,
    store: Store,
    voice: VoiceState,
    phase: Phase,
    rpc: Option<Rpc>,
    retry: usize,
    next_retry: Instant,
    last_view: Value,
    mute_before_deaf: Option<bool>,
    subscribed_channel: Option<model::Channel>,
}

pub async fn run(
    hub: Arc<DiscordHub>,
    generation: u64,
    path: PathBuf,
    mut messages: Receiver<Message>,
) {
    let store = match Store::open(path) {
        Ok(store) => store,
        Err(error) => {
            hub.publish(generation, json!({"state":"needsAuth"}));
            while let Some(message) = messages.recv().await {
                let _ = message.reply.send(Err(error.clone()));
            }
            return;
        }
    };
    let mut client = Client {
        hub,
        generation,
        voice: VoiceState {
            last_channel: store
                .credentials
                .as_ref()
                .and_then(|c| c.last_channel.clone()),
            ..VoiceState::default()
        },
        store,
        phase: Phase::Absent,
        rpc: None,
        retry: 0,
        next_retry: Instant::now(),
        last_view: Value::Null,
        mute_before_deaf: None,
        subscribed_channel: None,
    };
    if client.store.credentials.is_none() {
        client.phase = Phase::NeedsAuth;
    }
    let mut tick = tokio::time::interval(Duration::from_millis(50));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            message = messages.recv() => {
                let Some(message) = message else { return; };
                if message.reply.is_closed() { continue; }
                let result = match timeout(Duration::from_secs(180), client.operation(message.operation)).await {
                    Ok(result) => result,
                    Err(_) => {
                        client.disconnected();
                        Err("Discord operation timed out".into())
                    }
                };
                let _ = message.reply.send(result);
            }
            event = async { match client.rpc.as_mut() { Some(rpc) => rpc.receive().await, None => std::future::pending().await } } => {
                match event {
                    Ok((1, event)) => {
                        if let Err(error) = client.event(event).await { client.failed_event(&error); }
                    }
                    Ok((3, ping)) => {
                        if let Some(rpc) = client.rpc.as_mut()
                            && rpc.pong(&ping).await.is_err() { client.disconnected(); }
                    }
                    Ok((4, _)) => {},
                    Ok(_) => client.disconnected(),
                    Err(_) => client.disconnected(),
                }
            }
            _ = tick.tick() => {
                if client.rpc.is_none() && client.phase != Phase::NeedsAuth && client.store.credentials.is_some() && Instant::now() >= client.next_retry
                    && client.connect(None).await.is_err() { client.disconnected(); }
                if client.phase == Phase::Ready && client.store.credentials.as_ref().is_some_and(|c| c.tokens.needs_refresh(plugin_sdk::now())) {
                    if let Err(error) = client.refresh().await {
                        eprintln!("Discord refresh failed: {error}");
                        client.phase = Phase::NeedsAuth;
                    }
                    else { client.phase = Phase::Absent; client.next_retry = Instant::now(); }
                    // Re-authenticate the new token on a fresh RPC session without reopening consent.
                    client.rpc = None;
                }
                client.publish();
            }
        }
        // Requests may receive dispatches before their reply; reduce those in the same actor.
        while let Some(event) = client.rpc.as_mut().and_then(|rpc| rpc.events.pop_front()) {
            if let Err(error) = client.event(event).await {
                client.failed_event(&error);
                break;
            }
        }
    }
}

impl Client {
    fn failed_event(&mut self, error: &str) {
        // Fixed internal errors contain no RPC bodies or credentials.
        eprintln!("Discord state update failed: {error}");
        self.disconnected();
    }
    fn publish(&mut self) {
        let view = match self.phase {
            Phase::Absent => json!({"state":"absent"}),
            Phase::NeedsAuth => json!({"state":"needsAuth"}),
            Phase::Authorizing => json!({"state":"authorizing"}),
            Phase::Handshake | Phase::Authenticating => json!({"state":"connecting"}),
            Phase::Ready => self.voice.view(),
        };
        if view != self.last_view {
            self.hub.publish(self.generation, view.clone());
            self.last_view = view;
        }
    }

    fn disconnected(&mut self) {
        self.rpc = None;
        if self.phase != Phase::NeedsAuth {
            self.phase = Phase::Absent;
        }
        let seconds = [1, 2, 5, 10, 30][self.retry.min(4)];
        self.retry = self.retry.saturating_add(1);
        self.next_retry = Instant::now() + Duration::from_secs(seconds);
        self.publish();
    }

    async fn request(&mut self, cmd: &str, args: Value) -> Result<Value, String> {
        let result = self
            .rpc
            .as_mut()
            .ok_or("Discord isn't running")?
            .request(cmd, args, None)
            .await;
        if result
            .as_ref()
            .is_err_and(|error| !error.starts_with("Discord rejected "))
        {
            // A timed-out write may have reached Discord; close it and never replay the action.
            self.disconnected();
        }
        if result.is_ok()
            && let Some(rpc) = &mut self.rpc
        {
            // Pre-reply dispatches are already reflected in a snapshot. Replaying them could
            // resurrect a departed member or restore older mute settings.
            rpc.events.retain(|event| match cmd {
                "GET_SELECTED_VOICE_CHANNEL" => !matches!(
                    event["evt"].as_str(),
                    Some(
                        "VOICE_CHANNEL_SELECT"
                            | "VOICE_STATE_CREATE"
                            | "VOICE_STATE_UPDATE"
                            | "VOICE_STATE_DELETE"
                    )
                ),
                "GET_VOICE_SETTINGS" => event["evt"] != "VOICE_SETTINGS_UPDATE",
                _ => true,
            });
        }
        result
    }

    async fn selected(&mut self) -> Result<(), String> {
        let data = self
            .request("GET_SELECTED_VOICE_CHANNEL", json!({}))
            .await?;
        let next = self.voice.selected(&data)?;
        let subscriptions =
            voice::subscriptions(self.subscribed_channel.as_ref(), next.channel.as_ref());
        if self.voice.last_channel != next.last_channel {
            let mut credentials = self
                .store
                .credentials
                .clone()
                .ok_or("Connect Discord first")?;
            credentials.last_channel = next.last_channel.clone();
            if let Err(error) = self.store.save(Some(credentials)) {
                self.phase = Phase::NeedsAuth;
                self.disconnected();
                return Err(error);
            }
        }
        self.voice = next;
        for (cmd, event, id) in subscriptions {
            self.rpc
                .as_mut()
                .ok_or("Discord isn't running")?
                .request(cmd, json!({"channel_id":id}), Some(event))
                .await?;
        }
        self.subscribed_channel = self.voice.channel.clone();
        Ok(())
    }

    async fn event(&mut self, event: Value) -> Result<(), String> {
        if event["cmd"] != "DISPATCH" {
            return Ok(());
        }
        let name = event["evt"].as_str().ok_or("Invalid Discord event")?;
        if name == "VOICE_CHANNEL_SELECT" {
            self.selected().await?;
        } else {
            let next = self.voice.event(name, &event["data"]);
            if name == "VOICE_SETTINGS_UPDATE" {
                if let (Some((muted, false)), Some((_, true))) =
                    (self.voice.settings, next.settings)
                {
                    self.mute_before_deaf = Some(muted);
                } else if next.settings.is_some_and(|(_, deaf)| !deaf) {
                    self.mute_before_deaf = None;
                }
            }
            self.voice = next;
        }
        Ok(())
    }

    async fn operation(&mut self, operation: Operation) -> Result<(), String> {
        match operation {
            Operation::Authorize(id) => {
                self.rpc = None;
                let result = self.connect(Some(id)).await;
                if result.is_err() {
                    if self.phase != Phase::Handshake {
                        self.phase = Phase::NeedsAuth;
                    }
                    self.disconnected();
                }
                result
            }
            Operation::Logout => {
                self.store.save(None)?;
                self.rpc = None;
                self.voice = VoiceState::default();
                self.phase = Phase::NeedsAuth;
                self.publish();
                Ok(())
            }
            Operation::Voice(command) => {
                if self.phase != Phase::Ready {
                    return Err(if self.phase == Phase::Absent {
                        "Discord isn't running"
                    } else {
                        "Connect Discord first"
                    }
                    .into());
                }
                actions::execute(self, command).await
            }
        }
    }
}

// The action implementation shares the serialized actor, so two toggles cannot read the same state.
#[path = "actions.rs"]
mod actions;

#[path = "connection.rs"]
mod connection;
