import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { posix } from '../../../tools/posix.ts';
import { dockerfileOf, lockOf, readParts, registryOf, tagOf } from '../src/parts.js';
import type { Part } from '../src/parts.js';

/*
 * The release workflow's part builder, run the way the workflow runs it, over
 * the scripted docker standing in for `docker` on `PATH`: each part is built
 * once for both platforms a machine runs on and pushed at the tag a host pulls,
 * as VS Code's build produces each agent SDK once per release for its hosts to
 * download (build/agent-sdk/README.md L1-L5 at 6b68d3fe), and a tag already
 * published is left as it is (L52).
 */

const SCRIPT = fileURLToPath(new URL('../../../scripts/parts-publish.mjs', import.meta.url));
const DEV = fileURLToPath(new URL('../../../scripts/dev.mjs', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));

const loose: string[] = [];
afterEach(() => {
  for (const one of loose.splice(0)) rmSync(one, { recursive: true, force: true });
});

interface Built { platforms: string[]; tags: string[]; contexts: string[]; labels: string[]; push: boolean; dockerfile?: string; files?: string[] }
interface Held { buildx?: Built[]; builds?: { tag: string }[]; published?: string[] }

/** One run of the script with these arguments, over a scripted docker holding `state`. */
const publish = (args: string[], state: Record<string, unknown> = {}): { held: Held; status: number | null; out: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-parts-publish-'));
  loose.push(dir);
  const path = join(dir, 'docker.json');
  writeFileSync(path, JSON.stringify({ machines: [], calls: [], images: [], ...state }));
  writeFileSync(join(dir, 'docker'), `#!/bin/sh\nexec "${process.execPath}" "${FIXTURE}" "$@"\n`, { mode: 0o755 });
  // The checkout's own ahpd part is not what a release publishes.
  const env = { ...process.env };
  delete env.AHPD_PART_AHPD_ROOT;
  const ran = spawnSync(process.execPath, ['--conditions', 'development', '--import', DEV, SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...env, PATH: `${dir}:${process.env.PATH ?? ''}`, DOCKER_FAKE_STATE: path },
  });
  return { held: JSON.parse(readFileSync(path, 'utf8')) as Held, status: ran.status, out: ran.stdout };
};

const parts = readParts();
const node = parts.find((one) => one.kind === 'node') as Part;
const codex = parts.find((one) => one.id === 'codex') as Part;
const tagFor = (part: Part): string => tagOf(part, undefined, dockerfileOf(part, undefined, lockOf(part)));
const remoteFor = (part: Part): string => `${registryOf()}/${tagFor(part)}`;

// POSIX-only: the stand-in docker is a shell script on `PATH`, which Windows does not run.
it.skipIf(!posix)('builds every part for both platforms and pushes it where a host pulls it, node before what copies it in', () => {
  const { held, status } = publish(['--push']);
  expect(status).toBe(0);
  const built = held.buildx ?? [];
  // Each part once, for both platforms, pushed, labelled with the repository.
  expect(built).toHaveLength(parts.length);
  expect(built.every((one) => one.push && one.platforms.join() === 'linux/amd64,linux/arm64')).toBe(true);
  expect(built.every((one) => one.labels.join() === 'org.opencontainers.image.source=https://github.com/softov/ahpd')).toBe(true);
  const at = (part: Part): number => built.findIndex((one) => one.tags.includes(remoteFor(part)));
  expect(at(node)).toBe(0);
  // The codex part copies node in by its tag, which here is the registry's image of it.
  const one = built[at(codex)];
  expect(one?.dockerfile).toBe(dockerfileOf(codex, undefined, lockOf(codex)));
  expect(one?.contexts).toEqual([`${tagFor(node)}=docker-image://${remoteFor(node)}`]);
  expect(built[0]?.contexts).toEqual([]);
  // An npm part is built from its two files, and node, which installs nothing by npm, from none.
  expect(one?.files).toEqual(['package.json', 'package-lock.json']);
  expect(built[0]?.files).toEqual([]);
  // Nothing was built into this host's own images.
  expect(held.builds ?? []).toEqual([]);
});

// POSIX-only: the stand-in docker is a shell script on `PATH`, which Windows does not run.
it.skipIf(!posix)('leaves a tag already published as it is', () => {
  const { held, out } = publish(['--push'], { published: [remoteFor(codex)] });
  expect((held.buildx ?? []).some((one) => one.tags.includes(remoteFor(codex)))).toBe(false);
  expect(out).toContain(`${remoteFor(codex)} is already published`);
  expect((held.buildx ?? []).some((one) => one.tags.includes(remoteFor(node)))).toBe(true);
});

// POSIX-only: the stand-in docker is a shell script on `PATH`, which Windows does not run.
it.skipIf(!posix)('rehearses without pushing, and says which part it cannot build on a node not published yet', () => {
  const { held, out } = publish([]);
  const built = held.buildx ?? [];
  expect(built.every((one) => !one.push)).toBe(true);
  expect(built.some((one) => one.tags.includes(remoteFor(node)))).toBe(true);
  expect(built.some((one) => one.tags.includes(remoteFor(codex)))).toBe(false);
  expect(out).toContain(`codex is not rehearsed: it copies in ${remoteFor(node)}, not published yet`);
  expect(held.published ?? []).toEqual([]);
});

// POSIX-only: the stand-in docker is a shell script on `PATH`, which Windows does not run.
it.skipIf(!posix)('builds every part on this host\'s Docker at the tag its daemon asks for, with --local', () => {
  const { held, status } = publish(['--local']);
  expect(status).toBe(0);
  const tags = (held.builds ?? []).map((one) => one.tag);
  expect(tags).toHaveLength(parts.length);
  expect(tags[0]).toBe(tagFor(node));
  expect(tags).toContain(tagFor(codex));
  expect(held.buildx ?? []).toEqual([]);
});
