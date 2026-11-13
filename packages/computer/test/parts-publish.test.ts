import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { posix } from '../../../tools/posix.ts';
import { dockerfileOf, JOINED_BASE, lockOf, readParts, registryOf, tagOf } from '../src/parts.js';
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

/**
 * One run of the script with these arguments, over a scripted docker holding
 * `state`. A `--push` writes its digests into the run's own folder, never into
 * the checkout's `images`, and `digests` is what it wrote, if anything. The
 * script runs as a child the case waits on, so the worker still answers vitest
 * while a run lasts.
 */
const publish = async (args: string[], state: Record<string, unknown> = {}): Promise<{
  held: Held; status: number | null; out: string; digests?: Record<string, string>;
}> => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-parts-publish-'));
  loose.push(dir);
  const path = join(dir, 'docker.json');
  const digests = join(dir, 'digests.json');
  writeFileSync(path, JSON.stringify({ machines: [], calls: [], images: [], ...state }));
  writeFileSync(join(dir, 'docker'), `#!/bin/sh\nexec "${process.execPath}" "${FIXTURE}" "$@"\n`, { mode: 0o755 });
  // The checkout's own ahpd part is not what a release publishes.
  const env = { ...process.env };
  delete env.AHPD_PART_AHPD_ROOT;
  const own = args.includes('--push') && !args.includes('--digests') ? ['--digests', digests] : [];
  const ran = await new Promise<{ status: number | null; stdout: string }>((done, fail) => {
    const child = spawn(process.execPath, ['--conditions', 'development', '--import', DEV, SCRIPT, ...args, ...own], {
      env: { ...env, PATH: `${dir}:${process.env.PATH ?? ''}`, DOCKER_FAKE_STATE: path },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.on('error', fail);
    child.on('close', (status) => { done({ status, stdout }); });
  });
  return {
    held: JSON.parse(readFileSync(path, 'utf8')) as Held,
    status: ran.status,
    out: ran.stdout,
    ...(existsSync(digests) ? { digests: JSON.parse(readFileSync(digests, 'utf8')) as Record<string, string> } : {}),
  };
};

/** The digest the scripted docker answers for a published reference it was given no digest for. */
const fakeDigest = (reference: string): string => `sha256:${createHash('sha256').update(reference).digest('hex')}`;

/*
 * Each case runs the release script whole, and every docker call it makes
 * starts a node process for the stand-in: about five seconds a case, past the
 * suite's default on a busy machine.
 */
const CASE_MS = 20_000;

const parts = readParts();
const node = parts.find((one) => one.kind === 'node') as Part;
const codex = parts.find((one) => one.id === 'codex') as Part;
const tagFor = (part: Part): string => tagOf(part, undefined, dockerfileOf(part, undefined, lockOf(part)));
const remoteFor = (part: Part): string => `${registryOf()}/${tagFor(part)}`;

// POSIX-only: the stand-in docker is a shell script on `PATH`, which Windows does not run.
it.skipIf(!posix)('builds every part for both platforms and pushes it where a host pulls it, node before what copies it in', async () => {
  const { held, status } = await publish(['--push']);
  expect(status).toBe(0);
  const built = held.buildx ?? [];
  // Each part once, and the joined image after them, for both platforms,
  // pushed, labelled with the repository.
  expect(built).toHaveLength(parts.length + 1);
  expect(built.every((one) => one.push && one.platforms.join() === 'linux/amd64,linux/arm64')).toBe(true);
  expect(built.every((one) => one.labels.join() === 'org.opencontainers.image.source=https://github.com/ahpio/ahpd')).toBe(true);
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
}, CASE_MS);

/*
 * The joined image is built at release with the parts, every part copied in
 * from the tag it is published at, on the base its Dockerfile pins by digest,
 * and pushed where a host whose parts all loaded at those tags pulls it.
 */
// POSIX-only: the stand-in docker is a shell script on `PATH`, which Windows does not run.
it.skipIf(!posix)('builds the joined image last, every part copied in from its published tag on the pinned base, and pushes it', async () => {
  const { held, status } = await publish(['--push']);
  expect(status).toBe(0);
  const joined = (held.buildx ?? []).at(-1);
  expect(joined?.tags).toHaveLength(1);
  expect(joined?.tags[0]).toMatch(new RegExp(`^${registryOf()}/ahpd-agents:[0-9a-f]{12}$`));
  expect(joined?.push).toBe(true);
  expect(joined?.platforms.join()).toBe('linux/amd64,linux/arm64');
  expect(joined?.dockerfile?.split('\n')[0]).toBe(`FROM ${JOINED_BASE}`);
  expect(joined?.dockerfile).toContain(`COPY --from=${tagFor(codex)} /opt/ahpd/codex /opt/ahpd/codex`);
  expect(joined?.contexts).toHaveLength(parts.length);
  expect(joined?.contexts).toContain(`${tagFor(codex)}=docker-image://${remoteFor(codex)}`);
  expect(joined?.files).toEqual([]);
}, CASE_MS);

// POSIX-only: the stand-in docker is a shell script on `PATH`, which Windows does not run.
it.skipIf(!posix)('leaves a tag already published as it is', async () => {
  const { held, out } = await publish(['--push'], { published: [remoteFor(codex)] });
  expect((held.buildx ?? []).some((one) => one.tags.includes(remoteFor(codex)))).toBe(false);
  expect(out).toContain(`${remoteFor(codex)} is already published`);
  expect((held.buildx ?? []).some((one) => one.tags.includes(remoteFor(node)))).toBe(true);
}, CASE_MS);

// POSIX-only: the stand-in docker is a shell script on `PATH`, which Windows does not run.
it.skipIf(!posix)('rehearses without pushing, and says which part it cannot build on a node not published yet', async () => {
  const { held, out } = await publish([]);
  const built = held.buildx ?? [];
  expect(built.every((one) => !one.push)).toBe(true);
  expect(built.some((one) => one.tags.includes(remoteFor(node)))).toBe(true);
  expect(built.some((one) => one.tags.includes(remoteFor(codex)))).toBe(false);
  expect(out).toContain(`codex is not rehearsed: it copies in ${remoteFor(node)}, not published yet`);
  expect(held.published ?? []).toEqual([]);
}, CASE_MS);

// POSIX-only: the stand-in docker is a shell script on `PATH`, which Windows does not run.
it.skipIf(!posix)('builds every part on this host\'s Docker at the tag its daemon asks for, with --local', async () => {
  const { held, status } = await publish(['--local']);
  expect(status).toBe(0);
  const tags = (held.builds ?? []).map((one) => one.tag);
  // Each part, and the joined image of them last.
  expect(tags).toHaveLength(parts.length + 1);
  expect(tags[0]).toBe(tagFor(node));
  expect(tags).toContain(tagFor(codex));
  expect(tags.at(-1)).toMatch(/^ahpd-agents:[0-9a-f]{12}$/);
  expect(held.buildx ?? []).toEqual([]);
}, CASE_MS);

// POSIX-only: the stand-in docker is a shell script on `PATH`, which Windows does not run.
it.skipIf(!posix)('writes the digest of each image it pushed, by the tag a host asks for, the joined image included', async () => {
  const { status, digests } = await publish(['--push']);
  expect(status).toBe(0);
  const tags = Object.keys(digests ?? {});
  expect(tags).toHaveLength(parts.length + 1);
  expect(digests?.[tagFor(codex)]).toBe(fakeDigest(remoteFor(codex)));
  expect(tags.find((one) => one.startsWith('ahpd-agents:'))).toMatch(/^ahpd-agents:[0-9a-f]{12}$/);
  // Sorted by tag, so two runs over the same registry write the same bytes.
  expect(tags).toEqual([...tags].sort((one, two) => one.localeCompare(two)));
}, CASE_MS);

// POSIX-only: the stand-in docker is a shell script on `PATH`, which Windows does not run.
it.skipIf(!posix)('reads the digest of an image already published, and builds nothing for it', async () => {
  const pinned = `sha256:${'a'.repeat(64)}`;
  const { held, status, digests } = await publish(['--push'], { published: [remoteFor(codex)], digests: { [remoteFor(codex)]: pinned } });
  expect(status).toBe(0);
  expect((held.buildx ?? []).some((one) => one.tags.includes(remoteFor(codex)))).toBe(false);
  expect(digests?.[tagFor(codex)]).toBe(pinned);
}, CASE_MS);

// POSIX-only: the stand-in docker is a shell script on `PATH`, which Windows does not run.
it.skipIf(!posix)('fails the run for an image the registry answers no sha256 digest for, and names it', async () => {
  const { status, out, digests } = await publish(['--push'], { digests: { [remoteFor(codex)]: 'md5:nothing' } });
  expect(status).toBe(1);
  expect(out).toContain(`codex has no digest: the registry answered none for ${remoteFor(codex)}`);
  expect(digests?.[tagFor(codex)]).toBeUndefined();
  expect(digests?.[tagFor(node)]).toBe(fakeDigest(remoteFor(node)));
}, CASE_MS);

// POSIX-only: the stand-in docker is a shell script on `PATH`, which Windows does not run.
it.skipIf(!posix)('writes no digests for a rehearsal', async () => {
  expect((await publish([])).out).not.toContain('digests written');
}, CASE_MS);

// POSIX-only: the stand-in docker is a shell script on `PATH`, which Windows does not run.
it.skipIf(!posix)('writes no digests for a build on this host', async () => {
  expect((await publish(['--local'])).out).not.toContain('digests written');
}, CASE_MS);

// POSIX-only: the stand-in docker is a shell script on `PATH`, which Windows does not run.
it.skipIf(!posix)('refuses --digests without --push', async () => {
  expect((await publish(['--local', '--digests', join(tmpdir(), 'unused.json')])).status).toBe(2);
}, CASE_MS);
