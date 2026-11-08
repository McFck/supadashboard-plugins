use super::Client;
use crate::VoiceCommand;
use serde_json::json;

pub(super) async fn execute(client: &mut Client, command: VoiceCommand) -> Result<(), String> {
    match command {
        VoiceCommand::ToggleMute | VoiceCommand::ToggleDeaf => {
            if client.voice.settings.is_none() {
                let settings = client.request("GET_VOICE_SETTINGS", json!({})).await?;
                client.voice = client.voice.event("VOICE_SETTINGS_UPDATE", &settings);
            }
            let (muted, deafened) = client
                .voice
                .settings
                .ok_or("Invalid Discord voice settings")?;
            let args = match command {
                VoiceCommand::ToggleMute => json!({"mute":!muted}),
                VoiceCommand::ToggleDeaf if deafened => {
                    // Like Discord: restore the mute from before deafening. While deafened Discord reports
                    // muted too, so an unknown earlier state (deafened before we connected) means unmuted.
                    json!({"deaf":false,"mute":client.mute_before_deaf.unwrap_or(false)})
                }
                VoiceCommand::ToggleDeaf => json!({"deaf":true}),
                _ => return Err("Invalid Discord voice command".into()),
            };
            client.request("SET_VOICE_SETTINGS", args).await?;
            if matches!(command, VoiceCommand::ToggleDeaf) {
                client.mute_before_deaf = if deafened { None } else { Some(muted) };
            }
            let settings = client.request("GET_VOICE_SETTINGS", json!({})).await?;
            client.voice = client.voice.event("VOICE_SETTINGS_UPDATE", &settings);
        }
        VoiceCommand::Leave => {
            // Already out of voice: the action's goal is met, so it is not an error.
            if client.voice.channel.is_none() {
                return Ok(());
            }
            client
                .request("SELECT_VOICE_CHANNEL", json!({"channel_id":null}))
                .await?;
            client.selected().await?;
        }
        VoiceCommand::Rejoin => {
            let channel = client
                .voice
                .last_channel
                .as_ref()
                .filter(|channel| channel.kind == "guild" && channel.valid())
                .ok_or("No channel to rejoin")?;
            if client.voice.channel.as_ref().map(|current| &current.id) == Some(&channel.id) {
                return Ok(());
            }
            client
                .request(
                    "SELECT_VOICE_CHANNEL",
                    json!({"channel_id":channel.id,"force":true,"timeout":5}),
                )
                .await?;
            client.selected().await?;
        }
    }
    Ok(())
}
