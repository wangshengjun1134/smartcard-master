/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { MockCardTransport } from '../transport/mock-transport.js';
import type { Skill, SkillSession } from '../skills/types.js';
import { SmartCardRuntime } from './smartcard-runtime.js';
import type { SkillResult } from './types.js';

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

  it('records connect, APDU, reset, and disconnect operations', async () => {
    const runtime = new SmartCardRuntime(new MockCardTransport());
    try {
      const readers = await runtime.listReaders();
      await runtime.connect(readers[0].id);
      await runtime.sendApdu({
        cla: 0x00,
        ins: 0xa4,
        p1: 0x04,
        p2: 0x00,
        data: new Uint8Array([0xaa]),
      });
      await runtime.reset();
      await runtime.disconnect();

      const operations = runtime.getOperations();
      expect(operations.map((op) => op.type)).toEqual([
        'connect',
        'apdu',
        'reset',
        'disconnect',
      ]);
      const apdu = operations[1];
      expect(apdu.type).toBe('apdu');
      if (apdu.type === 'apdu') {
        expect(apdu.request).toBe('00A4040001AA');
        expect(apdu.sw).toBe(0x9000);
      }
    } finally {
      await runtime.close();
    }
  });

  it('streams operations to subscribers as they happen', async () => {
    const runtime = new SmartCardRuntime(new MockCardTransport());
    const seen: string[] = [];
    const unsubscribe = runtime.onOperation((op) => seen.push(op.type));
    try {
      const readers = await runtime.listReaders();
      await runtime.connect(readers[0].id);
      await runtime.sendApdu({ cla: 0, ins: 0, p1: 0, p2: 0 });
      await runtime.disconnect();
      unsubscribe();
      await runtime.connect(readers[0].id);
      expect(seen).toEqual(['connect', 'apdu', 'disconnect']);
    } finally {
      await runtime.close();
    }
  });

  it('logs APDUs performed by a skill', async () => {
    const selectSkill: Skill = {
      skillId: 'test.select',
      name: 'Select',
      description: 'SELECT APDU',
      category: 'custom',
      createSession(): SkillSession {
        return { sessionId: 's', skillId: 'test.select', status: 'RUNNING' };
      },
      start(): SkillResult {
        return {
          status: 'CONTINUE',
          nextAction: {
            actionId: 'select',
            type: 'APDU',
            apdu: { cla: 0x00, ins: 0xa4, p1: 0x04, p2: 0x00 },
          },
        };
      },
      handleResult(): SkillResult {
        return { status: 'SUCCESS' };
      },
    };

    const runtime = new SmartCardRuntime(new MockCardTransport());
    runtime.registerSkill(selectSkill);
    try {
      const readers = await runtime.listReaders();
      await runtime.connect(readers[0].id);
      await runtime.executeSkill('test.select', {});

      const operations = runtime.getOperations();
      expect(operations.some((op) => op.type === 'apdu')).toBe(true);
      const apdu = operations.find((op) => op.type === 'apdu');
      if (apdu?.type === 'apdu') {
        expect(apdu.request).toBe('00A40400');
        expect(apdu.sw).toBe(0x9000);
      }
    } finally {
      await runtime.close();
    }
  });
});
