use super::{LyricsView, Track};
use plugin_sdk::secure::sha256_hex;
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

pub(super) const NEGATIVE_TTL: u64 = 300;
const VERSION: u8 = 3;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    version: u8,
    fetched_at: u64,
    result: LyricsView,
}

pub(super) fn key(track: &Track) -> Result<String, String> {
    // JSON avoids ambiguous separators in artist/title metadata.
    let identity = serde_json::to_vec(&(&track.artist, &track.title, &track.album, track.duration))
        .map_err(|_| "Invalid lyrics track")?;
    sha256_hex(&identity).map_err(|_| "Could not hash lyrics track".into())
}

pub fn read(dir: &Path, key: &str, now: u64) -> Option<LyricsView> {
    let file = fs::File::open(dir.join(format!("{key}.json"))).ok()?;
    if file.metadata().ok()?.len() > 8 * 1024 * 1024 {
        return None;
    }
    let entry: Entry = serde_json::from_reader(file).ok()?;
    if !(1..=VERSION).contains(&entry.version)
        || entry.fetched_at > now
        // Older lookups rejected synced lyrics of other cuts; keep their synced results and retry the rest.
        || (entry.version < VERSION && matches!(entry.result, LyricsView::None | LyricsView::Plain { .. }))
        || (entry.result == LyricsView::None && now - entry.fetched_at >= NEGATIVE_TTL)
    {
        return None;
    }
    let valid = match &entry.result {
        LyricsView::Synced { lines } => {
            !lines.is_empty()
                && lines.len() <= 2000
                && lines.iter().all(|line| line.text.chars().count() <= 500)
                && lines.windows(2).all(|pair| pair[0].at_ms <= pair[1].at_ms)
        }
        LyricsView::Plain { text } => !text.trim().is_empty() && text.chars().count() <= 100_000,
        _ => true,
    };
    valid.then_some(entry.result)
}

pub fn write(dir: &Path, key: &str, result: &LyricsView, fetched_at: u64) -> Result<(), String> {
    let write = || -> Result<(), Box<dyn std::error::Error>> {
        fs::create_dir_all(dir)?;
        let partial = dir.join(format!("{key}.tmp"));
        fs::write(
            &partial,
            serde_json::to_vec(&Entry {
                version: VERSION,
                fetched_at,
                result: result.clone(),
            })?,
        )?;
        fs::rename(partial, dir.join(format!("{key}.json")))?;
        let mut files: Vec<_> = fs::read_dir(dir)?
            .filter_map(Result::ok)
            .filter(|file| {
                file.path()
                    .extension()
                    .is_some_and(|extension| extension == "json")
            })
            .collect();
        files.sort_by_key(|file| {
            file.metadata()
                .and_then(|metadata| metadata.modified())
                .ok()
        });
        let excess = files.len().saturating_sub(3000);
        for file in files.into_iter().take(excess) {
            fs::remove_file(file.path())?;
        }
        Ok(())
    };
    write().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn round_trips_positive_entries_expires_misses_and_ignores_corruption() {
        let dir = std::env::temp_dir().join(format!(
            "supa-lyrics-{}-{}",
            std::process::id(),
            plugin_sdk::now()
        ));
        let plain = LyricsView::Plain {
            text: "hello".into(),
        };
        write(&dir, "positive", &plain, 100).unwrap();
        assert_eq!(read(&dir, "positive", 999_999), Some(plain));
        write(&dir, "negative", &LyricsView::None, 100).unwrap();
        assert_eq!(
            read(&dir, "negative", 100 + NEGATIVE_TTL - 1),
            Some(LyricsView::None)
        );
        assert_eq!(read(&dir, "negative", 100 + NEGATIVE_TTL), None);
        fs::write(
            dir.join("old-negative.json"),
            br#"{"version":1,"fetchedAt":100,"result":{"kind":"none"}}"#,
        )
        .unwrap();
        assert_eq!(read(&dir, "old-negative", 100), None);
        fs::write(
            dir.join("old-positive.json"),
            br#"{"version":2,"fetchedAt":100,"result":{"kind":"instrumental"}}"#,
        )
        .unwrap();
        assert_eq!(
            read(&dir, "old-positive", 100),
            Some(LyricsView::Instrumental)
        );
        fs::write(
            dir.join("old-plain.json"),
            br#"{"version":2,"fetchedAt":100,"result":{"kind":"plain","text":"hello"}}"#,
        )
        .unwrap();
        assert_eq!(read(&dir, "old-plain", 100), None);
        fs::write(dir.join("positive.json"), b"broken").unwrap();
        assert_eq!(read(&dir, "positive", 100), None);
        write(&dir, "positive", &LyricsView::Instrumental, 100).unwrap();
        assert_eq!(read(&dir, "positive", 100), Some(LyricsView::Instrumental));
        fs::remove_dir_all(dir).unwrap();
    }
}
