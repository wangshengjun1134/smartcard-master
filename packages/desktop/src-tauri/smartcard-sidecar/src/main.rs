/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

// Stdio JSON-RPC entry point. Reads one request per line from stdin, writes
// one response per line to stdout.

mod protocol;
mod service;

use std::io::{self, BufRead, Write};

use protocol::{Request, Response, TransmitParams};
use service::SmartCardService;

fn main() {
    let mut service = match SmartCardService::new() {
        Ok(service) => service,
        Err(error) => {
            eprintln!("smartcard-sidecar: {error}");
            std::process::exit(1);
        }
    };

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Request>(&line) {
            Ok(request) => handle(&mut service, request),
            Err(error) => Response::err(0, format!("Invalid request: {error}")),
        };
        if write_response(&mut out, &response).is_err() {
            break;
        }
    }

    let _ = service.disconnect();
}

fn handle(service: &mut SmartCardService, request: Request) -> Response {
    match request.method.as_str() {
        "list_readers" => match service.list_readers() {
            Ok(readers) => Response::ok(request.id, serde_json::json!({ "readers": readers })),
            Err(error) => Response::err(request.id, error),
        },
        "connect" => {
            let reader_id = reader_id_of(&request);
            match service.connect(reader_id) {
                Ok(atr) => Response::ok(request.id, serde_json::json!({ "atr": atr })),
                Err(error) => Response::err(request.id, error),
            }
        }
        "disconnect" => match service.disconnect() {
            Ok(()) => Response::ok(request.id, serde_json::json!({})),
            Err(error) => Response::err(request.id, error),
        },
        "reset" => {
            let reader_id = reader_id_of(&request);
            match service.reset(reader_id) {
                Ok(atr) => Response::ok(request.id, serde_json::json!({ "atr": atr })),
                Err(error) => Response::err(request.id, error),
            }
        }
        "transmit" => match serde_json::from_value::<TransmitParams>(request.params.clone()) {
            Ok(params) => match service.transmit(&params.reader_id, &params.apdu) {
                Ok(response) => Response::ok(request.id, response),
                Err(error) => Response::err(request.id, error),
            },
            Err(error) => Response::err(request.id, format!("Invalid transmit params: {error}")),
        },
        "close" => {
            let _ = service.disconnect();
            Response::ok(request.id, serde_json::json!({}))
        }
        other => Response::err(request.id, format!("Unknown method: {other}")),
    }
}

fn reader_id_of(request: &Request) -> &str {
    request
        .params
        .get("reader_id")
        .and_then(|value| value.as_str())
        .unwrap_or("")
}

fn write_response(out: &mut impl Write, response: &Response) -> io::Result<()> {
    let line = serde_json::to_string(response).map_err(io::Error::other)?;
    writeln!(out, "{line}")?;
    out.flush()
}
