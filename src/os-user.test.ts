import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process before importing the module
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

// Mock node:fs for existsSync
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return {
    ...original,
    existsSync: vi.fn(original.existsSync),
  };
});

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  osUserExists,
  createOsUser,
  lockdownFiles,
  findAvailableUidMac,
  checkProcessOwner,
  PDH_USER,
} from './os-user.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockExecSync = execSync as any as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>;

describe('os-user', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
    mockExistsSync.mockReset();
  });

  describe('osUserExists', () => {
    it('returns true when id command succeeds', () => {
      mockExecSync.mockReturnValue('');
      expect(osUserExists()).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(`id ${PDH_USER}`, { stdio: 'ignore' });
    });

    it('returns false when id command fails', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('no such user');
      });
      expect(osUserExists()).toBe(false);
    });
  });

  describe('createOsUser', () => {
    it('no-ops when user already exists', () => {
      mockExecSync.mockReturnValue('');
      createOsUser();
      expect(mockExecSync).toHaveBeenCalledTimes(1);
      expect(mockExecSync).toHaveBeenCalledWith(`id ${PDH_USER}`, { stdio: 'ignore' });
    });

    it('creates user on Linux when user does not exist', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      let callCount = 0;
      mockExecSync.mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error('no such user');
        return '';
      });

      createOsUser();

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('useradd'),
        expect.objectContaining({ stdio: 'inherit' }),
      );

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });
  });

  describe('findAvailableUidMac', () => {
    it('returns first available UID in 400-499 range', () => {
      mockExecSync.mockReturnValue(
        'root                  0\n' +
        'daemon                1\n' +
        '_spotlight          400\n' +
        '_windowmanager      401\n',
      );

      const uid = findAvailableUidMac();
      expect(uid).toBe(402);
    });

    it('returns 400 when no system UIDs are in use', () => {
      mockExecSync.mockReturnValue(
        'root    0\n' +
        'daemon  1\n' +
        'nobody  -2\n',
      );

      const uid = findAvailableUidMac();
      expect(uid).toBe(400);
    });

    it('throws when all UIDs in range are taken', () => {
      const lines = Array.from({ length: 100 }, (_, i) =>
        `user${i}    ${400 + i}`,
      ).join('\n');
      mockExecSync.mockReturnValue(lines);

      expect(() => findAvailableUidMac()).toThrow('No available UID');
    });
  });

  describe('lockdownFiles', () => {
    it('chowns and chmods each existing file', () => {
      mockExecSync.mockReturnValue('');
      mockExistsSync.mockReturnValue(true);

      lockdownFiles(['/tmp/test.db', '/tmp/.env']);

      const calls = mockExecSync.mock.calls.map((c: unknown[]) => c[0]);
      expect(calls).toContain(`sudo chown ${PDH_USER}:staff "/tmp/test.db"`);
      expect(calls).toContain('sudo chmod 600 "/tmp/test.db"');
      expect(calls).toContain(`sudo chown ${PDH_USER}:staff "/tmp/.env"`);
      expect(calls).toContain('sudo chmod 600 "/tmp/.env"');
    });

    it('skips non-existent files', () => {
      mockExecSync.mockReturnValue('');
      mockExistsSync.mockReturnValue(false);

      lockdownFiles(['/tmp/nonexistent.db']);

      expect(mockExecSync).not.toHaveBeenCalled();
    });
  });

  describe('checkProcessOwner', () => {
    it('returns same_user when kill(0) succeeds', () => {
      const spy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      expect(checkProcessOwner(1234)).toBe('same_user');
      spy.mockRestore();
    });

    it('returns other_user when kill(0) throws EPERM', () => {
      const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
        const err = new Error('EPERM') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      });
      expect(checkProcessOwner(1234)).toBe('other_user');
      spy.mockRestore();
    });

    it('returns not_found when kill(0) throws ESRCH', () => {
      const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
        const err = new Error('ESRCH') as NodeJS.ErrnoException;
        err.code = 'ESRCH';
        throw err;
      });
      expect(checkProcessOwner(1234)).toBe('not_found');
      spy.mockRestore();
    });
  });
});
