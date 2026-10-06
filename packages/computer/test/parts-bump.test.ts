import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { readParts } from '../src/parts.js';

/*
 * The bump script, run the way the workflow runs it.
 *
 * A copy of it in a directory of its own, beside the parts file it reads and
 * writes, so a case writes a file and never the one that ships: the script's
 * paths are relative to itself, and a copy is a whole checkout to it. The
 * registry it is given is a file rather than the feed, so nothing here asks the
 * network or npm.
 */

const SCRIPT = fileURLToPath(new URL('../../../scripts/parts-bump.mjs', import.meta.url));

const loose: string[] = [];
afterEach(() => {
  for (const one of loose.splice(0)) rmSync(one, { recursive: true, force: true });
});

/** An archive part at a version, as the file it is read from spells one. */
const partOf = (id: string, version: string): Record<string, unknown> => ({
  id,
  name: id,
  kind: 'archive',
  version,
  archives: {
    'linux-x64': { url: `https://example.test/${id}-x64.tar.gz`, sha256: 'ab'.repeat(32) },
    'linux-arm64': { url: `https://example.test/${id}-arm64.tar.gz`, sha256: 'cd'.repeat(32) },
  },
  bin: [id],
});

/** The goose part, the one part these cases bump or refuse. */
const GOOSE = partOf('goose', '1.53.0');

/** A registry entry for a part at a version, with the archive and sum each platform is given. */
const entryOf = (
  id: string,
  version: string,
  archive: (platform: string) => string = (platform) => `https://example.test/${id}-${platform}.tar.gz`,
  sha256 = (): string => 'ab'.repeat(32),
): Record<string, unknown> => ({
  id,
  version,
  distribution: {
    binary: {
      'linux-x86_64': { archive: archive('x64'), sha256: sha256() },
      'linux-aarch64': { archive: archive('arm64'), sha256: sha256() },
    },
  },
});

/** One run of the script over a parts file of `parts` and a registry of `agents`. */
const bump = (parts: unknown[], agents: unknown[], dry = false) => {
  const at = mkdtempSync(join(tmpdir(), 'ahpd-bump-'));
  loose.push(at);
  mkdirSync(join(at, 'scripts'), { recursive: true });
  mkdirSync(join(at, 'packages/computer/images'), { recursive: true });
  writeFileSync(join(at, 'scripts/parts-bump.mjs'), readFileSync(SCRIPT));
  const file = join(at, 'packages/computer/images/versions.json');
  writeFileSync(file, `${JSON.stringify(parts, null, 2)}\n`);
  const registry = join(at, 'registry.json');
  writeFileSync(registry, JSON.stringify({ agents }));
  const run = spawnSync(process.execPath, [
    join(at, 'scripts/parts-bump.mjs'), '--registry', registry, ...(dry ? ['--dry-run'] : []),
  ], { encoding: 'utf8' });
  return {
    said: `${run.stdout ?? ''}${run.stderr ?? ''}`,
    file,
    wrote: (): Record<string, unknown>[] => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>[],
  };
};

it('never proposes a prerelease, and proposes the release that follows it', () => {
  const candidate = bump([GOOSE], [entryOf('goose', '1.54.0-rc.1')], true);

  // The registry is offering a version somebody is still working on: the part
  // stays where it is and the run says why rather than moving to it.
  expect(candidate.said).toContain('skipped goose:');
  expect(candidate.said).toContain('1.54.0-rc.1');
  expect(candidate.said).not.toContain('bumped goose');
  expect(candidate.said).toContain('Nothing moved.');

  // And the release it is a candidate for is the one that moves it.
  const released = bump([GOOSE], [entryOf('goose', '1.54.0')], true);
  expect(released.said).toContain('bumped goose 1.53.0 -> 1.54.0, 2 archives');
});

it('skips a part whose archive url is not a plain https url, by name', () => {
  const at = bump([GOOSE], [entryOf('goose', '1.54.0', (platform) => `http://example.test/goose-${platform}.tar.gz`)], true);

  expect(at.said).toContain('skipped goose:');
  expect(at.said).toContain('http://example.test/goose-x64.tar.gz');
  expect(at.said).not.toContain('bumped goose');
});

it('writes a file that reads, skipping the part whose version is not one version', () => {
  // A feed that answers `latest`, which compares as newer than any version and
  // is not one: written, it would refuse the whole file at the next start. The
  // run still writes, because the part beside it has a move of its own.
  const at = bump(
    [GOOSE, partOf('pi', '0.0.34')],
    [entryOf('goose', 'latest'), entryOf('pi', '0.0.35')],
  );

  expect(at.said).toContain('skipped goose: the registry has latest, which is not one version');
  expect(at.said).toContain('bumped pi 0.0.34 -> 0.0.35, 2 archives');
  expect(at.said).toContain('Wrote ');

  const parts = readParts(at.file);
  expect(parts.map((one) => one.id)).toEqual(['goose', 'pi']);
  expect(parts[0]?.version).toBe('1.53.0');
  expect(parts[0]?.archives?.['linux-x64']?.url).toBe('https://example.test/goose-x64.tar.gz');
  expect(parts[1]?.version).toBe('0.0.35');
});

it('writes the moves a registry entry that is one version does make', () => {
  const at = bump([GOOSE], [entryOf('goose', '1.54.0')]);

  expect(at.said).toContain('bumped goose 1.53.0 -> 1.54.0, 2 archives');
  const parts = readParts(at.file);
  expect(parts[0]?.version).toBe('1.54.0');
  expect(parts[0]?.archives?.['linux-arm64']?.sha256).toBe('ab'.repeat(32));
});
