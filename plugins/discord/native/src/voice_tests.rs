use super::*;

// T0's GET_SELECTED_VOICE_CHANNEL structure, with synthetic ids and names.
fn channel(id: &str) -> Value {
    json!({"id":id,"name":"Voice","type":2,"guild_id":"323456789012345678", "voice_states":[{
        "nick":" Alice ","mute":false,"volume":100,"pan":{"left":1,"right":1},
        "voice_state":{"mute":false,"deaf":false,"self_mute":true,"self_deaf":false,"suppress":false},
        "user":{"id":"123456789012345678","username":"alice","discriminator":"0","global_name":null,"avatar":"a_0123456789abcdef0123456789abcdef"}
    }]})
}

#[test]
fn join_speaking_leave_and_switch_preserve_state_and_subscriptions() {
    let state = VoiceState::default()
        .selected(&channel("223456789012345678"))
        .unwrap();
    assert_eq!(state.members[0].name, "Alice");
    assert!(state.members[0].muted);
    assert_eq!(subscriptions(None, state.channel.as_ref()).len(), 5);
    let mut newcomer = channel("223456789012345678")["voice_states"][0].clone();
    newcomer["user"]["id"] = json!("423456789012345678");
    let state = state.event("VOICE_STATE_CREATE", &newcomer);
    assert_eq!(state.members.len(), 2);
    let speaking = json!({"user_id":"423456789012345678"});
    let state = state.event("SPEAKING_START", &speaking);
    assert!(state.members[1].speaking);
    let state = state.event("SPEAKING_STOP", &speaking);
    assert!(!state.members[1].speaking);
    let switched = state.selected(&channel("523456789012345678")).unwrap();
    let commands = subscriptions(state.channel.as_ref(), switched.channel.as_ref());
    assert_eq!(commands.len(), 10);
    assert!(
        commands[..5]
            .iter()
            .all(|c| c.0 == "UNSUBSCRIBE" && c.2 == "223456789012345678")
    );
    let left = switched.selected(&Value::Null).unwrap();
    assert!(left.channel.is_none());
    assert!(left.members.is_empty());
    assert_eq!(left.last_channel.unwrap().id, "523456789012345678");
}

#[test]
fn invalid_members_and_avatar_hashes_cannot_cross_the_view_boundary() {
    let mut raw = channel("223456789012345678");
    raw["voice_states"][0]["user"]["avatar"] = json!("../../bad");
    let state = VoiceState::default().selected(&raw).unwrap();
    assert!(state.members[0].avatar.is_none());
    raw["voice_states"][0]["user"]["id"] = json!("invalid");
    assert!(state.selected(&raw).unwrap().members.is_empty());
    raw["voice_states"][0]["user"]["id"] = json!("123456789012345678");
    raw["voice_states"][0]["voice_state"]["mute"] = json!("invalid");
    assert!(state.selected(&raw).unwrap().members.is_empty());
    raw["id"] = json!("invalid");
    assert!(state.selected(&raw).is_err());
}

#[test]
fn dm_calls_do_not_replace_guild_rejoin_and_stale_events_are_ignored() {
    let state = VoiceState::default()
        .selected(&channel("223456789012345678"))
        .unwrap();
    let state = state.event(
        "SPEAKING_START",
        &json!({"channel_id":"999456789012345678","user_id":"123456789012345678"}),
    );
    assert!(!state.members[0].speaking);
    let mut dm = channel("523456789012345678");
    dm["type"] = json!(1);
    dm["guild_id"] = Value::Null;
    dm["name"] = Value::Null;
    let state = state.selected(&dm).unwrap().selected(&Value::Null).unwrap();
    assert_eq!(state.last_channel.unwrap().id, "223456789012345678");
}
