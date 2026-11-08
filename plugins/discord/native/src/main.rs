//! Discord plugin host: voice state over Discord's local RPC pipe, published as `plugin://discord/state` while
//! a window subscribes, and the voice controls.
// No console window: the app talks to this process over pipes only.
#![windows_subsystem = "windows"]
mod auth;
mod client;
mod frame;
mod model;
mod rpc;
mod store;
mod voice;

use plugin_sdk::{Call, Host, WINDOW_CLOSED, answer};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::{mpsc, oneshot};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VoiceCommand {
    ToggleMute,
    ToggleDeaf,
    Leave,
    Rejoin,
}

enum Operation {
    Authorize(String),
    Logout,
    Voice(VoiceCommand),
}
struct Message {
    operation: Operation,
    reply: oneshot::Sender<Result<(), String>>,
}
struct Running {
    sender: mpsc::Sender<Message>,
    task: tokio::task::JoinHandle<()>,
}

#[derive(Default)]
struct Inner {
    subscribers: HashSet<String>,
    generation: u64,
    running: Option<Running>,
    latest: Option<Value>,
}

pub struct DiscordHub {
    inner: Mutex<Inner>,
    worker: Arc<tokio::sync::Mutex<()>>,
    host: Host,
}

impl DiscordHub {
    fn subscribe(self: &Arc<Self>, label: &str) -> Result<Value, String> {
        let mut inner = self.inner.lock().map_err(|_| "Discord hub unavailable")?;
        if inner.running.is_none() {
            let path = plugin_sdk::data_dir()?.join("discord.json");
            inner.generation = inner
                .generation
                .checked_add(1)
                .ok_or("Discord generation exhausted")?;
            let (sender, receiver) = mpsc::channel(32);
            let worker = self.worker.clone();
            let hub = self.clone();
            let generation = inner.generation;
            let task = tokio::spawn(async move {
                // Abort releases the old pipe before a replacement worker can open another.
                let _lease = worker.lock().await;
                client::run(hub, generation, path, receiver).await;
            });
            inner.running = Some(Running { sender, task });
        }
        inner.subscribers.insert(label.into());
        Ok(inner
            .latest
            .clone()
            .unwrap_or_else(|| json!({"state":"connecting"})))
    }

    fn unsubscribe(&self, label: &str) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        inner.subscribers.remove(label);
        if inner.subscribers.is_empty() {
            if let Some(running) = inner.running.take() {
                running.task.abort();
            }
            inner.latest = None;
        }
    }

    fn publish(&self, generation: u64, view: Value) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        if inner.running.is_some() && inner.generation == generation {
            // The app delivers it to the dashboard and panel only, never to embedded content webviews.
            self.host.emit("state", &view);
            inner.latest = Some(view);
        }
    }

    async fn operation(&self, operation: Operation) -> Result<(), String> {
        let sender = self
            .inner
            .lock()
            .map_err(|_| "Discord hub unavailable")?
            .running
            .as_ref()
            .map(|running| running.sender.clone())
            .ok_or("Connect Discord first")?;
        let (reply, receiver) = oneshot::channel();
        sender
            .try_send(Message { operation, reply })
            .map_err(|_| "Discord is busy")?;
        tokio::time::timeout(Duration::from_secs(185), receiver)
            .await
            .map_err(|_| "Discord operation timed out")?
            .map_err(|_| "Discord connection stopped")?
    }
}

/// The calling window is set by the app; each operation keeps the window it was limited to in-app.
fn only(window: &str, allowed: &str) -> Result<(), String> {
    if window == allowed {
        Ok(())
    } else {
        Err("Discord access denied".into())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Authorize {
    client_id: String,
}

#[derive(Deserialize)]
struct Voice {
    command: VoiceCommand,
}

async fn handle(hub: Arc<DiscordHub>, call: Call) -> Result<Value, String> {
    let window = call.window.as_deref().unwrap_or_default();
    let params = call.params;
    match call.method.as_str() {
        "subscribe" => hub.subscribe(window),
        "unsubscribe" | WINDOW_CLOSED => {
            hub.unsubscribe(window);
            Ok(Value::Null)
        }
        "authorize" => {
            only(window, "panel")?;
            let Authorize { client_id } =
                serde_json::from_value(params).map_err(|_| "Invalid Discord client ID")?;
            let client_id = client_id.trim();
            if !model::valid_id(client_id) {
                return Err("Invalid Discord client ID".into());
            }
            answer(hub.operation(Operation::Authorize(client_id.into())).await)
        }
        "logout" => {
            only(window, "panel")?;
            answer(hub.operation(Operation::Logout).await)
        }
        "voice" => {
            only(window, "main")?;
            let Voice { command } =
                serde_json::from_value(params).map_err(|_| "Unknown Discord command")?;
            answer(hub.operation(Operation::Voice(command)).await)
        }
        method => Err(format!("Unknown method {method}")),
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let host = Host::connect();
    let hub = Arc::new(DiscordHub {
        inner: Mutex::default(),
        worker: Arc::default(),
        host: host.clone(),
    });
    plugin_sdk::serve(&host, |call| handle(hub.clone(), call)).await;
}
