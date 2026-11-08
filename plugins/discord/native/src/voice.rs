use super::model::{self, Channel, Member, User, member};
use serde_json::{Value, json};

#[derive(Clone, Default)]
pub struct VoiceState {
    pub user: Option<User>,
    pub channel: Option<Channel>,
    pub last_channel: Option<Channel>,
    pub members: Vec<Member>,
    pub settings: Option<(bool, bool)>,
}

impl VoiceState {
    /// Rebuild from GET_SELECTED_VOICE_CHANNEL; preserve ordering and speaking across snapshots.
    pub fn selected(&self, data: &Value) -> Result<Self, String> {
        let (channel, incoming) = model::selected(data)?;
        let mut next = self.clone();
        if self.channel.as_ref().map(|c| &c.id) != channel.as_ref().map(|c| &c.id) {
            if let Some(previous) = self.channel.as_ref().filter(|c| c.kind == "guild") {
                next.last_channel = Some(previous.clone());
            }
            next.members.clear();
        }
        next.members
            .retain(|old| incoming.iter().any(|m| m.id == old.id));
        for mut item in incoming {
            if let Some(old) = next.members.iter_mut().find(|m| m.id == item.id) {
                item.speaking = old.speaking;
                *old = item;
            } else {
                next.members.push(item);
            }
        }
        next.channel = channel;
        Ok(next)
    }

    pub fn event(&self, event: &str, data: &Value) -> Self {
        let mut next = self.clone();
        if !data.is_object() || (event != "VOICE_SETTINGS_UPDATE" && self.channel.is_none()) {
            return next;
        }
        if let Some(channel_id) = data["channel_id"].as_str()
            && self
                .channel
                .as_ref()
                .is_none_or(|channel| channel.id != channel_id)
        {
            return next;
        }
        match event {
            "VOICE_SETTINGS_UPDATE" => {
                if let (Some(mute), Some(deaf)) = (data["mute"].as_bool(), data["deaf"].as_bool()) {
                    next.settings = Some((mute, deaf));
                }
            }
            "SPEAKING_START" | "SPEAKING_STOP" => {
                if let Some(item) = next
                    .members
                    .iter_mut()
                    .find(|m| Some(m.id.as_str()) == data["user_id"].as_str())
                {
                    item.speaking = event == "SPEAKING_START";
                }
            }
            "VOICE_STATE_CREATE" | "VOICE_STATE_UPDATE" => {
                if let Some(mut item) = member(data) {
                    if let Some(old) = next.members.iter_mut().find(|m| m.id == item.id) {
                        item.speaking = old.speaking;
                        *old = item;
                    } else if next.members.len() < 99 {
                        next.members.push(item);
                    }
                }
            }
            "VOICE_STATE_DELETE" => next
                .members
                .retain(|m| Some(m.id.as_str()) != data["user"]["id"].as_str()),
            _ => {}
        }
        next
    }

    pub fn view(&self) -> Value {
        let Some(user) = &self.user else {
            return json!({"state":"needsAuth"});
        };
        let (muted, deafened) = self.settings.unwrap_or((false, false));
        let mut view = json!({"state":if self.channel.is_some() { "inVoice" } else { "idle" }, "user":user, "muted":muted,"deafened":deafened});
        if let Some(channel) = &self.channel {
            view["channel"] = json!(channel);
            view["members"] = json!(self.members);
        }
        if let Some(channel) = &self.last_channel {
            view["lastChannel"] = json!(channel);
        }
        view
    }
}

pub const CHANNEL_EVENTS: [&str; 5] = [
    "VOICE_STATE_CREATE",
    "VOICE_STATE_UPDATE",
    "VOICE_STATE_DELETE",
    "SPEAKING_START",
    "SPEAKING_STOP",
];

pub fn subscriptions(
    old: Option<&Channel>,
    new: Option<&Channel>,
) -> Vec<(&'static str, &'static str, String)> {
    if old.map(|c| &c.id) == new.map(|c| &c.id) {
        return Vec::new();
    }
    let mut commands = Vec::new();
    for (cmd, channel) in [("UNSUBSCRIBE", old), ("SUBSCRIBE", new)] {
        if let Some(channel) = channel {
            for event in CHANNEL_EVENTS {
                commands.push((cmd, event, channel.id.clone()));
            }
        }
    }
    commands
}

#[cfg(test)]
#[path = "voice_tests.rs"]
mod tests;
