/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { delimiter } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configuredSkillDirs } from './factory.js';

const ENV = 'QWEN_SMARTCARD_SKILLS_DIR';

describe('configuredSkillDirs', () => {
  afterEach(() => {
    delete process.env[ENV];
  });

  it('returns an empty list when unset', () => {
    delete process.env[ENV];
    expect(configuredSkillDirs()).toEqual([]);
  });

  it('splits a path-delimited list and trims blanks', () => {
    process.env[ENV] = ['/a/skills', '', '/b/skills'].join(delimiter);
    expect(configuredSkillDirs()).toEqual(['/a/skills', '/b/skills']);
  });
});
