/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { SkillRuntime } from './skill-runtime.js';
import type { SkillDefinition } from '../skills/types.js';
import type { SkillExecutionHandle, SkillHost } from './skill-host.js';
import type {
  RuntimeToSkillMessage,
  SkillToRuntimeMessage,
} from './ipc-protocol.js';

describe('SkillRuntime', () => {
  it('should select the correct host based on runtime type', async () => {
    const mockHandle: SkillExecutionHandle = {
      executionId: 'test-123',
      send: vi.fn(),
      stop: vi.fn(),
      finished: vi.fn().mockResolvedValue({
        type: 'execution_finished',
        executionId: 'test-123',
        status: 'SUCCESS',
      } as SkillToRuntimeMessage),
    };

    const mockNodeHost: SkillHost = {
      supports: vi.fn().mockReturnValue(true),
      start: vi.fn().mockResolvedValue(mockHandle),
      dispose: vi.fn().mockResolvedValue(undefined),
    };

    const mockPythonHost: SkillHost = {
      supports: vi.fn().mockReturnValue(false),
      start: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    };

    const runtime = new SkillRuntime([mockNodeHost, mockPythonHost]);

    const def: SkillDefinition = {
      skillId: 'test.skill',
      version: '1.0.0',
      name: 'Test Skill',
      description: 'A test skill',
      category: 'custom',
      runtime: { type: 'node' },
      entry: 'index.ts',
    };

    const handle = await runtime.start(def, '/path/to/package');

    expect(mockNodeHost.supports).toHaveBeenCalledWith(def);
    expect(mockNodeHost.start).toHaveBeenCalledWith(def, '/path/to/package');
    expect(handle.executionId).toBe('test-123');
  });

  it('should throw if no host supports the runtime type', async () => {
    const mockHost: SkillHost = {
      supports: vi.fn().mockReturnValue(false),
      start: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    };

    const runtime = new SkillRuntime([mockHost]);

    const def: SkillDefinition = {
      skillId: 'test.skill',
      version: '1.0.0',
      name: 'Test Skill',
      description: 'A test skill',
      category: 'custom',
      runtime: { type: 'java' }, // No JavaHost registered
      entry: 'Main.java',
    };

    await expect(runtime.start(def, '/path')).rejects.toThrow(
      'No SkillHost found for runtime type "java"',
    );
  });

  it('should send messages to active executions', async () => {
    const sendMock = vi.fn();
    let finishedResolve: (value: SkillToRuntimeMessage) => void;
    const finishedPromise = new Promise<SkillToRuntimeMessage>(
      (resolve) => (finishedResolve = resolve),
    );

    const mockHandle: SkillExecutionHandle = {
      executionId: 'exec-1',
      send: sendMock,
      stop: vi.fn(),
      finished: vi.fn().mockReturnValue(finishedPromise),
    };

    const mockHost: SkillHost = {
      supports: vi.fn().mockReturnValue(true),
      start: vi.fn().mockResolvedValue(mockHandle),
      dispose: vi.fn().mockResolvedValue(undefined),
    };

    const runtime = new SkillRuntime([mockHost]);

    const def: SkillDefinition = {
      skillId: 'test.skill',
      version: '1.0.0',
      name: 'Test Skill',
      description: 'A test skill',
      category: 'custom',
      runtime: { type: 'node' },
      entry: 'index.ts',
    };

    await runtime.start(def, '/path');

    const msg: RuntimeToSkillMessage = {
      type: 'start',
      executionId: 'exec-1',
      skillId: 'test.skill',
      input: {},
      cardSession: { readerId: null, atr: null, connected: false },
    };

    runtime.send('exec-1', msg);
    expect(sendMock).toHaveBeenCalledWith(msg);

    // Clean up: resolve the finished promise
    finishedResolve!({
      type: 'execution_finished',
      executionId: 'exec-1',
      status: 'SUCCESS',
    });
  });

  it('should throw when sending to non-existent execution', () => {
    const runtime = new SkillRuntime([]);

    expect(() =>
      runtime.send('nonexistent', {
        type: 'stop',
        executionId: 'nonexistent',
      }),
    ).toThrow('Execution "nonexistent" not found');
  });

  it('should list active executions', async () => {
    let finishedResolve1: (value: SkillToRuntimeMessage) => void;
    let finishedResolve2: (value: SkillToRuntimeMessage) => void;

    const promise1 = new Promise<SkillToRuntimeMessage>(
      (resolve) => (finishedResolve1 = resolve),
    );
    const promise2 = new Promise<SkillToRuntimeMessage>(
      (resolve) => (finishedResolve2 = resolve),
    );

    let callCount = 0;
    const mockHost: SkillHost = {
      supports: vi.fn().mockReturnValue(true),
      start: vi.fn().mockImplementation(async () => {
        const id = `exec-${++callCount}`;
        return {
          executionId: id,
          send: vi.fn(),
          stop: vi.fn(),
          finished: vi
            .fn()
            .mockReturnValue(callCount === 1 ? promise1 : promise2),
        };
      }),
      dispose: vi.fn().mockResolvedValue(undefined),
    };

    const runtime = new SkillRuntime([mockHost]);

    const def: SkillDefinition = {
      skillId: 'test.skill',
      version: '1.0.0',
      name: 'Test Skill',
      description: 'A test skill',
      category: 'custom',
      runtime: { type: 'node' },
      entry: 'index.ts',
    };

    // Start first execution
    await runtime.start(def, '/path1');
    // Start second execution
    await runtime.start(def, '/path2');

    const active = runtime.listActive();
    expect(active.length).toBe(2);
    expect(active).toContain('exec-1');
    expect(active).toContain('exec-2');

    // Clean up
    finishedResolve1!({
      type: 'execution_finished',
      executionId: 'exec-1',
      status: 'SUCCESS',
    });
    finishedResolve2!({
      type: 'execution_finished',
      executionId: 'exec-2',
      status: 'SUCCESS',
    });
  });

  it('should dispose all hosts', async () => {
    const disposeMock1 = vi.fn().mockResolvedValue(undefined);
    const disposeMock2 = vi.fn().mockResolvedValue(undefined);

    const mockHost1: SkillHost = {
      supports: vi.fn().mockReturnValue(false),
      start: vi.fn(),
      dispose: disposeMock1,
    };

    const mockHost2: SkillHost = {
      supports: vi.fn().mockReturnValue(false),
      start: vi.fn(),
      dispose: disposeMock2,
    };

    const runtime = new SkillRuntime([mockHost1, mockHost2]);
    await runtime.dispose();

    expect(disposeMock1).toHaveBeenCalled();
    expect(disposeMock2).toHaveBeenCalled();
  });
});
