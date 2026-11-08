use serde_json::Value;

pub const MAX_BODY: usize = 65_536;

pub fn encode(op: u32, value: &Value) -> Result<Vec<u8>, String> {
    let body = serde_json::to_vec(value).map_err(|_| "Invalid Discord frame")?;
    if op > 4 || body.len() > MAX_BODY {
        return Err("Invalid Discord frame".into());
    }
    let mut bytes = Vec::with_capacity(8 + body.len());
    bytes.extend(op.to_le_bytes());
    bytes.extend((body.len() as u32).to_le_bytes());
    bytes.extend(body);
    Ok(bytes)
}

/// Incomplete frames remain buffered; invalid frames terminate the connection.
pub fn decode(bytes: &mut Vec<u8>) -> Result<Option<(u32, Value)>, String> {
    if bytes.len() < 8 {
        return Ok(None);
    }
    let op = u32::from_le_bytes(bytes[0..4].try_into().map_err(|_| "Invalid header")?);
    let len = u32::from_le_bytes(bytes[4..8].try_into().map_err(|_| "Invalid header")?) as usize;
    if op > 4 || len > MAX_BODY {
        return Err("Invalid Discord frame".into());
    }
    if bytes.len() < 8 + len {
        return Ok(None);
    }
    let value = serde_json::from_slice(&bytes[8..8 + len]).map_err(|_| "Invalid Discord JSON")?;
    bytes.drain(..8 + len);
    Ok(Some((op, value)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn fragmented_and_coalesced_frames_keep_their_boundaries() {
        let frame = encode(1, &json!({"cmd":"DISPATCH","evt":"READY"})).unwrap();
        let mut buffer = frame[..10].to_vec();
        assert!(decode(&mut buffer).unwrap().is_none());
        buffer.extend(&frame[10..]);
        buffer.extend(&frame);
        assert_eq!(decode(&mut buffer).unwrap().unwrap().1["evt"], "READY");
        assert!(decode(&mut buffer).unwrap().is_some());
        assert!(buffer.is_empty());
    }

    #[test]
    fn rejects_oversized_bad_opcode_and_invalid_utf8_frames() {
        for (op, len, body) in [(1u32, 65_537u32, vec![]), (5, 0, vec![]), (1, 1, vec![255])] {
            let mut bytes = [op.to_le_bytes().to_vec(), len.to_le_bytes().to_vec(), body].concat();
            assert!(decode(&mut bytes).is_err());
        }
    }
}
