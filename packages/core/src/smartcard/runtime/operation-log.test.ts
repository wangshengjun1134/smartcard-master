/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { OperationLog } from './operation-log.js';

describe('OperationLog', () => {
  it('appends and snapshots operations in order', () => {
    const log = new OperationLog();
    log.append({ type: 'connect', readerId: 'r1', atr: '3B00' });
    log.append({ type: 'apdu', request: '00A4', response: '', sw: 0x9000 });
    expect(log.snapshot()).toEqual([
      { type: 'connect', readerId: 'r1', atr: '3B00' },
      { type: 'apdu', request: '00A4', response: '', sw: 0x9000 },
    ]);
  });

  it('caps the log at the configured capacity', () => {
    const log = new OperationLog(2);
    log.append({ type: 'connect', readerId: 'r1', atr: '3B00' });
    log.append({ type: 'disconnect' });
    log.append({ type: 'reset', atr: '3B00' });
    expect(log.snapshot()).toEqual([
      { type: 'disconnect' },
      { type: 'reset', atr: '3B00' },
    ]);
  });

  it('notifies subscribers of appended operations and unsubscribes', () => {
    const log = new OperationLog();
    const seen: unknown[] = [];
    const unsubscribe = log.subscribe((op) => seen.push(op));
    log.append({ type: 'disconnect' });
    unsubscribe();
    log.append({ type: 'reset', atr: '3B00' });
    expect(seen).toEqual([{ type: 'disconnect' }]);
  });
});
