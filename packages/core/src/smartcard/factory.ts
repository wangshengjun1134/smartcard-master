/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { delimiter } from 'node:path';
import type { CardTransport } from './transport/card-transport.js';
import { MockCardTransport } from './transport/mock-transport.js';
import { SidecarCardTransport } from './transport/sidecar-transport.js';
import { SkillRegistry } from './skills/registry.js';
import { Scp02Skill } from './skills/scp02/index.js';
import { SmartCardRuntime } from './runtime/smartcard-runtime.js';

const SIDECAR_ENV = 'QWEN_SMARTCARD_SIDECAR';
const MOCK_ENV = 'QWEN_SMARTCARD_MOCK';
const SKILL_DIRS_ENV = 'QWEN_SMARTCARD_SKILLS_DIR';
const PYTHON_ENV = 'QWEN_SMARTCARD_PYTHON';

function isMockEnabled(): boolean {
  return process.env[MOCK_ENV] === '1';
}

/**
 * Directories holding skill packages (each with a skill.json manifest).
 * `QWEN_SMARTCARD_SKILLS_DIR` accepts a path-delimited list; the daemon also
 * passes the agent's skill directories so a skill installed through the normal
 * skill management UI becomes executable without extra configuration.
 */
export function configuredSkillDirs(): string[] {
  const raw = process.env[SKILL_DIRS_ENV];
  if (!raw) {
    return [];
  }
  return raw
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Choose the transport based on environment. The desktop host injects
 * `QWEN_SMARTCARD_SIDECAR` pointing at the Rust sidecar binary; without it
 * (CLI mode, no reader) the mock transport is used.
 */
export function createSmartCardTransport(): CardTransport {
  if (isMockEnabled()) {
    return new MockCardTransport();
  }
  const sidecarPath = process.env[SIDECAR_ENV];
  return sidecarPath
    ? new SidecarCardTransport(sidecarPath)
    : new MockCardTransport();
}

/** Build a registry pre-populated with the built-in skills. */
export function createSmartCardRegistry(): SkillRegistry {
  const registry = new SkillRegistry();
  registry.register(new Scp02Skill());
  return registry;
}

/**
 * Build a runtime wired with the default transport and built-in skills.
 *
 * `skillDirs` (plus `QWEN_SMARTCARD_SKILLS_DIR`) are scanned for skill packages
 * at creation time; invalid packages are skipped by the loader.
 */
export function createSmartCardRuntime(
  transport: CardTransport = createSmartCardTransport(),
  options: { skillDirs?: string[] } = {},
): SmartCardRuntime {
  const runtime = new SmartCardRuntime(transport, createSmartCardRegistry(), {
    pythonCommand: process.env[PYTHON_ENV] || undefined,
  });

  const dirs = [...(options.skillDirs ?? []), ...configuredSkillDirs()];
  for (const dir of dirs) {
    try {
      runtime.loadSkillsFromDirectory(dir);
    } catch {
      // A malformed package must not stop the daemon from starting.
    }
  }
  return runtime;
}
