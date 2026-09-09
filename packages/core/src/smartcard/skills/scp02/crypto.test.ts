/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { hexToBytes } from '../../bytes.js';
import {
  computeCardCryptogram,
  computeCryptogram,
  computeHostCryptogram,
  deriveSessionKeys,
  expandDesKey,
} from './crypto.js';

const KEY_ENC = hexToBytes('404142434445464748494A4B4C4D4E4F');
const KEY_MAC = hexToBytes('404142434445464748494A4B4C4D4E4F');
const HOST_CHALLENGE = hexToBytes('0102030405060708');
const CARD_CHALLENGE = hexToBytes('1112131415161718');
const SEQUENCE_COUNTER = hexToBytes('0001');

describe('expandDesKey', () => {
  it('expands a 16-byte 2-key 3DES key to 24 bytes (K1K2K1)', () => {
    const key = hexToBytes('00112233445566778899AABBCCDDEEFF');
    const expanded = expandDesKey(key);
    expect(expanded.length).toBe(24);
    expect(Array.from(expanded.subarray(0, 8))).toEqual(
      Array.from(key.subarray(0, 8)),
    );
    expect(Array.from(expanded.subarray(8, 16))).toEqual(
      Array.from(key.subarray(8, 16)),
    );
    expect(Array.from(expanded.subarray(16, 24))).toEqual(
      Array.from(key.subarray(0, 8)),
    );
  });

  it('passes through a 24-byte key unchanged', () => {
    const key = new Uint8Array(24).fill(0xab);
    expect(Array.from(expandDesKey(key))).toEqual(Array.from(key));
  });

  it('rejects invalid lengths', () => {
    expect(() => expandDesKey(new Uint8Array(8))).toThrow(/Invalid 3DES key/);
  });
});

describe('deriveSessionKeys', () => {
  it('derives 16-byte session ENC and MAC keys', () => {
    const { enc, mac } = deriveSessionKeys(
      { enc: KEY_ENC, mac: KEY_MAC },
      CARD_CHALLENGE,
      HOST_CHALLENGE,
    );
    expect(enc.length).toBe(16);
    expect(mac.length).toBe(16);
    expect(Buffer.from(enc)).not.toEqual(Buffer.from(KEY_ENC));
    expect(Buffer.from(mac)).not.toEqual(Buffer.from(KEY_MAC));
  });

  it('is deterministic for the same inputs', () => {
    const first = deriveSessionKeys(
      { enc: KEY_ENC, mac: KEY_MAC },
      CARD_CHALLENGE,
      HOST_CHALLENGE,
    );
    const second = deriveSessionKeys(
      { enc: KEY_ENC, mac: KEY_MAC },
      CARD_CHALLENGE,
      HOST_CHALLENGE,
    );
    expect(Buffer.from(first.enc)).toEqual(Buffer.from(second.enc));
    expect(Buffer.from(first.mac)).toEqual(Buffer.from(second.mac));
  });
});

describe('computeCryptogram', () => {
  it('returns an 8-byte cryptogram for non-aligned input', () => {
    const data = Buffer.concat([
      Buffer.from(SEQUENCE_COUNTER),
      Buffer.from(CARD_CHALLENGE),
      Buffer.from(HOST_CHALLENGE),
    ]);
    const cryptogram = computeCryptogram(KEY_MAC, data);
    expect(cryptogram.length).toBe(8);
  });
});

describe('card and host cryptograms', () => {
  it('computes distinct card and host cryptograms', () => {
    const card = computeCardCryptogram(
      KEY_MAC,
      HOST_CHALLENGE,
      SEQUENCE_COUNTER,
      CARD_CHALLENGE,
    );
    const host = computeHostCryptogram(
      KEY_MAC,
      SEQUENCE_COUNTER,
      CARD_CHALLENGE,
      HOST_CHALLENGE,
    );
    expect(card.length).toBe(8);
    expect(host.length).toBe(8);
    expect(Buffer.from(card)).not.toEqual(Buffer.from(host));
  });
});
