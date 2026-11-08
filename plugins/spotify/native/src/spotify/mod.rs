//! Spotify Web API: sign-in, the liked/shuffle state published as `plugin://spotify/state` while a window
//! subscribes, and the like/dislike/shuffle commands.
mod api;
mod auth;
mod client;
mod shuffle;
mod store;

use plugin_sdk::{Host, WINDOW_CLOSED, answer};
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
pub enum Command {
    Like,
    Unlike,
    Dislike,
}
enum Operation {
    Authorize(String),
    Logout,
    Command(Command),
    Shuffle(shuffle::Mode),
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
pub struct SpotifyHub {
    inner: Mutex<Inner>,
    worker: Arc<tokio::sync::Mutex<()>>,
    host: Host,
}

impl SpotifyHub {
    pub fn new(host: Host) -> Self {
        Self {
            inner: Mutex::default(),
            worker: Arc::default(),
            host,
        }
    }

    fn subscribe(self: &Arc<Self>, label: &str) -> Result<Value, String> {
        let mut inner = self.inner.lock().map_err(|_| "Spotify unavailable")?;
        if inner.running.is_none() {
            let path = plugin_sdk::data_dir()?.join("spotify.json");
            inner.generation = inner
                .generation
                .checked_add(1)
                .ok_or("Spotify generation exhausted")?;
            let generation = inner.generation;
            let (sender, receiver) = mpsc::channel(32);
            let hub = self.clone();
            let worker = self.worker.clone();
            let task = tokio::spawn(async move {
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
        if inner.running.is_none()
            || generation != inner.generation
            || inner.latest.as_ref() == Some(&view)
        {
            return;
        }
        // The app delivers it to the dashboard and panel only, never to embedded content webviews.
        self.host.emit("state", &view);
        inner.latest = Some(view);
    }

    async fn operation(&self, operation: Operation) -> Result<(), String> {
        let sender = self
            .inner
            .lock()
            .map_err(|_| "Spotify unavailable")?
            .running
            .as_ref()
            .map(|r| r.sender.clone())
            .ok_or("Connect Spotify first")?;
        let (reply, receiver) = oneshot::channel();
        sender
            .try_send(Message { operation, reply })
            .map_err(|_| "Spotify is busy")?;
        tokio::time::timeout(Duration::from_secs(325), receiver)
            .await
            .map_err(|_| "Spotify operation timed out")?
            .map_err(|_| "Spotify connection stopped")?
    }
}

/// The calling window is set by the app; each operation keeps the window it was limited to in-app.
fn only(window: &str, allowed: &str) -> Result<(), String> {
    if window == allowed {
        Ok(())
    } else {
        Err("Spotify access denied".into())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Authorize {
    client_id: String,
}

#[derive(Deserialize)]
struct CommandParams {
    op: Command,
}

#[derive(Deserialize)]
struct ShuffleParams {
    mode: shuffle::Mode,
}

/// The Spotify methods; `None` when `method` is not one of them.
pub async fn handle(
    hub: &Arc<SpotifyHub>,
    method: &str,
    params: Value,
    window: &str,
) -> Option<Result<Value, String>> {
    let outcome = match method {
        "subscribe" => hub.subscribe(window),
        "unsubscribe" | WINDOW_CLOSED => {
            hub.unsubscribe(window);
            Ok(Value::Null)
        }
        "authorize" => match only(window, "panel").and_then(|()| {
            let Authorize { client_id } =
                serde_json::from_value(params).map_err(|_| "Invalid Spotify client ID")?;
            let id = client_id.trim().to_owned();
            auth::valid_id(&id)
                .then_some(id)
                .ok_or_else(|| "Invalid Spotify client ID".to_owned())
        }) {
            Ok(id) => answer(hub.operation(Operation::Authorize(id)).await),
            Err(error) => Err(error),
        },
        "logout" => match only(window, "panel") {
            Ok(()) => answer(hub.operation(Operation::Logout).await),
            Err(error) => Err(error),
        },
        "command" => match only(window, "main").and_then(|()| {
            serde_json::from_value::<CommandParams>(params)
                .map_err(|_| "Unknown Spotify command".to_owned())
        }) {
            Ok(CommandParams { op }) => answer(hub.operation(Operation::Command(op)).await),
            Err(error) => Err(error),
        },
        "shuffle" => match only(window, "main").and_then(|()| {
            serde_json::from_value::<ShuffleParams>(params)
                .map_err(|_| "Unknown shuffle mode".to_owned())
        }) {
            Ok(ShuffleParams { mode }) => answer(hub.operation(Operation::Shuffle(mode)).await),
            Err(error) => Err(error),
        },
        _ => return None,
    };
    Some(outcome)
}
