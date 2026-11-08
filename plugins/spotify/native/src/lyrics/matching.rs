use super::{LyricsView, Track, lrc};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Record {
    track_name: String,
    artist_name: String,
    #[serde(default)]
    album_name: Option<String>,
    duration: f64,
    instrumental: bool,
    plain_lyrics: Option<String>,
    synced_lyrics: Option<String>,
}

/// With an exact title and artist, a duration this far off (s) is still the song, in a cut with other
/// leading or trailing silence (a remaster, a re-upload).
const MAX_DISTANCE: f64 = 20.0;
/// Within this (ms) the recordings are taken as the same and the timestamps are used as they are.
const SAME_RECORDING_MS: i64 = 2000;
/// Beyond this (ms) the cuts differ by more than leading silence, so shifting would only guess; the timestamps
/// stay as they are and the per-song offset corrects them.
const MAX_SHIFT_MS: i64 = 8000;

impl Record {
    fn view(&self, duration_ms: u64) -> LyricsView {
        if self.instrumental {
            return LyricsView::Instrumental;
        }
        if let Some(text) = &self.synced_lyrics {
            let lines = lrc::parse(text);
            if !lines.is_empty() {
                // Seconds to ms; the duration is finite and within MAX_DISTANCE of a valid track here.
                let shift = duration_ms as i64 - (self.duration * 1000.0).round() as i64;
                return LyricsView::Synced {
                    lines: aligned(lines, shift),
                };
            }
        }
        if let Some(text) = &self.plain_lyrics
            && !text.trim().is_empty()
        {
            return LyricsView::Plain {
                text: text.chars().take(100_000).collect(),
            };
        }
        LyricsView::None
    }
}

/// Puts the whole duration difference into the leading silence, the usual difference between cuts.
/// What is left over, the user's sync offset corrects.
fn aligned(mut lines: Vec<lrc::Line>, shift_ms: i64) -> Vec<lrc::Line> {
    if shift_ms.abs() > SAME_RECORDING_MS && shift_ms.abs() <= MAX_SHIFT_MS {
        for line in &mut lines {
            line.at_ms = line.at_ms.saturating_add_signed(shift_ms);
        }
    }
    lines
}

fn unbracketed(value: &str) -> String {
    let mut depth = 0usize;
    let mut result = String::new();
    for character in value.chars() {
        match character {
            '(' | '[' => {
                depth += 1;
                result.push(' ');
            }
            ')' | ']' => {
                depth = depth.saturating_sub(1);
            }
            _ if depth == 0 => result.push(character),
            _ => {}
        }
    }
    result
}

fn words(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_alphanumeric() {
                character
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub(super) fn normalized(title: &str, artist: &str) -> (String, String) {
    let clean = |value: &str| {
        let mut value = unbracketed(&value.to_lowercase());
        for marker in [" feat.", " feat ", " ft.", " ft ", " featuring "] {
            if let Some(at) = value.find(marker) {
                value.truncate(at);
            }
        }
        value
    };
    let mut title = clean(title);
    for separator in [" - ", " – ", " — "] {
        if let Some((base, suffix)) = title.rsplit_once(separator)
            && (suffix.contains("remaster") || suffix.trim().ends_with("version"))
        {
            title = base.into();
        }
    }
    let artist = clean(artist);
    let artist = artist.split([',', ';', '&']).next().unwrap_or_default();
    (words(&title), words(artist))
}

/// The best of all candidates: the duration tier, then the exact title and album, then synced over instrumental
/// over plain, then the closest duration.
pub(super) fn pick(records: &[Record], track: &Track) -> LyricsView {
    let identity = normalized(&track.title, &track.artist);
    if identity.0.is_empty() || identity.1.is_empty() {
        return LyricsView::None;
    }
    records
        .iter()
        .filter(|record| normalized(&record.track_name, &record.artist_name) == identity)
        .filter_map(|record| {
            let distance = (record.duration - track.duration_ms as f64 / 1000.0).abs();
            if !record.duration.is_finite() || distance > MAX_DISTANCE {
                return None;
            }
            // The same recording, then a cut whose shift is trusted, then one whose timing stays as it is.
            let tier = [SAME_RECORDING_MS, MAX_SHIFT_MS]
                .iter()
                .take_while(|limit| distance * 1000.0 > **limit as f64)
                .count();
            let same = |a: &str, b: &str| a.trim().to_lowercase() == b.trim().to_lowercase();
            let inexact = !(same(&record.track_name, &track.title)
                && same(
                    record.album_name.as_deref().unwrap_or_default(),
                    &track.album,
                ));
            let view = record.view(track.duration_ms);
            let rank = match view {
                LyricsView::Synced { .. } => 0,
                LyricsView::Instrumental => 1,
                LyricsView::Plain { .. } => 2,
                LyricsView::None => return None,
            };
            // Synced lyrics win over plain ones from a closer cut: the per-song offset fixes the remaining shift.
            Some(((rank, tier, inexact), distance, view))
        })
        .min_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.total_cmp(&b.1)))
        .map(|(_, _, view)| view)
        .unwrap_or(LyricsView::None)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn record(title: &str, artist: &str, duration: f64, synced: bool) -> Record {
        Record {
            track_name: title.into(),
            artist_name: artist.into(),
            album_name: None,
            duration,
            instrumental: false,
            plain_lyrics: Some("plain".into()),
            synced_lyrics: synced.then(|| "[00:10.00]line".into()),
        }
    }
    fn first_line_ms(view: LyricsView) -> Option<u64> {
        match view {
            LyricsView::Synced { lines } => Some(lines[0].at_ms),
            _ => None,
        }
    }
    #[test]
    fn prefers_synced_lyrics_then_the_closest_cut_and_exact_album_and_aligns_other_cuts() {
        let track = Track::new(
            "Sizor".into(),
            "Холодные стены".into(),
            "Холодные стены".into(),
            195_863,
        )
        .unwrap();
        let records = [
            record("Холодные стены", "Sizor", 188.0, true),
            record("Холодные стены", "Sizor", 196.0, false),
            record("Холодные стены", "Sizor", 201.0, true),
        ];
        // LRCLIB's 201 s cut is 5.137 s longer, so its lines come that much earlier.
        assert_eq!(
            first_line_ms(pick(
                &[
                    record("Холодные стены", "Sizor", 188.0, true),
                    record("Холодные стены", "Sizor", 201.0, true)
                ],
                &track
            )),
            Some(4_863)
        );
        assert_eq!(first_line_ms(pick(&records[..1], &track)), Some(17_863));
        // Synced lyrics from another cut win over plain lyrics from the same recording.
        assert_eq!(first_line_ms(pick(&records, &track)), Some(4_863));
        let mut album = record("Холодные стены", "Sizor", 196.5, true);
        album.synced_lyrics = Some("[00:01.00]album".into());
        album.album_name = Some("холодные стены".into());
        let other = || record("Холодные стены", "Sizor", 196.0, true);
        assert_eq!(first_line_ms(pick(&[other(), album], &track)), Some(1_000));
        let mut plain = other();
        plain.synced_lyrics = None;
        assert_eq!(first_line_ms(pick(&[plain, other()], &track)), Some(10_000));
    }
    #[test]
    fn matches_cyrillic_case_and_collaborators_without_accepting_other_songs() {
        let track = Track::new(
            "SIZOR feat. Гость".into(),
            "ХОЛОДНЫЕ СТЕНЫ (feat. Гость) [Deluxe] - Remastered 2024".into(),
            "Another album".into(),
            196_000,
        )
        .unwrap();
        assert_eq!(
            normalized(&track.title, &track.artist),
            ("холодные стены".into(), "sizor".into())
        );
        assert_eq!(
            normalized("ПЕСНЯ [2024]", "ГРУППА, Гость"),
            ("песня".into(), "группа".into())
        );
        assert!(matches!(
            pick(
                &[
                    record("Другие стены", "Sizor", 196.0, true),
                    record("Холодные стены", "Другой", 196.0, true),
                    record("Холодные стены", "Sizor", 197.0, true),
                    record("Холодные стены", "Sizor", 196.0, false)
                ],
                &track
            ),
            LyricsView::Synced { .. }
        ));
        assert_eq!(
            pick(
                &[
                    record("Другие стены", "Sizor", 196.0, true),
                    record("Холодные стены", "Другой", 196.0, true)
                ],
                &track
            ),
            LyricsView::None
        );
    }
    #[test]
    fn keeps_timestamps_of_the_same_recording_and_bounds_other_cuts() {
        let track = Track::new("Artist".into(), "Song".into(), "".into(), 100_000).unwrap();
        let same = [record("Song", "Artist", 101.5, true)];
        assert_eq!(first_line_ms(pick(&same, &track)), Some(10_000));
        let early = [record("Song", "Artist", 107.5, true)];
        assert_eq!(first_line_ms(pick(&early, &track)), Some(2_500));
        // A gap beyond what leading silence explains keeps the timestamps for the per-song offset to fix.
        let far_cut = [record("Song", "Artist", 115.0, true)];
        assert_eq!(first_line_ms(pick(&far_cut, &track)), Some(10_000));
        let mut far = record("Song", "Artist", 120.5, true);
        far.plain_lyrics = None;
        assert_eq!(pick(&[far], &track), LyricsView::None);
        assert_eq!(
            pick(&[record("Song", "Artist", 80.0, false)], &track),
            LyricsView::Plain {
                text: "plain".into()
            }
        );
        assert_eq!(
            pick(&[record("Song", "Artist", f64::NAN, true)], &track),
            LyricsView::None
        );
        let mut instrumental = record("Song", "Artist", 100.0, false);
        instrumental.instrumental = true;
        assert_eq!(pick(&[instrumental], &track), LyricsView::Instrumental);
    }
}
