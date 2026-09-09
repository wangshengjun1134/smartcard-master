/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import type { SkillDefinition } from '../skills/types.js';
import type { SkillExecutionHandle, SkillHost } from './skill-host.js';
import type {
  RuntimeToSkillMessage,
  SkillToRuntimeMessage,
} from './ipc-protocol.js';

/**
 * ProcessNodeHost: runs a Node.js/TypeScript skill in a child process.
 *
 * The skill must export an entry point that:
 * 1. Reads Runtime→Skill messages from stdin (JSON lines)
 * 2. Writes Skill→Runtime messages to stdout (JSON lines)
 * 3. Writes logs to stderr
 *
 * Design doc v2.4 §5: independent process for isolation.
 */
export class ProcessNodeHost implements SkillHost {
  supports(def: SkillDefinition): boolean {
    return def.runtime.type === 'node';
  }

  async start(
    def: SkillDefinition,
    packagePath: string,
  ): Promise<SkillExecutionHandle> {
    const executionId = `node-${def.skillId}-${Date.now()}`;
    const entryPath = `${packagePath}/${def.entry}`;

    // Check if entry is TypeScript (.ts) or JavaScript (.js)
    const isTypeScript = entryPath.endsWith('.ts');

    // For TypeScript files, use tsx to run
    // For JavaScript files, use node directly
    let command: string;
    let args: string[];

    if (isTypeScript) {
      // On Windows, use 'npx.cmd' instead of 'npx'
      const isWindows = process.platform === 'win32';
      command = isWindows ? 'npx.cmd' : 'npx';
      args = ['tsx', entryPath];
    } else {
      command = process.execPath;
      args = [entryPath];
    }

    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1',
        SKILL_EXECUTION_ID: executionId,
        SKILL_PACKAGE_PATH: packagePath,
      },
      cwd: packagePath,
      shell: isTypeScript, // Use shell for npx to handle .cmd on Windows
    });

    return createHandle(executionId, child, def, packagePath);
  }

  async dispose(): Promise<void> {
    // No shared resources to clean up for node host
  }
}

function createHandle(
  executionId: string,
  child: ChildProcess,
  def: SkillDefinition,
  _packagePath: string,
): SkillExecutionHandle {
  let finishedResolve: (msg: SkillToRuntimeMessage) => void;
  const finishedPromise = new Promise<SkillToRuntimeMessage>(
    (resolve) => (finishedResolve = resolve),
  );

  const stdoutBuffer: string[] = [];
  let stdoutBufferStr = '';

  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBufferStr += chunk.toString();
    const lines = stdoutBufferStr.split('\n');
    stdoutBufferStr = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as SkillToRuntimeMessage;
        if (msg.type === 'execution_finished') {
          finishedResolve(msg);
        }
        stdoutBuffer.push(line);
      } catch {
        // Ignore parse errors
      }
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    // Log stderr to parent's stderr
    process.stderr.write(`[skill:${def.skillId}] ${chunk}`);
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
      // Wait for either the finished message or process exit
      await Promise.race([
        finishedPromise,
        once(child, 'exit').then(
          ([code]) =>
            ({
              type: 'execution_finished',
              executionId,
              status: code === 0 ? 'SUCCESS' : 'FAILED',
              error:
                code !== 0 ? `Process exited with code ${code}` : undefined,
            }) satisfies SkillToRuntimeMessage,
        ),
      ]);
      return finishedPromise;
    },
  };
}
