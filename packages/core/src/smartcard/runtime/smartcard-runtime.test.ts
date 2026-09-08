/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { MockCardTransport } from '../transport/mock-transport.js';
import { SmartCardRuntime } from './smartcard-runtime.js';

describe('SmartCardRuntime', () => {
  it('connects, sends an APDU, resets, and disconnects', async () => {
    const runtime = new SmartCardRuntime(new MockCardTransport());
    try {
      const readers = await runtime.listReaders();
      expect(readers.length).toBe(1);

      const atr = await runtime.connect(readers[0].id);
      expect(atr).toBeTruthy();
      expect(runtime.getCardSession().connected).toBe(true);

      const response = await runtime.sendApdu({
        cla: 0x00,
        ins: 0xa4,
        p1: 0x04,
        p2: 0x00,
        data: new Uint8Array([0xaa]),
      });
      expect(response.sw).toBe(0x9000);

      const newAtr = await runtime.reset();
      expect(newAtr).toBeTruthy();

      await runtime.disconnect();
      expect(runtime.getCardSession().connected).toBe(false);
    } finally {
      await runtime.close();
    }
  });

  it('fails to send an APDU without an active reader', async () => {
    const runtime = new SmartCardRuntime(new MockCardTransport());
    try {
      await expect(
        runtime.sendApdu({ cla: 0, ins: 0, p1: 0, p2: 0 }),
      ).rejects.toThrow(/No active reader/);
    } finally {
      await runtime.close();
    }
  });

  it('reports an unregistered skill as failed', async () => {
    const runtime = new SmartCardRuntime(new MockCardTransport());
    try {
      const result = await runtime.executeSkill('does.not.exist', {});
      expect(result.status).toBe('FAILED');
    } finally {
      await runtime.close();
    }
  });
});
