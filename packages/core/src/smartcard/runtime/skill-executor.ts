/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Skill,
  SkillExecutionResult,
  SkillInput,
} from '../skills/types.js';
import type { ActionExecutor } from './action-executor.js';
import type { CardSession, SkillEvent, SkillOutputSink } from './types.js';

const MAX_ITERATIONS = 100;

/** Bounds the action loop so a buggy skill cannot spin forever. */
function tooManyIterations(iterations: number): boolean {
  return iterations >= MAX_ITERATIONS;
}

/**
 * Drives a single skill execution through the
 * `start -> Action -> handleResult` loop defined by design doc v2.3 §5.
 */
export class SkillExecutor {
  constructor(
    private readonly actionExecutor: ActionExecutor,
    private readonly getCardSession: () => CardSession,
  ) {}

  async execute<S extends Skill>(
    skill: S,
    input: SkillInput,
  ): Promise<SkillExecutionResult> {
    const events: SkillEvent[] = [];
    const output = createOutputSink(events);
    const context = {
      output,
      cardSession: this.getCardSession(),
    };

    const session = skill.createSession(context, input);
    session.status = 'RUNNING';

    let result = skill.start(context, session);
    let iterations = 0;

    while (result.status === 'CONTINUE') {
      if (tooManyIterations(iterations)) {
        session.status = 'FAILED';
        return {
          status: 'FAILED',
          error: `Skill "${skill.skillId}" exceeded ${MAX_ITERATIONS} actions.`,
          events,
        };
      }
      const nextAction = result.nextAction;
      if (!nextAction) {
        session.status = 'FAILED';
        return {
          status: 'FAILED',
          error: `Skill "${skill.skillId}" returned CONTINUE without a next action.`,
          events,
        };
      }
      const actionResult = await this.actionExecutor.execute(nextAction);
      if (!actionResult.success) {
        session.status = 'FAILED';
        return {
          status: 'FAILED',
          error: actionResult.error,
          events,
        };
      }
      result = skill.handleResult(context, actionResult, session);
      iterations += 1;
    }

    session.status = result.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED';
    if (result.status === 'SUCCESS') {
      return { status: 'SUCCESS', events };
    }
    return {
      status: result.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
      error: result.error,
      events,
    };
  }
}

function createOutputSink(events: SkillEvent[]): SkillOutputSink {
  const emit = (
    level: SkillEvent['level'],
    message: string,
    data?: unknown,
  ) => {
    events.push(
      data === undefined ? { level, message } : { level, message, data },
    );
  };
  return {
    text: (message) => emit('TEXT', message),
    info: (message) => emit('INFO', message),
    warn: (message) => emit('WARN', message),
    error: (message) => emit('ERROR', message),
    data: (data) => emit('DATA', '', data),
  };
}
