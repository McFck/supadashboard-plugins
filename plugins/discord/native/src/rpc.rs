use super::frame;
use serde_json::{Value, json};
use std::{collections::VecDeque, time::Duration};
use tokio::{
    io::AsyncWriteExt,
    net::windows::named_pipe::{ClientOptions, NamedPipeClient},
    time::timeout,
};

pub struct Rpc {
    pipe: NamedPipeClient,
    buffer: Vec<u8>,
    nonce: u64,
    pub events: VecDeque<Value>,
}

#[cfg(test)]
#[path = "rpc_tests.rs"]
mod tests;

impl Rpc {
    pub async fn connect(client_id: &str) -> Result<Self, String> {
        let pipe = (0..10)
            .find_map(|index| {
                ClientOptions::new()
                    .open(format!(r"\\.\pipe\discord-ipc-{index}"))
                    .ok()
            })
            .ok_or("Discord isn't running")?;
        let mut rpc = Self {
            pipe,
            buffer: Vec::new(),
            nonce: 0,
            events: VecDeque::new(),
        };
        rpc.write(0, &json!({"v":1,"client_id":client_id})).await?;
        let ready = timeout(Duration::from_secs(10), rpc.next())
            .await
            .map_err(|_| "Discord handshake timed out")??;
        if ready["cmd"] != "DISPATCH" || ready["evt"] != "READY" {
            return Err("Invalid Discord handshake".into());
        }
        Ok(rpc)
    }

    async fn write(&mut self, op: u32, value: &Value) -> Result<(), String> {
        let bytes = frame::encode(op, value)?;
        timeout(Duration::from_secs(10), self.pipe.write_all(&bytes))
            .await
            .map_err(|_| "Discord write timed out")?
            .map_err(|_| "Discord connection closed".into())
    }

    /// Cancellation safe: bytes are consumed only by try_read, into the persistent buffer.
    pub async fn receive(&mut self) -> Result<(u32, Value), String> {
        loop {
            if let Some((op, value)) = frame::decode(&mut self.buffer)? {
                return Ok((op, value));
            } else {
                self.pipe
                    .readable()
                    .await
                    .map_err(|_| "Discord connection closed")?;
                let mut bytes = [0u8; 8192];
                match self.pipe.try_read(&mut bytes) {
                    Ok(0) => return Err("Discord connection closed".into()),
                    Ok(size) => self.buffer.extend_from_slice(&bytes[..size]),
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(_) => return Err("Discord connection closed".into()),
                }
            }
        }
    }

    pub async fn pong(&mut self, value: &Value) -> Result<(), String> {
        self.write(4, value).await
    }

    async fn next(&mut self) -> Result<Value, String> {
        loop {
            let (op, value) = self.receive().await?;
            match op {
                1 => return Ok(value),
                2 => return Err("Discord connection closed".into()),
                3 => self.pong(&value).await?,
                4 => {}
                _ => return Err("Unexpected Discord handshake".into()),
            }
        }
    }

    pub async fn request(
        &mut self,
        cmd: &str,
        args: Value,
        event: Option<&str>,
    ) -> Result<Value, String> {
        self.nonce = self.nonce.checked_add(1).ok_or("Discord nonce exhausted")?;
        let nonce = self.nonce.to_string();
        let mut request = json!({"cmd":cmd,"args":args,"nonce":nonce});
        if let Some(event) = event {
            request["evt"] = json!(event);
        }
        self.write(1, &request).await?;
        let duration = if cmd == "AUTHORIZE" { 120 } else { 15 };
        timeout(Duration::from_secs(duration), async {
            loop {
                let reply = self.next().await?;
                if reply["nonce"].as_str() == Some(&nonce) {
                    if reply["evt"] == "ERROR" {
                        return Err(format!("Discord rejected {cmd}"));
                    }
                    if reply["cmd"] != cmd || reply.get("data").is_none() {
                        return Err("Invalid Discord reply".into());
                    }
                    return Ok(reply["data"].clone());
                }
                if reply["cmd"] == "DISPATCH" {
                    if self.events.len() >= 512 {
                        return Err("Discord event queue overflow".into());
                    }
                    self.events.push_back(reply);
                }
            }
        })
        .await
        .map_err(|_| "Discord request timed out")?
    }
}
