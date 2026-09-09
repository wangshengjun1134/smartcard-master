/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Skill, SkillCategory } from './types.js';

/** In-memory registry of smart-card skills, keyed by skill id. */
export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  register(skill: Skill): void {
    this.skills.set(skill.skillId, skill);
  }

  unregister(skillId: string): void {
    this.skills.delete(skillId);
  }

  get(skillId: string): Skill | undefined {
    return this.skills.get(skillId);
  }

  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  listByCategory(category: SkillCategory): Skill[] {
    return this.list().filter((skill) => skill.category === category);
  }

  /** Enable or disable a skill by id. Returns true if the skill was found. */
  setEnabled(skillId: string, enabled: boolean): boolean {
    const skill = this.skills.get(skillId);
    if (!skill) return false;
    skill.enabled = enabled;
    return true;
  }
}
