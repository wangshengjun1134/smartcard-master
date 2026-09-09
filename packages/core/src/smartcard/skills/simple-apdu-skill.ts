/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ApduResponse } from '../transport/types.js';
import type {
  ApduAction,
  ApduActionResult,
  ActionResult,
  SkillResult,
} from '../runtime/types.js';
import type {
  Skill,
  SkillCategory,
  SkillContext,
  SkillInput,
  SkillSession,
  SkillSessionStatus,
} from './types.js';
import { continueWith, failed, success } from './result.js';

/** Session used by single-APDU skills; carries the raw input. */
export class SimpleApduSession implements SkillSession {
  sessionId: string;
  skillId: string;
  status: SkillSessionStatus = 'RUNNING';
  input: SkillInput;

  constructor(skillId: string, input: SkillInput) {
    this.skillId = skillId;
    this.input = input;
    this.sessionId = `${skillId}-${Date.now()}`;
  }
}

/**
 * Base class for skills that perform exactly one APDU exchange
 * (build -> transmit -> parse -> done), per dev manual §9.
 */
export abstract class SimpleApduSkill implements Skill<SimpleApduSession> {
  abstract readonly skillId: string;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly category: SkillCategory;

  /** Build the single APDU action for this skill. */
  abstract buildApdu(session: SimpleApduSession): ApduAction;

  /** Parse the APDU response and produce the final result. */
  abstract parseResponse(
    response: ApduResponse,
    session: SimpleApduSession,
    context: SkillContext,
  ): SkillResult;

  createSession(_context: SkillContext, input: SkillInput): SimpleApduSession {
    return new SimpleApduSession(this.skillId, input);
  }

  start(_context: SkillContext, session: SimpleApduSession): SkillResult {
    return continueWith(this.buildApdu(session));
  }

  handleResult(
    context: SkillContext,
    result: ActionResult,
    session: SimpleApduSession,
  ): SkillResult {
    if (result.actionType !== 'APDU') {
      return failed(`Unexpected result type: ${result.actionType}`);
    }
    const apduResult = result as ApduActionResult;
    return this.parseResponse(apduResult.response, session, context);
  }

  /** Convenience: require SW 9000, otherwise fail with the SW in the message. */
  protected requireSuccess(response: ApduResponse): SkillResult {
    if (response.sw === 0x9000) {
      return success();
    }
    return failed(
      `APDU failed with SW=${response.sw.toString(16).padStart(4, '0')}`,
    );
  }
}
