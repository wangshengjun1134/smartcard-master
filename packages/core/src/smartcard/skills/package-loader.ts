/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SkillDefinition, SkillCategory } from './types.js';

/**
 * SkillPackageLoader: discovers and loads skill packages from directories.
 *
 * Design doc v2.4 §9:
 * - Each skill package is a directory containing skill.json
 * - The loader validates the manifest and returns SkillDefinition instances
 *
 * Package structure:
 * ```
 * skills/
 *   scp02.open/
 *     skill.json
 *     index.ts
 *     crypto.ts
 *     ...
 *
 *   read.iccid/
 *     skill.json
 *     main.py
 *     requirements.txt
 * ```
 */
export class SkillPackageLoader {
  /**
   * Load a single skill package from a directory.
   * Returns the SkillDefinition or throws if invalid.
   */
  loadFromDirectory(dir: string): SkillDefinition {
    const manifestPath = join(dir, 'skill.json');

    if (!existsSync(manifestPath)) {
      throw new Error(
        `Skill manifest not found: ${manifestPath}. ` +
          `Each skill package must contain a skill.json file.`,
      );
    }

    const raw = readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw);

    return this.validate(parsed, dir);
  }

  /**
   * Scan a directory for all skill packages and load them.
   * Returns an array of SkillDefinition instances.
   */
  scanDirectory(baseDir: string): SkillDefinition[] {
    if (!existsSync(baseDir)) {
      return [];
    }

    const entries = readdirSync(baseDir, { withFileTypes: true });
    const definitions: SkillDefinition[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = join(baseDir, entry.name);
      try {
        const def = this.loadFromDirectory(skillDir);
        definitions.push(def);
      } catch (err) {
        // Skip invalid packages but log the error
        process.stderr.write(
          `[SkillPackageLoader] Skipping invalid package "${entry.name}": ` +
            `${err instanceof Error ? err.message : err}\n`,
        );
      }
    }

    return definitions;
  }

  /**
   * Validate a parsed skill.json manifest.
   */
  private validate(parsed: unknown, dir: string): SkillDefinition {
    const obj = parsed as Record<string, unknown>;

    // Required fields
    const skillId = obj['skillId'];
    if (typeof skillId !== 'string' || !skillId) {
      throw new Error(
        `Invalid skill.json in "${dir}": missing or invalid "skillId"`,
      );
    }

    const version = obj['version'];
    if (typeof version !== 'string' || !version) {
      throw new Error(
        `Invalid skill.json in "${dir}": missing or invalid "version"`,
      );
    }

    const name = obj['name'];
    if (typeof name !== 'string' || !name) {
      throw new Error(
        `Invalid skill.json in "${dir}": missing or invalid "name"`,
      );
    }

    const description = obj['description'];
    if (typeof description !== 'string' || !description) {
      throw new Error(
        `Invalid skill.json in "${dir}": missing or invalid "description"`,
      );
    }

    const category = obj['category'] as SkillCategory;
    const validCategories: SkillCategory[] = [
      'filesystem',
      'security',
      'crypto',
      'authentication',
      'custom',
    ];
    if (!validCategories.includes(category)) {
      throw new Error(
        `Invalid skill.json in "${dir}": invalid category "${category}". ` +
          `Must be one of: ${validCategories.join(', ')}`,
      );
    }

    // Runtime metadata
    const runtime = obj['runtime'] as Record<string, unknown> | undefined;
    if (!runtime || typeof runtime !== 'object') {
      throw new Error(
        `Invalid skill.json in "${dir}": missing "runtime" field`,
      );
    }

    const runtimeType = runtime['type'] as string;
    if (!runtimeType || !['node', 'python', 'java'].includes(runtimeType)) {
      throw new Error(
        `Invalid skill.json in "${dir}": invalid runtime.type "${runtimeType}". ` +
          `Must be "node", "python", or "java"`,
      );
    }

    const entry = obj['entry'];
    if (typeof entry !== 'string' || !entry) {
      throw new Error(
        `Invalid skill.json in "${dir}": missing or invalid "entry"`,
      );
    }

    // Validate entry file exists
    const entryPath = resolve(dir, entry);
    if (!existsSync(entryPath)) {
      throw new Error(
        `Invalid skill.json in "${dir}": entry file not found "${entryPath}"`,
      );
    }

    return {
      skillId,
      version,
      name,
      description,
      category,
      runtime: {
        type: runtimeType as 'node' | 'python' | 'java',
        version: runtime['version'] as string | undefined,
      },
      entry,
    };
  }

  /**
   * Check if a directory contains a valid skill package.
   */
  isSkillPackage(dir: string): boolean {
    try {
      this.loadFromDirectory(dir);
      return true;
    } catch {
      return false;
    }
  }
}
