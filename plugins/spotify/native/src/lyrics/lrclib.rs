use super::{
    LyricsView, Track,
    matching::{Record, normalized, pick},
};
use plugin_sdk::http;
use std::time::Duration;

#[derive(Default)]
pub(super) struct Client {
    retry_at: Option<tokio::time::Instant>,
}

impl Client {
    async fn request(
        &mut self,
        path: &str,
        fields: &[(&str, &str)],
    ) -> Result<http::Response, String> {
        let url = format!("https://lrclib.net/api/{path}?{}", http::form(fields));
        for attempt in 0..2 {
            if let Some(at) = self.retry_at {
                if at.saturating_duration_since(tokio::time::Instant::now())
                    > Duration::from_secs(60)
                {
                    return Err("Lyrics rate limited".into());
                }
                tokio::time::sleep_until(at).await;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
            let response = http::send(
                "GET",
                &url,
                &[(
                    "User-Agent",
                    concat!("SupaDashboard/", env!("CARGO_PKG_VERSION")),
                )],
                None,
            )
            .await?;
            if response.status != 429 {
                return Ok(response);
            }
            let delay = response
                .retry_after
                .as_deref()
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(60);
            // Keep the server cooldown across tracks without holding a tile request indefinitely.
            self.retry_at =
                tokio::time::Instant::now().checked_add(Duration::from_secs(delay.max(1)));
            if self.retry_at.is_none() {
                self.retry_at = tokio::time::Instant::now().checked_add(Duration::from_secs(86400));
            }
            if attempt == 1 {
                break;
            }
        }
        Err("Lyrics rate limited".into())
    }

    pub(super) async fn fetch(&mut self, track: &Track) -> Result<LyricsView, String> {
        let duration = track.duration.to_string();
        let response = self
            .request(
                "get",
                &[
                    ("track_name", &track.title),
                    ("artist_name", &track.artist),
                    ("album_name", &track.album),
                    ("duration", &duration),
                ],
            )
            .await?;
        // Every candidate is kept, so a plain or farther match never hides a synced one found later.
        let mut records = Vec::new();
        if response.status == 200 {
            records.push(
                serde_json::from_str::<Record>(&response.body)
                    .map_err(|_| "Invalid lyrics response")?,
            );
            if let view @ LyricsView::Synced { .. } = pick(&records, track) {
                return Ok(view);
            }
        } else if response.status != 404 {
            return Err("Lyrics unavailable".into());
        }
        let (title, artist) = normalized(&track.title, &track.artist);
        let query = format!("{title} {artist}");
        for fields in [
            vec![
                ("track_name", title.as_str()),
                ("artist_name", artist.as_str()),
            ],
            vec![("q", query.as_str())],
        ] {
            let response = self.request("search", &fields).await?;
            if response.status != 200 {
                return Err("Lyrics unavailable".into());
            }
            records.extend(
                serde_json::from_str::<Vec<Record>>(&response.body)
                    .map_err(|_| "Invalid lyrics response")?,
            );
            if let view @ LyricsView::Synced { .. } = pick(&records, track) {
                return Ok(view);
            }
        }
        Ok(pick(&records, track))
    }
}
