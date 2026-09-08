/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../../config/config.js';
import type { SmartCardRuntime } from '../runtime/smartcard-runtime.js';

/** Resolve the runtime or throw a descriptive error when unavailable. */
export function requireSmartCardRuntime(config: Config): SmartCardRuntime {
  const runtime = config.getSmartCardRuntime();
  if (!runtime) {
    throw new Error('Smart card support is not available in this environment.');
  }
  return runtime;
}
