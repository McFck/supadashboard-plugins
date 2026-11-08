use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    pub at_ms: u64,
    pub text: String,
}

fn timestamp(tag: &str) -> Option<u64> {
    let (minutes, seconds) = tag.split_once(':')?;
    if minutes.is_empty() || !minutes.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let (seconds, fraction) = seconds.split_once('.').unwrap_or((seconds, ""));
    if seconds.len() != 2
        || !seconds.bytes().all(|b| b.is_ascii_digit())
        || fraction.len() > 3
        || !fraction.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let seconds: u64 = seconds.parse().ok()?;
    if seconds >= 60 {
        return None;
    }
    let millis = if fraction.is_empty() {
        0
    } else {
        fraction.parse::<u64>().ok()? * 10u64.pow(3 - fraction.len() as u32)
    };
    minutes
        .parse::<u64>()
        .ok()?
        .checked_mul(60_000)?
        .checked_add(seconds * 1000 + millis)
}

pub fn parse(text: &str) -> Vec<Line> {
    let mut lines = Vec::new();
    let mut offset = 0i64;
    for raw in text.lines() {
        let mut rest = raw.trim();
        let mut stamps = Vec::new();
        while let Some(tagged) = rest.strip_prefix('[') {
            let Some((tag, tail)) = tagged.split_once(']') else {
                break;
            };
            if let Some(value) = tag.strip_prefix("offset:") {
                if let Ok(value) = value.parse::<i64>() {
                    offset = value;
                }
            } else if let Some(stamp) = timestamp(tag) {
                stamps.push(stamp);
            }
            rest = tail;
        }
        for at_ms in stamps {
            if lines.len() >= 2000 {
                break;
            }
            lines.push(Line {
                at_ms,
                text: rest.trim().chars().take(500).collect(),
            });
        }
    }
    for line in &mut lines {
        line.at_ms = line.at_ms.saturating_add_signed(offset);
    }
    lines.sort_by_key(|line| line.at_ms);
    lines
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_gaps_multiple_stamps_and_global_offset_while_dropping_bad_tags() {
        let lines = parse(
            "[ar:Artist]\n[00:03.123][00:01.2]hello\n[00:02.00]\n[00:60]bad\n[xx:12]bad\n[offset:-200]",
        );
        assert_eq!(
            lines,
            vec![
                Line {
                    at_ms: 1000,
                    text: "hello".into()
                },
                Line {
                    at_ms: 1800,
                    text: "".into()
                },
                Line {
                    at_ms: 2923,
                    text: "hello".into()
                }
            ]
        );
        assert_eq!(parse("[00:00.01]x\n[offset:-200]")[0].at_ms, 0);
    }
    #[test]
    fn bounds_untrusted_lyrics() {
        let lines = parse(&format!("[00:01]{}\n", "é".repeat(600)).repeat(2100));
        assert_eq!(lines.len(), 2000);
        assert!(lines.iter().all(|line| line.text.chars().count() == 500));
    }
}
