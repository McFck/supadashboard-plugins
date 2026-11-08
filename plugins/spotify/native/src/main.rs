//! Spotify plugin host: the Web API connection (sign-in, liked state, like/dislike, shuffle) and the song lyrics
//! (LRCLIB lookups, their cache and the per-song sync offsets).
// No console window: the app talks to this process over pipes only.
#![windows_subsystem = "windows"]
mod lyrics;
mod spotify;

use std::sync::Arc;

use plugin_sdk::{Call, Host, answer};
use serde::Deserialize;
use serde_json::Value;

use lyrics::{LyricsHub, LyricsOffsets, Track};
use spotify::SpotifyHub;

struct Plugin {
    spotify: Arc<SpotifyHub>,
    lyrics: LyricsHub,
    offsets: LyricsOffsets,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackParams {
    artist: String,
    title: String,
    album: String,
    duration_ms: u64,
    #[serde(default)]
    offset_ms: i64,
}

fn track(params: Value) -> Result<(Track, i64), String> {
    let p: TrackParams = serde_json::from_value(params).map_err(|_| "Invalid lyrics track")?;
    Ok((
        Track::new(p.artist, p.title, p.album, p.duration_ms)?,
        p.offset_ms,
    ))
}

async fn handle(plugin: Arc<Plugin>, call: Call) -> Result<Value, String> {
    let Call {
        method,
        params,
        window,
    } = call;
    match method.as_str() {
        "lyrics-get" => answer(plugin.lyrics.get(track(params)?.0).await),
        "lyrics-offset-get" => answer(plugin.offsets.get(&track(params)?.0)),
        "lyrics-offset-set" => {
            let (track, offset_ms) = track(params)?;
            answer(plugin.offsets.set(&track, offset_ms))
        }
        _ => {
            let window = window.as_deref().unwrap_or_default();
            spotify::handle(&plugin.spotify, &method, params, window)
                .await
                .unwrap_or_else(|| Err(format!("Unknown method {method}")))
        }
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let host = Host::connect();
    let plugin = Arc::new(Plugin {
        spotify: Arc::new(SpotifyHub::new(host.clone())),
        lyrics: LyricsHub::default(),
        offsets: LyricsOffsets::default(),
    });
    plugin_sdk::serve(&host, |call| handle(plugin.clone(), call)).await;
}
