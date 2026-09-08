/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { apduToBytes, bytesToHex, hexToBytes } from './bytes.js';

describe('hexToBytes', () => {
  it('parses a plain hex string', () => {
    expect(Array.from(hexToBytes('00A40400'))).toEqual([
      0x00, 0xa4, 0x04, 0x00,
    ]);
  });

  it('ignores whitespace', () => {
    expect(Array.from(hexToBytes('00 A4 04 00'))).toEqual([
      0x00, 0xa4, 0x04, 0x00,
    ]);
  });

  it('rejects odd-length input', () => {
    expect(() => hexToBytes('0')).toThrow(/odd length/);
  });
});

describe('bytesToHex', () => {
  it('emits uppercase hex', () => {
    expect(bytesToHex(new Uint8Array([0x00, 0xa4]))).toBe('00A4');
  });
});

describe('apduToBytes', () => {
  it('encodes a case 1 APDU (header only)', () => {
    const bytes = apduToBytes({ cla: 0x00, ins: 0xa4, p1: 0x04, p2: 0x00 });
    expect(bytesToHex(bytes)).toBe('00A40400');
  });

  it('encodes a case 3 APDU (header + Lc + data)', () => {
    const bytes = apduToBytes({
      cla: 0x00,
      ins: 0xa4,
      p1: 0x04,
      p2: 0x00,
      data: new Uint8Array([0xaa, 0xbb]),
    });
    expect(bytesToHex(bytes)).toBe('00A4040002AABB');
  });

  it('encodes a case 4 APDU (header + Lc + data + Le)', () => {
    const bytes = apduToBytes({
      cla: 0x80,
      ins: 0x50,
      p1: 0x00,
      p2: 0x00,
      data: new Uint8Array(8),
      le: 0x00,
    });
    expect(bytesToHex(bytes)).toBe(`8050000008${'00'.repeat(8)}00`);
  });
});
