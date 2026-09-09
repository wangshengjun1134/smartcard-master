/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SkillDefinition } from '../skills/types.js';
import type { SkillExecutionHandle, SkillHost } from './skill-host.js';
import type { RuntimeToSkillMessage } from './ipc-protocol.js';
import { ProcessNodeHost } from './process-node-host.js';
import { ProcessPythonHost } from './process-python-host.js';

/**
 * SkillRuntime: manages SkillHost instances and selects the appropriate host
 * based on the skill definition's runtime metadata.
 *
 * Design doc v2.4 §2, §6:
 * - Agent never calls `java -jar` or `python xxx.py` directly
 * - Agent → SkillRuntime → SkillHost
 * - Runtime selects host based on definition.runtime.type
 */
export class SkillRuntime {
  private hosts: SkillHost[];
  private activeExecutions = new Map<string, SkillExecutionHandle>();

  constructor(hosts?: SkillHost[]) {
    this.hosts = hosts ?? [new ProcessNodeHost(), new ProcessPythonHost()];
  }

  /**
   * Find a host that supports the given skill definition.
   */
  private findHost(def: SkillDefinition): SkillHost {
    const host = this.hosts.find((h) => h.supports(def));
    if (!host) {
      throw new Error(
        `No SkillHost found for runtime type "${def.runtime.type}". ` +
          `Supported types: ${this.hosts.map((h) => h.constructor.name).join(', ')}`,
      );
    }
    return host;
  }

  /**
   * Start a skill execution. The runtime selects the appropriate host and
   * returns an execution handle.
   */
  async start(
    def: SkillDefinition,
    packagePath: string,
  ): Promise<SkillExecutionHandle> {
    const host = this.findHost(def);
    const handle = await host.start(def, packagePath);
    this.activeExecutions.set(handle.executionId, handle);

    // Auto-cleanup when execution finishes
    handle.finished().finally(() => {
      this.activeExecutions.delete(handle.executionId);
    });

    return handle;
  }

  /**
   * Send a message to a running execution.
   */
  send(executionId: string, msg: RuntimeToSkillMessage): void {
    const handle = this.activeExecutions.get(executionId);
    if (!handle) {
      throw new Error(`Execution "${executionId}" not found`);
    }
    handle.send(msg);
  }

  /**
   * Stop a running execution.
   */
  stop(executionId: string): void {
    const handle = this.activeExecutions.get(executionId);
    if (handle) {
      handle.stop();
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Get an active execution handle.
   */
  getHandle(executionId: string): SkillExecutionHandle | undefined {
    return this.activeExecutions.get(executionId);
  }

  /**
   * List all active execution IDs.
   */
  listActive(): string[] {
    return Array.from(this.activeExecutions.keys());
  }

  /**
   * Dispose all hosts and clean up resources.
   */
  async dispose(): Promise<void> {
    // Stop all active executions
    for (const executionId of this.activeExecutions.keys()) {
      this.stop(executionId);
    }

    // Dispose all hosts
    await Promise.all(this.hosts.map((h) => h.dispose()));
  }
}
