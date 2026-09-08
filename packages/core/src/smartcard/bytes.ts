/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

/** Convert a hex string (with or without spaces) to a byte array. */
export function hexToBytes(hex: string): Uint8Array {
  const cleaned = hex.replace(/\s+/g, '');
  if (cleaned.length % 2 !== 0) {
    throw new Error(`Invalid hex string (odd length): ${hex}`);
  }
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`Invalid hex string: ${hex}`);
    }
    bytes[i] = byte;
  }
  return bytes;
}

/** Convert a byte array to an uppercase hex string. */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0').toUpperCase(),
  ).join('');
}

/** Encode an APDU command into its byte sequence (header + data + Le). */
export function apduToBytes(apdu: {
  cla: number;
  ins: number;
  p1: number;
  p2: number;
  data?: Uint8Array;
  le?: number;
}): Uint8Array {
  const header = new Uint8Array([
    apdu.cla & 0xff,
    apdu.ins & 0xff,
    apdu.p1 & 0xff,
    apdu.p2 & 0xff,
  ]);
  const data = apdu.data ?? new Uint8Array(0);
  let length: Uint8Array;
  if (apdu.le !== undefined) {
    // Case 4 APDU: Lc + data + Le (Le always a single byte here).
    length = new Uint8Array(data.length > 0 ? 2 : 1);
    if (data.length > 0) {
      length[0] = data.length & 0xff;
      length[1] = apdu.le & 0xff;
    } else {
      length[0] = apdu.le & 0xff;
    }
  } else if (data.length > 0) {
    // Case 3 APDU: Lc + data.
    length = new Uint8Array([data.length & 0xff]);
  } else {
    // Case 1 APDU: header only.
    length = new Uint8Array(0);
  }

  const result = new Uint8Array(header.length + length.length + data.length);
  result.set(header, 0);
  result.set(length, header.length);
  result.set(data, header.length + length.length);
  return result;
}
