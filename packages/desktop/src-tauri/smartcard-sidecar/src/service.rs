/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

// PC/SC access via the `pcsc` crate. The sidecar keeps a single card
// connection at a time (single-card desktop model).

use pcsc::{Card, Context, Disposition, Protocols, Scope, ShareMode, MAX_BUFFER_SIZE};
use std::ffi::CString;

use crate::protocol::{ApduCommand, ApduResponse, ReaderInfo};

pub struct SmartCardService {
    ctx: Context,
    card: Option<Card>,
    reader_id: Option<String>,
}

impl SmartCardService {
    pub fn new() -> Result<Self, String> {
        let ctx = Context::establish(Scope::User)
            .map_err(|error| format!("Failed to establish PC/SC context: {error}"))?;
        Ok(Self {
            ctx,
            card: None,
            reader_id: None,
        })
    }

    pub fn list_readers(&self) -> Result<Vec<ReaderInfo>, String> {
        let readers = self
            .ctx
            .list_readers_owned()
            .map_err(|error| format!("Failed to list readers: {error}"))?;
        Ok(readers
            .into_iter()
            .map(|name| {
                let id = name.to_string_lossy().into_owned();
                ReaderInfo {
                    name: id.clone(),
                    id,
                }
            })
            .collect())
    }

    pub fn connect(&mut self, reader_id: &str) -> Result<String, String> {
        self.disconnect()?;
        let reader = CString::new(reader_id)
            .map_err(|_| "Reader id contains a NUL byte.".to_string())?;
        let card = self
            .ctx
            .connect(&reader, ShareMode::Shared, Protocols::ANY)
            .map_err(|error| format!("Failed to connect to reader {reader_id}: {error}"))?;
        let atr = atr_of(&card)?;
        self.reader_id = Some(reader_id.to_string());
        self.card = Some(card);
        Ok(atr)
    }

    pub fn disconnect(&mut self) -> Result<(), String> {
        if let Some(card) = self.card.take() {
            card.disconnect(Disposition::LeaveCard)
                .map_err(|(_card, error)| format!("Failed to disconnect: {error}"))?;
        }
        self.reader_id = None;
        Ok(())
    }

    pub fn reset(&mut self, reader_id: &str) -> Result<String, String> {
        let card = self.card.as_mut().ok_or_else(|| {
            format!("No active card. Connect to reader {reader_id} first.")
        })?;
        card.reconnect(ShareMode::Shared, Protocols::ANY, Disposition::ResetCard)
            .map_err(|error| format!("Failed to reset card: {error}"))?;
        atr_of(card)
    }

    pub fn transmit(&self, reader_id: &str, apdu: &ApduCommand) -> Result<ApduResponse, String> {
        let card = self.card.as_ref().ok_or_else(|| {
            format!("No active card. Connect to reader {reader_id} first.")
        })?;
        let command = build_apdu(apdu);
        let mut buffer = [0u8; MAX_BUFFER_SIZE];
        let response = card
            .transmit(&command, &mut buffer)
            .map_err(|error| format!("Failed to transmit APDU: {error}"))?;
        Ok(parse_response(response))
    }
}

fn atr_of(card: &Card) -> Result<String, String> {
    let status = card
        .status2_owned()
        .map_err(|error| format!("Failed to read card status: {error}"))?;
    Ok(hex_encode(status.atr()))
}

fn build_apdu(apdu: &ApduCommand) -> Vec<u8> {
    let mut bytes = vec![apdu.cla, apdu.ins, apdu.p1, apdu.p2];
    match (&apdu.data, apdu.le) {
        (Some(data), Some(le)) => {
            let data = hex_decode(data);
            bytes.push(data.len() as u8);
            bytes.extend_from_slice(&data);
            bytes.push(le);
        }
        (Some(data), None) => {
            let data = hex_decode(data);
            bytes.push(data.len() as u8);
            bytes.extend_from_slice(&data);
        }
        (None, Some(le)) => {
            bytes.push(le);
        }
        (None, None) => {}
    }
    bytes
}

fn parse_response(response: &[u8]) -> ApduResponse {
    let length = response.len();
    let sw2 = if length > 0 { response[length - 1] } else { 0 };
    let sw1 = if length > 1 { response[length - 2] } else { 0 };
    let data_len = length.saturating_sub(2);
    ApduResponse {
        data: hex_encode(&response[..data_len]),
        sw1,
        sw2,
        sw: ((sw1 as u16) << 8) | sw2 as u16,
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02X}"));
    }
    out
}

fn hex_decode(hex: &str) -> Vec<u8> {
    let cleaned: String = hex.chars().filter(|c| !c.is_whitespace()).collect();
    let mut bytes = Vec::with_capacity(cleaned.len() / 2);
    let chars: Vec<char> = cleaned.chars().collect();
    let mut i = 0;
    while i + 1 < chars.len() {
        let hi = chars[i].to_digit(16).unwrap_or(0) as u8;
        let lo = chars[i + 1].to_digit(16).unwrap_or(0) as u8;
        bytes.push((hi << 4) | lo);
        i += 2;
    }
    bytes
}
