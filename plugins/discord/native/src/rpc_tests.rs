use super::*;
use tokio::{io::AsyncReadExt, net::windows::named_pipe::ServerOptions};

#[tokio::test]
async fn interleaved_dispatch_and_ping_cannot_complete_the_wrong_request() {
    // This private endpoint never scans or connects to Discord's real pipes.
    let endpoint = format!(r"\\.\pipe\supa-discord-test-{}", std::process::id());
    let mut server = ServerOptions::new()
        .first_pipe_instance(true)
        .create(&endpoint)
        .unwrap();
    let pipe = ClientOptions::new().open(&endpoint).unwrap();
    let peer = tokio::spawn(async move {
        server.connect().await.unwrap();
        let mut buffer = Vec::new();
        let request = loop {
            if let Some((_, value)) = frame::decode(&mut buffer).unwrap() {
                break value;
            }
            let mut bytes = [0; 1024];
            let count = server.read(&mut bytes).await.unwrap();
            assert_ne!(count, 0);
            buffer.extend_from_slice(&bytes[..count]);
        };
        let frames = [
            frame::encode(3, &json!({"ping":1})).unwrap(),
            frame::encode(
                1,
                &json!({"cmd":"DISPATCH","evt":"VOICE_CHANNEL_SELECT","data":{"channel_id":null}}),
            )
            .unwrap(),
            frame::encode(
                1,
                &json!({"cmd":"GET_SELECTED_VOICE_CHANNEL","nonce":"stale","data":"wrong"}),
            )
            .unwrap(),
            frame::encode(
                1,
                &json!({"cmd":"GET_SELECTED_VOICE_CHANNEL","nonce":request["nonce"],"data":null}),
            )
            .unwrap(),
        ]
        .concat();
        // Exercise a split header as well as coalesced frames.
        server.write_all(&frames[..3]).await.unwrap();
        server.write_all(&frames[3..]).await.unwrap();
        let pong = loop {
            if let Some(frame) = frame::decode(&mut buffer).unwrap() {
                break frame;
            }
            let mut bytes = [0; 1024];
            let count = server.read(&mut bytes).await.unwrap();
            assert_ne!(count, 0);
            buffer.extend_from_slice(&bytes[..count]);
        };
        assert_eq!(pong, (4, json!({"ping":1})));
    });
    let mut rpc = Rpc {
        pipe,
        buffer: Vec::new(),
        nonce: 0,
        events: VecDeque::new(),
    };
    let response = rpc
        .request("GET_SELECTED_VOICE_CHANNEL", json!({}), None)
        .await
        .unwrap();
    assert!(response.is_null());
    assert_eq!(
        rpc.events.pop_front().unwrap()["evt"],
        "VOICE_CHANNEL_SELECT"
    );
    timeout(Duration::from_secs(5), peer)
        .await
        .unwrap()
        .unwrap();
}
