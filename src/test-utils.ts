import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

export function makeTmpDir(): string {
  const dir = join(tmpdir(), `pdh-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
