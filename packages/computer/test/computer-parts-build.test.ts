import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { contextOf, ensureJoined, ensurePart, joinedDockerfile } from '../src/parts.js';
import { dockerRuntime } from '../src/runtime.js';
import type { Part } from '../src/parts.js';

/*
 * A part image, built the first time something asks for it.
 *
 * Every build here goes to the scripted docker, so what is under test is the
 * provider's own behaviour - one build for two callers, the `node` part before
 * the part that copies it, no build at all for a tag that is already here - and
 * never Docker. The text of the Dockerfile is asserted out of what the fixture
 * was piped, which is the only place it exists.
 */

let loose: string;
afterEach(() => { rmSync(loose, { recursive: true, force: true }); });

/** The state file the scripted docker reads and writes, in a directory of its own. */
const state = (): string => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-build-'));
  const path = join(loose, 'docker.json');
  writeFileSync(path, `${JSON.stringify({ machines: [], calls: [], images: [], builds: [] })}\n`);
  return path;
};

/** The fake's own record, read back after the calls. */
const held = (path: string): { calls: string[][]; images: string[]; builds: { tag: string; dockerfile: string; files: string[] }[] } =>
  JSON.parse(readFileSync(path, 'utf8'));

/** A Docker runtime that is the scripted docker, standing in for the daemon. */
const runtime = (path: string) => dockerRuntime({
  command: process.execPath,
  args: [fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url))],
  env: { DOCKER_FAKE_STATE: path },
  label: 'ahpd.computer=1',
});

/** The parts these cases are about, rather than the fifteen that ship. */
const parts: Part[] = [
  {
    id: 'node', name: 'Node', kind: 'node', version: '24.21.0',
    archives: {
      'linux-x64': { url: 'https://example.test/node.tar.xz', sha256: 'ab'.repeat(32) },
      'linux-arm64': { url: 'https://example.test/node-arm64.tar.xz', sha256: 'cd'.repeat(32) },
    },
    bin: ['node'],
  },
  {
    id: 'codex', name: 'Codex', kind: 'npm', version: '2.1.1',
    requires: ['node'], packages: ['@agentclientprotocol/codex-acp'], bin: ['codex-acp'],
  },
];

it('builds a missing part and answers its tag, and a second call builds nothing', async () => {
  const path = state();
  const docker = runtime(path);

  expect(await ensurePart('codex', { runtime: docker, parts })).toBe('ahpd-part/codex:2.1.1');
  // The node part is required, so it is built first and the codex build copies
  // its image in by tag.
  expect(held(path).images).toEqual(['ahpd-part/node:24.21.0', 'ahpd-part/codex:2.1.1']);
  expect(held(path).builds[0]?.tag).toBe('ahpd-part/node:24.21.0');
  expect(held(path).builds[1]?.dockerfile).toContain('COPY --from=ahpd-part/node:24.21.0');
  expect(held(path).builds[1]?.dockerfile).toContain('@agentclientprotocol/codex-acp@2.1.1');

  // The second call finds the tag and stops: two builds of one tag would be two
  // downloads of the same tarball and whichever finished last would win.
  expect(await ensurePart('codex', { runtime: docker, parts })).toBe('ahpd-part/codex:2.1.1');
  expect(held(path).builds).toHaveLength(2);
});

it('runs one build for two callers that arrive at once', async () => {
  const path = state();
  const docker = runtime(path);

  const tags = await Promise.all([
    ensurePart('codex', { runtime: docker, parts }),
    ensurePart('codex', { runtime: docker, parts }),
  ]);

  expect(tags).toEqual(['ahpd-part/codex:2.1.1', 'ahpd-part/codex:2.1.1']);
  // The node part and the codex part, once each, whatever the callers were.
  expect(held(path).builds.map((one) => one.tag))
    .toEqual(['ahpd-part/node:24.21.0', 'ahpd-part/codex:2.1.1']);
});

it('runs no build for a tag the daemon already has', async () => {
  const path = state();
  const record = JSON.parse(readFileSync(path, 'utf8')) as { images: string[] };
  record.images.push('ahpd-part/node:24.21.0');
  writeFileSync(path, JSON.stringify(record));

  expect(await ensurePart('codex', { runtime: runtime(path), parts })).toBe('ahpd-part/codex:2.1.1');
  // Only the codex part was missing, so only it was built.
  expect(held(path).builds.map((one) => one.tag)).toEqual(['ahpd-part/codex:2.1.1']);
});

it('refuses a part the file does not name, before any runtime call', async () => {
  const path = state();
  await expect(ensurePart('nope', { runtime: runtime(path), parts })).rejects.toThrow(/names no nope part/);
  expect(held(path).calls).toEqual([]);
});

it('names what Docker said when a build fails, and does not remember the failure', async () => {
  const path = state();
  const record = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  // The node part is already here, so only the codex build is the one that fails.
  record.images = ['ahpd-part/node:24.21.0'];
  record.failBuild = true;
  writeFileSync(path, JSON.stringify(record));

  const docker = runtime(path);
  const failed = await ensurePart('codex', { runtime: docker, parts }).catch((error: unknown) => error as Error);
  expect(failed).toBeInstanceOf(Error);
  expect((failed as Error).message).toContain('build -t ahpd-part/codex:2.1.1 exited 1');
  expect((failed as Error).message).toContain('ERROR: failed to solve');

  /*
   * Both waiters are refused, and the failure is not cached.
   *
   * Two callers share the one build, so both are told why; and the entry is
   * dropped, so the next caller runs its own rather than being handed a refusal
   * for a build that is not being run.
   */
  const also = await Promise.allSettled([
    ensurePart('codex', { runtime: docker, parts }),
    ensurePart('codex', { runtime: docker, parts }),
  ]);
  expect(also.map((one) => one.status)).toEqual(['rejected', 'rejected']);
  expect(held(path).images).toEqual(['ahpd-part/node:24.21.0']);
  expect(held(path).builds.map((one) => one.tag))
    .toEqual(['ahpd-part/codex:2.1.1', 'ahpd-part/codex:2.1.1']);
});

it('pipes a context holding the Dockerfile and nothing else for a part with no files', async () => {
  const path = state();
  await ensurePart('node', { runtime: runtime(path), parts });

  expect(held(path).builds[0]?.files).toEqual(['Dockerfile']);
  expect(held(path).builds[0]?.dockerfile).toContain('FROM debian:bookworm-slim AS fetch');
});

it('puts the tarballs of a checkout in the context beside the Dockerfile', () => {
  const context = contextOf('FROM scratch\n', [
    { name: 'ahpd-server.tgz', bytes: Buffer.from('server') },
    { name: 'agent-cofold.tgz', bytes: Buffer.from('cofold') },
  ]);

  // ustar, so Docker reads it as a context rather than as a Dockerfile.
  expect(context.subarray(257, 262).toString('latin1')).toBe('ustar');
  expect(context.subarray(0, 10).toString('utf8')).toBe('Dockerfile');
  expect(context.length % 512).toBe(0);
  // Three headers, their three data blocks, and the two empty blocks that end a
  // tar: `Dockerfile`, and the two tarballs.
  expect(Math.floor(context.length / 512)).toBe(3 + 3 + 2);
  expect(context.subarray(0, 100).toString('utf8')).toContain('Dockerfile');
  expect(context.toString('utf8')).toContain('ahpd-server.tgz');
  expect(context.toString('utf8')).toContain('agent-cofold.tgz');
  expect(context.toString('utf8')).toContain('FROM scratch');
});

/** The goose part, which is the one this file makes fail. */
const goose: Part = {
  id: 'goose', name: 'Goose', kind: 'archive', version: '1.53.0',
  archives: {
    'linux-x64': { url: 'https://example.test/goose.tar.gz', sha256: 'ab'.repeat(32) },
    'linux-arm64': { url: 'https://example.test/goose-arm64.tar.gz', sha256: 'cd'.repeat(32) },
  },
  bin: ['goose'],
};

it('copies every part into the joined image once, from its own tag, and puts their bins on the PATH', () => {
  const file = joinedDockerfile([...parts, goose], new Map([
    ['node', 'ahpd-part/node:24.21.0'],
    ['codex', 'ahpd-part/codex:2.1.1'],
    ['goose', 'ahpd-part/goose:1.53.0'],
  ]));

  expect(file.split('\n')[0]).toBe('FROM debian:bookworm-slim');
  expect(file).toContain('apt-get install --yes --no-install-recommends ca-certificates git ripgrep');
  expect(file).toContain('COPY --from=ahpd-part/node:24.21.0 /opt/ahpd/node /opt/ahpd/node');
  expect(file).toContain('COPY --from=ahpd-part/codex:2.1.1 /opt/ahpd/codex /opt/ahpd/codex');
  expect(file).toContain('COPY --from=ahpd-part/goose:1.53.0 /opt/ahpd/goose /opt/ahpd/goose');
  expect(file.match(/COPY --from=ahpd-part\//gu)).toHaveLength(3);
  expect(file).toContain('ENV PATH="/opt/ahpd/node/bin:/opt/ahpd/codex/bin:/opt/ahpd/goose/bin:${PATH}"');
  // What it holds is on the image, so a machine it was built without is told
  // from one built from a file that has since moved.
  expect(file).toContain('LABEL ahpd.parts="node,codex,goose"');
});

it('builds the joined image at a tag that moves with the file, and runs no second build for it', async () => {
  const path = state();
  const docker = runtime(path);

  const one = await ensureJoined({ runtime: docker, parts: [...parts, goose] });
  // Twelve hex of the versions file's bytes, and the file that ships is what is
  // hashed - a fixture cannot move the tag, which is why this is a shape and
  // not a value.
  expect(one.tag).toMatch(/^ahpd-agents:[0-9a-f]{12}$/);
  expect(one.missing).toEqual([]);
  expect(one.parts.map((part) => part.id)).toEqual(['node', 'codex', 'goose']);

  const builds = held(path).builds;
  const joined = builds.find((one_) => one_.tag === one.tag);
  expect(joined?.dockerfile).toContain('COPY --from=ahpd-part/goose:1.53.0');
  expect(joined?.dockerfile).toContain('LABEL ahpd.parts="node,codex,goose"');

  // And a second call finds the tag.
  await ensureJoined({ runtime: docker, parts: [...parts, goose] });
  expect(held(path).builds.filter((one_) => one_.tag === one.tag)).toHaveLength(1);
});

it('builds the joined image without the part that failed, and says which one is missing', async () => {
  const path = state();
  const record = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  // One part that will not build, named, so the other two are unaffected.
  record.failBuild = ['ahpd-part/goose:1.53.0'];
  writeFileSync(path, JSON.stringify(record));

  const joined = await ensureJoined({ runtime: runtime(path), parts: [...parts, goose] });

  // The two that built are in the image, and the one that did not is named
  // rather than refused: a machine needing goose is refused by name and every
  // other machine is made.
  expect(joined.missing).toEqual(['goose']);
  expect(joined.parts.map((part) => part.id)).toEqual(['node', 'codex']);
  const build = held(path).builds.find((one) => one.tag === joined.tag);
  expect(build?.dockerfile).not.toContain('goose');
  expect(build?.dockerfile).toContain('LABEL ahpd.parts="node,codex"');
  expect(build?.dockerfile).toContain('COPY --from=ahpd-part/codex:2.1.1 /opt/ahpd/codex /opt/ahpd/codex');
});