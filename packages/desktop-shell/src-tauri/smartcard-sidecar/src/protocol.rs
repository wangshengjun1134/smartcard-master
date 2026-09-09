/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

// Line-delimited JSON-RPC types shared by the sidecar main loop and tests.

use serde::{Deserialize, Serialize};

/// A single inbound request line: `{ "id": 1, "method": "...", "params": {} }`.
#[derive(Debug, Deserialize)]
pub struct Request {
    pub id: u64,
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

/// A successful outbound response line.
#[derive(Debug, Serialize)]
pub struct Response {
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Response {
    pub fn ok(id: u64, result: impl Serialize) -> Self {
        Self {
            id,
            result: Some(serde_json::to_value(result).unwrap_or_default()),
            error: None,
        }
    }

    pub fn err(id: u64, message: String) -> Self {
        Self {
            id,
            result: None,
            error: Some(message),
        }
    }
}

/// Parameters for the `transmit` method.
#[derive(Debug, Deserialize)]
pub struct TransmitParams {
    pub reader_id: String,
    pub apdu: ApduCommand,
}

/// A single APDU command.
#[derive(Debug, Deserialize)]
pub struct ApduCommand {
    pub cla: u8,
    pub ins: u8,
    pub p1: u8,
    pub p2: u8,
    #[serde(default)]
    pub data: Option<String>,
    #[serde(default)]
    pub le: Option<u8>,
}

/// Reader metadata returned by `list_readers`.
#[derive(Debug, Serialize)]
pub struct ReaderInfo {
    pub id: String,
    pub name: String,
}

/// APDU response returned by `transmit`.
#[derive(Debug, Serialize)]
pub struct ApduResponse {
    pub data: String,
    pub sw1: u8,
    pub sw2: u8,
    pub sw: u16,
}
