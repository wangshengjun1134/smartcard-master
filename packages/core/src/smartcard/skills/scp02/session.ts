/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes as cryptoRandomBytes } from 'node:crypto';
import { hexToBytes } from '../../bytes.js';
import type { SkillSession, SkillSessionStatus } from '../types.js';
import type { Scp02Keys } from './crypto.js';
import { Scp02State } from './state.js';
import { SECURITY_LEVEL_CMAC } from './constants.js';

/** Input for the SCP02 channel-establishment skill. */
export interface Scp02Input {
  /** Static SCP02 keys, as hex strings. */
  keys: {
    enc: string;
    mac: string;
    dek?: string;
  };
  /** Key version (0-255) used for INITIALIZE UPDATE. */
  keyVersion: number;
  /** Security level for EXTERNAL AUTHENTICATE (defaults to C-MAC). */
  securityLevel?: number;
  /** Optional 8-byte host challenge as hex; random when omitted. */
  hostChallenge?: string;
  /** Optional security-domain AID as hex; SELECT is skipped when omitted. */
  aid?: string;
}

/** Per-execution state of an SCP02 channel establishment. */
export class Scp02Session implements SkillSession {
  sessionId: string;
  skillId = 'scp02.open';
  status: SkillSessionStatus = 'RUNNING';
  state: Scp02State = Scp02State.START;

  keys: Scp02Keys;
  keyVersion: number;
  securityLevel: number;
  hostChallenge: Uint8Array;
  cardChallenge = new Uint8Array(0);
  sequenceCounter = new Uint8Array(0);
  sessionKeys: { enc: Uint8Array; mac: Uint8Array } | null = null;
  atr: string | null = null;
  aid: string | undefined;

  constructor(input: Scp02Input) {
    this.sessionId = `scp02-open-${Date.now()}`;
    this.keys = {
      enc: hexToBytes(input.keys.enc),
      mac: hexToBytes(input.keys.mac),
      ...(input.keys.dek ? { dek: hexToBytes(input.keys.dek) } : {}),
    };
    this.keyVersion = input.keyVersion & 0xff;
    this.securityLevel = input.securityLevel ?? SECURITY_LEVEL_CMAC;
    this.hostChallenge = input.hostChallenge
      ? hexToBytes(input.hostChallenge)
      : randomBytes(8);
    this.aid = input.aid;
  }
}

function randomBytes(length: number): Uint8Array {
  return new Uint8Array(cryptoRandomBytes(length));
}
