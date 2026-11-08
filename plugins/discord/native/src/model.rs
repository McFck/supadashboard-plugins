use serde::{Deserialize, Serialize};
use serde_json::Value;

pub fn valid_id(id: &str) -> bool {
    (17..=20).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_digit())
}

fn name(value: &str) -> String {
    value
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(64)
        .collect()
}

fn avatar(hash: &str) -> bool {
    let hash = hash.strip_prefix("a_").unwrap_or(hash);
    hash.len() == 32
        && hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guild_id: Option<String>,
}

impl Channel {
    pub fn valid(&self) -> bool {
        valid_id(&self.id)
            && !self.name.is_empty()
            && self.name == name(&self.name)
            && matches!(self.kind.as_str(), "guild" | "dm")
            && self.guild_id.as_ref().is_none_or(|id| valid_id(id))
    }
}

#[derive(Clone, Serialize)]
pub struct User {
    pub id: String,
    pub name: String,
}

#[derive(Deserialize)]
struct RpcUser {
    id: String,
    username: String,
    global_name: Option<String>,
    avatar: Option<String>,
    discriminator: String,
}

impl RpcUser {
    fn view(&self) -> Option<User> {
        if !valid_id(&self.id) {
            return None;
        }
        let name = name(
            self.global_name
                .as_deref()
                .filter(|name| !name.trim().is_empty())
                .unwrap_or(&self.username),
        );
        if name.is_empty() {
            return None;
        }
        Some(User {
            id: self.id.clone(),
            name,
        })
    }
}

pub fn user(value: &Value) -> Option<User> {
    serde_json::from_value::<RpcUser>(value.clone())
        .ok()?
        .view()
}

#[derive(Clone, Serialize)]
pub struct Member {
    pub id: String,
    pub name: String,
    pub avatar: Option<String>,
    pub discriminator: String,
    pub speaking: bool,
    pub muted: bool,
    pub deafened: bool,
}

#[derive(Deserialize)]
struct VoiceFlags {
    mute: bool,
    deaf: bool,
    self_mute: bool,
    self_deaf: bool,
    suppress: bool,
}

#[derive(Deserialize)]
struct RpcMember {
    user: RpcUser,
    nick: Option<String>,
    mute: bool,
    voice_state: VoiceFlags,
}

pub fn member(data: &Value) -> Option<Member> {
    let raw: RpcMember = serde_json::from_value(data.clone()).ok()?;
    let user = raw.user.view()?;
    let nick = name(raw.nick.as_deref().unwrap_or(""));
    let discriminator = raw.user.discriminator;
    if discriminator.len() > 4
        || discriminator.is_empty()
        || !discriminator.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let voice = raw.voice_state;
    Some(Member {
        id: user.id,
        name: if nick.is_empty() { user.name } else { nick },
        avatar: raw.user.avatar.filter(|hash| avatar(hash)),
        discriminator,
        speaking: false,
        muted: raw.mute || voice.mute || voice.self_mute || voice.suppress,
        deafened: voice.deaf || voice.self_deaf,
    })
}

#[derive(Deserialize)]
struct RpcChannel {
    id: String,
    name: Option<String>,
    #[serde(rename = "type")]
    kind: u8,
    guild_id: Option<String>,
    voice_states: Vec<Value>,
}

pub fn selected(data: &Value) -> Result<(Option<Channel>, Vec<Member>), String> {
    if data.is_null() {
        return Ok((None, Vec::new()));
    }
    let raw: RpcChannel =
        serde_json::from_value(data.clone()).map_err(|_| "Invalid Discord channel")?;
    let kind = match raw.kind {
        2 | 13 => "guild",
        1 | 3 => "dm",
        _ => return Err("Invalid Discord channel type".into()),
    };
    let channel = Channel {
        id: raw.id,
        name: name(
            raw.name
                .as_deref()
                .filter(|name| !name.trim().is_empty())
                .unwrap_or(if kind == "dm" { "Voice call" } else { "" }),
        ),
        kind: kind.into(),
        guild_id: raw.guild_id,
    };
    if !channel.valid() {
        return Err("Invalid Discord channel".into());
    }
    Ok((
        Some(channel),
        raw.voice_states
            .iter()
            .filter_map(member)
            .take(99)
            .collect(),
    ))
}
