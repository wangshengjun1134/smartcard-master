/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { createCipheriv } from 'node:crypto';
import { CRYPTOGRAM_LENGTH } from './constants.js';

const DES_BLOCK_SIZE = 8;
const ZERO_IV = Buffer.alloc(DES_BLOCK_SIZE);

/** SCP02 static keys, 16-byte (2-key) or 24-byte (3-key) 3DES keys. */
export interface Scp02Keys {
  enc: Uint8Array;
  mac: Uint8Array;
  dek?: Uint8Array;
}

/**
 * Expand a 16-byte 2-key 3DES key (K1||K2) into the 24-byte form
 * (K1||K2||K1) required by Node's `des-ede3` ciphers.
 */
export function expandDesKey(key: Uint8Array): Buffer {
  if (key.length === 24) {
    return Buffer.from(key);
  }
  if (key.length === 16) {
    return Buffer.concat([key, key.subarray(0, 8)]);
  }
  throw new Error(
    `Invalid 3DES key length ${key.length}; expected 16 or 24 bytes.`,
  );
}

function des3CbcEncrypt(key: Uint8Array, data: Buffer): Buffer {
  const expanded = expandDesKey(key);
  const cipher = createCipheriv('des-ede3-cbc', expanded, ZERO_IV);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

/**
 * Derive the SCP02 session ENC/MAC keys from the static keys and the two
 * challenges: derivation data = card challenge || host challenge.
 */
export function deriveSessionKeys(
  keys: Scp02Keys,
  cardChallenge: Uint8Array,
  hostChallenge: Uint8Array,
): { enc: Uint8Array; mac: Uint8Array } {
  const derivationData = Buffer.concat([
    Buffer.from(cardChallenge),
    Buffer.from(hostChallenge),
  ]);
  const enc = des3CbcEncrypt(keys.enc, derivationData).subarray(0, 16);
  const mac = des3CbcEncrypt(keys.mac, derivationData).subarray(0, 16);
  return { enc: new Uint8Array(enc), mac: new Uint8Array(mac) };
}

/**
 * Apply ISO/IEC 9797-1 padding method 2: append 0x80 then zero bytes until the
 * length is a multiple of 8. A full block is added when already aligned.
 */
function padIso9797(data: Buffer): Buffer {
  const padLength = DES_BLOCK_SIZE - (data.length % DES_BLOCK_SIZE);
  const padding = new Uint8Array(padLength);
  padding[0] = 0x80;
  return Buffer.concat([data, Buffer.from(padding)]);
}

/**
 * Compute an SCP02 cryptogram/MAC: 3DES-CBC over the ISO 9797-1 padded data
 * with a zero IV, returning the final 8-byte block.
 */
export function computeCryptogram(key: Uint8Array, data: Buffer): Uint8Array {
  const encrypted = des3CbcEncrypt(key, padIso9797(data));
  return new Uint8Array(
    encrypted.subarray(encrypted.length - CRYPTOGRAM_LENGTH),
  );
}

/**
 * Card cryptogram (verifies the card to the host): MAC over
 * host challenge || sequence counter || card challenge, using the STATIC MAC key.
 */
export function computeCardCryptogram(
  macKey: Uint8Array,
  hostChallenge: Uint8Array,
  sequenceCounter: Uint8Array,
  cardChallenge: Uint8Array,
): Uint8Array {
  const data = Buffer.concat([
    Buffer.from(hostChallenge),
    Buffer.from(sequenceCounter),
    Buffer.from(cardChallenge),
  ]);
  return computeCryptogram(macKey, data);
}

/**
 * Host cryptogram (authenticates the host to the card): MAC over
 * sequence counter || card challenge || host challenge, using the SESSION MAC key.
 */
export function computeHostCryptogram(
  sessionMacKey: Uint8Array,
  sequenceCounter: Uint8Array,
  cardChallenge: Uint8Array,
  hostChallenge: Uint8Array,
): Uint8Array {
  const data = Buffer.concat([
    Buffer.from(sequenceCounter),
    Buffer.from(cardChallenge),
    Buffer.from(hostChallenge),
  ]);
  return computeCryptogram(sessionMacKey, data);
}
