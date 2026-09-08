/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CardTransport } from './transport/card-transport.js';
import { MockCardTransport } from './transport/mock-transport.js';
import { SidecarCardTransport } from './transport/sidecar-transport.js';
import { SkillRegistry } from './skills/registry.js';
import { Scp02Skill } from './skills/scp02/index.js';
import { SmartCardRuntime } from './runtime/smartcard-runtime.js';

const SIDECAR_ENV = 'QWEN_SMARTCARD_SIDECAR';
const MOCK_ENV = 'QWEN_SMARTCARD_MOCK';

function isMockEnabled(): boolean {
  return process.env[MOCK_ENV] === '1';
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

/** Build a runtime wired with the default transport and built-in skills. */
export function createSmartCardRuntime(
  transport: CardTransport = createSmartCardTransport(),
): SmartCardRuntime {
  return new SmartCardRuntime(transport, createSmartCardRegistry());
}
