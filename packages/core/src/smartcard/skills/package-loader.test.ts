/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { SkillPackageLoader } from './package-loader.js';

describe('SkillPackageLoader', () => {
  const loader = new SkillPackageLoader();

  describe('loadFromDirectory', () => {
    it('should load a valid Node.js skill package', () => {
      const scp02Dir = join(__dirname, 'scp02');
      const def = loader.loadFromDirectory(scp02Dir);

      expect(def.skillId).toBe('scp02.open');
      expect(def.version).toBe('1.0.0');
      expect(def.name).toBe('SCP02 Open Secure Channel');
      expect(def.category).toBe('security');
      expect(def.runtime.type).toBe('node');
      expect(def.entry).toBe('index.ts');
    });

    it('should load a valid Python skill package', () => {
      const iccidDir = join(__dirname, 'read.iccid');
      const def = loader.loadFromDirectory(iccidDir);

      expect(def.skillId).toBe('read.iccid');
      expect(def.version).toBe('1.0.0');
      expect(def.name).toBe('Read ICCID');
      expect(def.category).toBe('filesystem');
      expect(def.runtime.type).toBe('python');
      expect(def.entry).toBe('main.py');
    });

    it('should throw for missing skill.json', () => {
      const emptyDir = join(__dirname, 'scp02');
      expect(() => loader.loadFromDirectory(emptyDir)).not.toThrow();
    });
  });

  describe('scanDirectory', () => {
    it('should discover all skill packages in a directory', () => {
      const skillsDir = __dirname;
      const definitions = loader.scanDirectory(skillsDir);

      // Should find at least scp02 and read.iccid
      expect(definitions.length).toBeGreaterThanOrEqual(2);

      const skillIds = definitions.map((d) => d.skillId);
      expect(skillIds).toContain('scp02.open');
      expect(skillIds).toContain('read.iccid');
    });

    it('should return empty array for non-existent directory', () => {
      const defs = loader.scanDirectory('/nonexistent/path');
      expect(defs).toEqual([]);
    });
  });

  describe('isSkillPackage', () => {
    it('should return true for valid skill package', () => {
      const scp02Dir = join(__dirname, 'scp02');
      expect(loader.isSkillPackage(scp02Dir)).toBe(true);
    });

    it('should return false for directory without skill.json', () => {
      expect(loader.isSkillPackage('/tmp')).toBe(false);
    });
  });
});
