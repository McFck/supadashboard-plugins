//! The sync offset the user set for each song on the lyrics tile, keyed like the lyrics cache.
use super::{Track, cache};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path, sync::Mutex};

/// Largest offset either way (ms), the tile slider's range.
const LIMIT_MS: i64 = 10_000;
/// Songs kept; setting one more forgets the one set longest ago.
const MAX_ENTRIES: usize = 500;
const VERSION: u8 = 1;
const FILE: &str = "lyrics-offsets.json";

/// Oldest first; a song is never listed twice and never with 0.
type Entries = Vec<(String, i64)>;

#[derive(Deserialize, Serialize)]
struct Stored {
    version: u8,
    entries: Entries,
}

#[derive(Default)]
pub struct LyricsOffsets(Mutex<Option<Entries>>);

fn valid(key: &str, offset_ms: i64) -> bool {
    key.len() == 64
        && key.bytes().all(|byte| byte.is_ascii_hexdigit())
        && offset_ms != 0
        && offset_ms.abs() <= LIMIT_MS
}

/// The saved offsets without the entries no build of this store writes. An unreadable file is moved aside
/// instead of being written over.
fn load(path: &Path) -> Result<Entries, String> {
    let stored = match fs::read(path) {
        Ok(bytes) => serde_json::from_slice::<Stored>(&bytes)
            .ok()
            .filter(|stored| stored.version == VERSION),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let Some(stored) = stored else {
        fs::rename(path, path.with_extension("json.bad")).map_err(|error| error.to_string())?;
        return Ok(Vec::new());
    };
    let mut entries: Entries = Vec::new();
    for (key, offset_ms) in stored.entries {
        if valid(&key, offset_ms) {
            entries.retain(|(other, _)| *other != key);
            entries.push((key, offset_ms));
        }
    }
    let excess = entries.len().saturating_sub(MAX_ENTRIES);
    entries.drain(..excess);
    Ok(entries)
}

/// `entries` with `key` set to `offset_ms` as the newest entry, or removed for 0.
fn with(entries: &Entries, key: &str, offset_ms: i64) -> Entries {
    let mut next: Entries = entries
        .iter()
        .filter(|(other, _)| other != key)
        .cloned()
        .collect();
    if offset_ms != 0 {
        next.push((key.into(), offset_ms));
    }
    let excess = next.len().saturating_sub(MAX_ENTRIES);
    next.drain(..excess);
    next
}

fn save(path: &Path, entries: &Entries) -> Result<(), String> {
    let write = || -> Result<(), Box<dyn std::error::Error>> {
        let partial = path.with_extension("tmp");
        fs::write(
            &partial,
            serde_json::to_vec(&Stored {
                version: VERSION,
                entries: entries.clone(),
            })?,
        )?;
        fs::rename(partial, path)?;
        Ok(())
    };
    write().map_err(|error| error.to_string())
}

impl LyricsOffsets {
    /// Runs `job` on the loaded offsets, loading them on first use.
    fn locked<T>(
        &self,
        job: impl FnOnce(&Path, &mut Entries) -> Result<T, String>,
    ) -> Result<T, String> {
        let path = plugin_sdk::data_dir()?.join(FILE);
        let mut guard = self.0.lock().map_err(|_| "Lyrics offsets unavailable")?;
        if guard.is_none() {
            *guard = Some(load(&path)?);
        }
        let entries = guard.as_mut().ok_or("Lyrics offsets unavailable")?;
        job(&path, entries)
    }

    pub fn get(&self, track: &Track) -> Result<i64, String> {
        let key = cache::key(track)?;
        self.locked(|_, entries| {
            Ok(entries
                .iter()
                .find(|(other, _)| *other == key)
                .map_or(0, |(_, offset_ms)| *offset_ms))
        })
    }

    pub fn set(&self, track: &Track, offset_ms: i64) -> Result<(), String> {
        let key = cache::key(track)?;
        if offset_ms.abs() > LIMIT_MS {
            return Err("Invalid lyrics offset".into());
        }
        self.locked(|path, entries| {
            let next = with(entries, &key, offset_ms);
            save(path, &next)?;
            // Only a saved change is kept, so memory never claims what the file does not hold.
            *entries = next;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn key(n: usize) -> String {
        format!("{n:064x}")
    }
    #[test]
    fn keeps_the_newest_500_songs_and_drops_reset_ones() {
        let mut entries = Vec::new();
        for n in 0..=MAX_ENTRIES {
            entries = with(&entries, &key(n), 100);
        }
        assert_eq!(entries.len(), MAX_ENTRIES);
        assert_eq!(entries[0].0, key(1));
        entries = with(&entries, &key(1), -2500);
        assert_eq!(entries.last(), Some(&(key(1), -2500)));
        assert_eq!(entries.len(), MAX_ENTRIES);
        entries = with(&entries, &key(1), 0);
        assert!(entries.iter().all(|(other, _)| *other != key(1)));
    }
    #[test]
    fn loads_only_valid_entries_and_never_writes_over_an_unreadable_file() {
        let dir = std::env::temp_dir().join(format!(
            "supa-lyrics-offsets-{}-{}",
            std::process::id(),
            plugin_sdk::now()
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE);
        assert_eq!(load(&path), Ok(Vec::new()));
        let raw = serde_json::json!({ "version": 1, "entries": [
            [key(1), 1200], ["not-a-key", 100], [key(2), 10_001], [key(3), 0], [key(1), -300]
        ]});
        fs::write(&path, raw.to_string()).unwrap();
        assert_eq!(load(&path), Ok(vec![(key(1), -300)]));
        save(&path, &vec![(key(4), 900)]).unwrap();
        assert_eq!(load(&path), Ok(vec![(key(4), 900)]));
        fs::write(&path, b"broken").unwrap();
        assert_eq!(load(&path), Ok(Vec::new()));
        assert_eq!(
            fs::read(path.with_extension("json.bad")).unwrap(),
            b"broken"
        );
        assert!(!path.exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
