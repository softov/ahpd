import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

/*
 * A line a package's code writes goes through the daemon's log, which gives it
 * a time and a level. `console` skips both, and in a detached daemon its lines
 * land in `daemon.log` bare. So no source in a package's `src` calls it. A
 * comment that names it is not a call.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..');
const PACKAGES = join(ROOT, 'packages');

/** Every `.ts` under a directory, recursively. */
const sources = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
  const path = join(dir, entry);
  if (statSync(path).isDirectory()) return sources(path);
  return path.endsWith('.ts') ? [path] : [];
});

it('finds no console call in the sources of any package', () => {
  const calls: string[] = [];
  for (const name of readdirSync(PACKAGES)) {
    const src = join(PACKAGES, name, 'src');
    try { if (!statSync(src).isDirectory()) continue; } catch { continue; }
    for (const file of sources(src)) {
      readFileSync(file, 'utf8').split('\n').forEach((line, at) => {
        const code = line.trimStart();
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
        if (/\bconsole\.(log|info|warn|error|debug|trace)\(/u.test(line)) calls.push(`${relative(ROOT, file)}:${String(at + 1)}`);
      });
    }
  }
  expect(calls).toEqual([]);
});
