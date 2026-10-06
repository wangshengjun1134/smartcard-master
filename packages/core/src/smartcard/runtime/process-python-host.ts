/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import type { SkillDefinition } from '../skills/types.js';
import type { SkillExecutionHandle, SkillHost } from './skill-host.js';
import type {
  RuntimeToSkillMessage,
  SkillActionMessage,
  SkillToRuntimeMessage,
} from './ipc-protocol.js';

/**
 * ProcessPythonHost: runs a Python skill in a child process.
 *
 * The Python skill must:
 * 1. Read JSON lines from stdin (Runtime→Skill messages)
 * 2. Write JSON lines to stdout (Skill→Runtime messages)
 * 3. Write logs to stderr
 *
 * Design doc v2.4 §5: Python runs in independent process.
 */
export class ProcessPythonHost implements SkillHost {
  private pythonCommand: string;

  constructor(pythonCommand = 'python') {
    this.pythonCommand = pythonCommand;
  }

  supports(def: SkillDefinition): boolean {
    return def.runtime.type === 'python';
  }

  async start(
    def: SkillDefinition,
    packagePath: string,
  ): Promise<SkillExecutionHandle> {
    const executionId = `python-${def.skillId}-${Date.now()}`;
    const entryPath = resolve(packagePath, def.entry);

    const child = spawn(this.pythonCommand, [entryPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        SKILL_EXECUTION_ID: executionId,
        SKILL_PACKAGE_PATH: packagePath,
      },
    });

    return createHandle(executionId, child, def.skillId);
  }

  async dispose(): Promise<void> {
    // No shared resources to clean up
  }
}

function createHandle(
  executionId: string,
  child: ChildProcess,
  skillId: string,
): SkillExecutionHandle {
  let finishedResolve: (msg: SkillToRuntimeMessage) => void;
  const finishedPromise = new Promise<SkillToRuntimeMessage>(
    (resolve) => (finishedResolve = resolve),
  );

  let stdoutBuffer = '';
  const actionListeners: Array<(action: SkillActionMessage) => void> = [];
  const outputListeners: Array<
    (message: Extract<SkillToRuntimeMessage, { type: 'output' }>) => void
  > = [];

  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as SkillToRuntimeMessage;
        if (msg.type === 'execution_finished') {
          finishedResolve(msg);
        } else if (msg.type === 'skill_action') {
          // Notify action listeners
          for (const listener of actionListeners) {
            listener(msg as SkillActionMessage);
          }
        } else if (msg.type === 'output') {
          for (const listener of outputListeners) {
            listener(msg);
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[skill:${skillId}] ${chunk}`);
  });

  return {
    executionId,

    send(msg: RuntimeToSkillMessage): void {
      if (child.stdin?.writable) {
        child.stdin.write(JSON.stringify(msg) + '\n');
      }
    },

    stop(): void {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    },

    async finished(): Promise<SkillToRuntimeMessage> {
      // Race the explicit execution_finished message against process exit so a
      // skill that dies without reporting (crash, non-zero exit, missing
      // runtime) resolves instead of hanging the caller forever. When the
      // skill did report, finishedPromise settles first and wins the race.
      return await Promise.race([
        finishedPromise,
        once(child, 'exit').then(
          ([code]) =>
            ({
              type: 'execution_finished',
              executionId,
              status: code === 0 ? 'SUCCESS' : 'FAILED',
              error:
                code !== 0
                  ? `Python process exited with code ${code}`
                  : undefined,
            }) satisfies SkillToRuntimeMessage,
        ),
      ]);
    },

    onAction(listener: (action: SkillActionMessage) => void): void {
      actionListeners.push(listener);
    },

    onOutput(
      listener: (
        message: Extract<SkillToRuntimeMessage, { type: 'output' }>,
      ) => void,
    ): void {
      outputListeners.push(listener);
    },
  };
}
