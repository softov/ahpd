import { posix } from '../../../tools/posix.ts';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { contextOf, dockerfileOf, ensureJoined, ensurePart, JOINED_BASE, joinedDockerfile, lockOf, readParts, registryOf, tagOf } from '../src/parts.js';
import { dockerRuntime } from '../src/runtime.js';
import type { Part } from '../src/parts.js';

/*
 * A part image, pulled the first time something asks for it from where the
 * release workflow pushed it, as VS Code's host downloads an agent SDK its
 * build produced (build/agent-sdk/README.md L1-L5 at 6b68d3fe).
 *
 * Every pull and build here goes to the scripted docker, so what is under test
 * is the provider's own behaviour - one pull for two callers, the `node` part
 * before the part that runs on it, no pull at all for a tag that is already
 * here - and never Docker. The text of a Dockerfile is asserted out of what the
 * fixture was piped, which is the only place it exists.
 */

let loose: string | undefined;
afterEach(() => { if (loose !== undefined) rmSync(loose, { recursive: true, force: true }); });

/** The state file the scripted docker reads and writes, in a directory of its own. */
const state = (): string => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-build-'));
  const path = join(loose, 'docker.json');
  writeFileSync(path, `${JSON.stringify({ machines: [], calls: [], images: [], builds: [] })}\n`);
  return path;
};

/** The fake's own record, read back after the calls. */
const held = (path: string): {
  calls: string[][];
  images: string[];
  builds: { tag: string; dockerfile: string; files: string[] }[];
  pulls?: string[];
} => JSON.parse(readFileSync(path, 'utf8'));

/** A Docker runtime that is the scripted docker, standing in for the daemon. */
const runtime = (path: string) => dockerRuntime({
  command: process.execPath,
  args: [fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url))],
  env: { DOCKER_FAKE_STATE: path },
  label: 'ahpd.computer=1',
});

/**
 * The node part as the file ships it.
 *
 * It is the shipped one rather than a stand-in because `dockerfileOf` names the
 * `node` tag it copies from out of `readParts()`, so a node part written here
 * would be built at one tag and copied from another - which is the shape of the
 * whole file, and not what these cases are about.
 */
const node = readParts().find((one) => one.kind === 'node') as Part;

/** The parts these cases are about, rather than the fifteen that ship. */
const codex: Part = {
  id: 'codex', name: 'Codex', kind: 'npm', version: '2.1.1',
  requires: ['node'], packages: ['@agentclientprotocol/codex-acp'], bin: ['codex-acp'],
};
const parts: Part[] = [node, codex];

/**
 * The tag a part is built at.
 *
 * It is the version and a hash of the Dockerfile text that writes it, and the
 * text is what `dockerfileOf` returns, so these cases name a tag the way the
 * code does rather than spelling the hash of a Dockerfile they do not hold.
 * The tag's own shape is asserted in `computer-parts.test.ts`.
 */
const tagFor = (part: Part): string => tagOf(part, undefined, dockerfileOf(part, undefined, lockOf(part)));

/** Where the release workflow pushed a part, which is where a host pulls it from. */
const remoteFor = (part: Part): string => `${registryOf()}/${tagFor(part)}`;

/** What the scripted docker was asked to pull from the parts' registry, in order. */
const pulled = (path: string): string[] => (held(path).pulls ?? []).filter((one) => one.startsWith(`${registryOf()}/`));

/** The joined image's `ahpd.parts` label line for these part ids, JSON as the machine's label is. */
const labelLine = (...ids: string[]): string => `LABEL ahpd.parts=${JSON.stringify(JSON.stringify(ids.map((id) => ({ id }))))}`;

it('pulls a missing part at its tag from the registry the package names, and a second call pulls nothing', async () => {
  const path = state();
  const docker = runtime(path);

  expect(await ensurePart('codex', { runtime: docker, parts })).toBe(tagFor(codex));
  // The node part is required, so it is pulled first; each is tagged here by
  // the tag every machine names it by, and nothing is built.
  expect(pulled(path)).toEqual([remoteFor(node), remoteFor(codex)]);
  expect(held(path).images).toEqual([remoteFor(node), tagFor(node), remoteFor(codex), tagFor(codex)]);
  expect(held(path).builds).toEqual([]);

  // The second call finds the tag and stops.
  expect(await ensurePart('codex', { runtime: docker, parts })).toBe(tagFor(codex));
  expect(pulled(path)).toHaveLength(2);
});

/** A digests file beside the state file, as the release writes one: each tag's digest. */
const digestsFile = (path: string, digests: Record<string, unknown> | string): string => {
  const file = join(path, '..', 'digests.json');
  writeFileSync(file, typeof digests === 'string' ? digests : `${JSON.stringify(digests)}\n`);
  return file;
};

/** A digest of the shape the registry answers, one per letter. */
const digestFor = (letter: string): string => `sha256:${letter.repeat(64)}`;

it('pulls a part by the digest the release pinned, and tags it by the tag every machine names', async () => {
  const path = state();
  const digests = digestsFile(path, { [tagFor(node)]: digestFor('a'), [tagFor(codex)]: digestFor('b') });
  const lines: string[] = [];

  expect(await ensurePart('codex', { runtime: runtime(path), parts, digests, log: (line) => { lines.push(line); } })).toBe(tagFor(codex));
  const named = (tag: string): string => `${registryOf()}/${tag.slice(0, tag.lastIndexOf(':'))}`;
  expect(pulled(path)).toEqual([`${named(tagFor(node))}@${digestFor('a')}`, `${named(tagFor(codex))}@${digestFor('b')}`]);
  expect(held(path).images).toContain(tagFor(codex));
  expect(lines.some((line) => line.includes('no pinned digest'))).toBe(false);
});

it('pulls a part by its tag when no digest is pinned, and says so once for each part', async () => {
  const path = state();
  const digests = digestsFile(path, { [tagFor(node)]: digestFor('a') });
  const said: [string, string | undefined][] = [];

  await ensurePart('codex', { runtime: runtime(path), parts, digests, log: (line, level) => { said.push([line, level]); } });
  expect(pulled(path)).toEqual([`${registryOf()}/${tagFor(node).replace(/:[^:]*$/, '')}@${digestFor('a')}`, remoteFor(codex)]);
  expect(said.filter(([line]) => line.includes('no pinned digest'))).toEqual([[`${tagFor(codex)} has no pinned digest, so it is pulled by its tag`, 'warn']]);
});

it('refuses a part when the digests file is not an object of sha256 digests, and names the file', async () => {
  const path = state();
  const digests = digestsFile(path, { [tagFor(node)]: 'md5:nothing' });

  await expect(ensurePart('codex', { runtime: runtime(path), parts, digests })).rejects.toThrow(`${digests} is not an object of sha256 digests by tag`);
  expect(pulled(path)).toEqual([]);
});

it('pulls the joined image by the digest the release pinned for its tag', async () => {
  // The tag the joined image is asked for, read off a host with no digests.
  const first = state();
  const { tag } = await ensureJoined({ runtime: runtime(first), parts });

  const path = state();
  const digests = digestsFile(path, { [tagFor(node)]: digestFor('a'), [tagFor(codex)]: digestFor('b'), [tag]: digestFor('c') });
  const joined = await ensureJoined({ runtime: runtime(path), parts, digests });
  expect(joined.tag).toBe(tag);
  expect(pulled(path)).toContain(`${registryOf()}/ahpd-agents@${digestFor('c')}`);
  expect(held(path).images).toContain(tag);
});

it('answers the GitHub container registry of the repository the package names', () => {
  expect(registryOf()).toBe('ghcr.io/ahpio');
});

it('runs one pull for two callers that arrive at once', async () => {
  const path = state();
  const docker = runtime(path);

  const tags = await Promise.all([
    ensurePart('codex', { runtime: docker, parts }),
    ensurePart('codex', { runtime: docker, parts }),
  ]);

  expect(tags).toEqual([tagFor(codex), tagFor(codex)]);
  // The node part and the codex part, once each, whatever the callers were.
  expect(pulled(path)).toEqual([remoteFor(node), remoteFor(codex)]);
});

it('pulls nothing for a tag the daemon already has', async () => {
  const path = state();
  const record = JSON.parse(readFileSync(path, 'utf8')) as { images: string[] };
  record.images.push(tagFor(node));
  writeFileSync(path, JSON.stringify(record));

  expect(await ensurePart('codex', { runtime: runtime(path), parts })).toBe(tagFor(codex));
  // Only the codex part was missing, so only it was pulled.
  expect(pulled(path)).toEqual([remoteFor(codex)]);
});

it('refuses a part the file does not name, before any runtime call', async () => {
  const path = state();
  await expect(ensurePart('nope', { runtime: runtime(path), parts })).rejects.toThrow(/names no nope part/);
  expect(held(path).calls).toEqual([]);
});

/*
 * A failed load is refused for 30 seconds and loaded again after, as VS Code
 * holds a failed SDK load (agentSdkDownloader.ts L230-L231 and L372-L395 at
 * 6b68d3fe), so every machine asking in the meantime is not one more pull.
 */
it('names what Docker said when a pull fails, refuses the part for 30 seconds, and pulls it again after', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    const path = state();
    const record = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    // The node part is already here, so only the codex pull is the one that fails.
    record.images = [tagFor(node)];
    record.failPull = [remoteFor(codex)];
    writeFileSync(path, JSON.stringify(record));

    const docker = runtime(path);
    const failed = await ensurePart('codex', { runtime: docker, parts }).catch((error: unknown) => error as Error);
    expect(failed).toBeInstanceOf(Error);
    expect((failed as Error).message).toContain(`pull ${remoteFor(codex)} exited 1`);
    expect((failed as Error).message).toContain('pull access denied');

    // Within the 30 seconds both callers are told the same failure, and nothing
    // is pulled for either.
    vi.setSystemTime(Date.now() + 29_000);
    const also = await Promise.allSettled([
      ensurePart('codex', { runtime: docker, parts }),
      ensurePart('codex', { runtime: docker, parts }),
    ]);
    expect(also.map((one) => (one.status === 'rejected' ? (one.reason as Error).message : one.status)))
      .toEqual([(failed as Error).message, (failed as Error).message]);
    expect(pulled(path)).toEqual([remoteFor(codex)]);

    // A failure on one runtime refuses nothing on another: that one pulls.
    await expect(ensurePart('codex', { runtime: runtime(path), parts })).rejects.toThrow(/pull access denied/);
    expect(pulled(path)).toEqual([remoteFor(codex), remoteFor(codex)]);

    // After the 30 seconds the part is pulled again, and a pull that works is the answer.
    vi.setSystemTime(Date.now() + 2_000);
    writeFileSync(path, JSON.stringify({ ...held(path), failPull: [] }));
    expect(await ensurePart('codex', { runtime: docker, parts })).toBe(tagFor(codex));
    expect(pulled(path)).toEqual([remoteFor(codex), remoteFor(codex), remoteFor(codex)]);
  }
  finally {
    vi.useRealTimers();
  }
});

/** What the scripted docker ran as part checks: the image, the part images mounted, the launchers. */
const checks = (path: string): { image: string; parts: string[]; launchers: string[] }[] =>
  (held(path) as unknown as { checks?: { image: string; parts: string[]; launchers: string[] }[] }).checks ?? [];

/** The state file with these images already here, and the scripted docker's failures. */
const seeded = (path: string, over: Record<string, unknown>): void => {
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), ...over }));
};

/*
 * A pulled part's launchers each run once with `--version`, in the image a
 * machine runs, as VS Code runs its CLI's `--version` after an install
 * (remoteAgentHostCliInstaller.ts L102-L106 at 6b68d3fe).
 */
it('runs each launcher of a pulled part once with --version, in the image a machine runs, the parts it requires mounted', async () => {
  const path = state();
  await ensurePart('codex', { runtime: runtime(path), parts });
  expect(checks(path)).toEqual([
    { image: 'debian:bookworm-slim', parts: [tagFor(node)], launchers: ['/opt/ahpd/node/bin/node', '/opt/ahpd/node/bin/npm', '/opt/ahpd/node/bin/npx'] },
    { image: 'debian:bookworm-slim', parts: [tagFor(node), tagFor(codex)], launchers: ['/opt/ahpd/codex/bin/codex-acp'] },
  ]);
  // A part already here is reused as it is, as VS Code reuses its CLI.
  await ensurePart('codex', { runtime: runtime(path), parts });
  expect(checks(path)).toHaveLength(2);
});

/*
 * A pull that fails, or a pulled image that fails its check, falls back to the
 * newest earlier image of the part whose launchers answer, as VS Code falls
 * back to an older CLI it finds (remoteAgentHostCliInstaller.ts L111-L123,
 * L158-L175 at 6b68d3fe); the image that failed its check loses its tag.
 */
it('loads the newest earlier image of a part whose pull fails, once its launchers answer', async () => {
  const path = state();
  seeded(path, { images: [tagFor(node), 'ahpd-part/codex:2.0.0-aaaaaaaaaaaa', 'ahpd-part/codex:2.1.0-bbbbbbbbbbbb'], failPull: [remoteFor(codex)] });
  const lines: string[] = [];
  expect(await ensurePart('codex', { runtime: runtime(path), parts, log: (line) => { lines.push(line); } }))
    .toBe('ahpd-part/codex:2.1.0-bbbbbbbbbbbb');
  expect(checks(path).at(-1)?.parts).toEqual([tagFor(node), 'ahpd-part/codex:2.1.0-bbbbbbbbbbbb']);
  expect(lines.at(-1)).toBe(`using ahpd-part/codex:2.1.0-bbbbbbbbbbbb, an earlier image of the codex part, in place of ${tagFor(codex)}`);
});

it('takes the tag from a pulled image that fails its check, and loads the newest earlier image that answers', async () => {
  const path = state();
  seeded(path, {
    images: [tagFor(node), 'ahpd-part/codex:2.0.0-aaaaaaaaaaaa', 'ahpd-part/codex:2.1.0-bbbbbbbbbbbb'],
    failCheck: [tagFor(codex), 'ahpd-part/codex:2.1.0-bbbbbbbbbbbb'],
  });
  expect(await ensurePart('codex', { runtime: runtime(path), parts })).toBe('ahpd-part/codex:2.0.0-aaaaaaaaaaaa');
  expect((held(path) as unknown as { removed?: string[] }).removed).toEqual([tagFor(codex)]);
  expect(held(path).images).not.toContain(tagFor(codex));
  // With no earlier image that answers, the check's own failure is the answer.
  seeded(path, { failCheck: [tagFor(codex), 'ahpd-part/codex:2.1.0-bbbbbbbbbbbb', 'ahpd-part/codex:2.0.0-aaaaaaaaaaaa'] });
  const other = runtime(path);
  await expect(ensurePart('codex', { runtime: other, parts }))
    .rejects.toThrow('CLI at /opt/ahpd/codex/bin/codex-acp failed --version check after install (exit code 1)');
});

/*
 * A joined image no release holds, one without a part that would not load, is
 * built here from its Dockerfile alone, on the base pinned by digest, as
 * Docker's guidance pins a base image
 * (https://docs.docker.com/build/building/best-practices/#pin-base-image-versions).
 */
it('pipes a joined image it builds here a context holding its Dockerfile alone, on the base pinned by digest', async () => {
  const path = state();
  seeded(path, { failPull: [remoteFor(goose)] });
  const joined = await ensureJoined({ runtime: runtime(path), parts: [...parts, goose] });

  const build = held(path).builds.find((one) => one.tag === joined.tag);
  expect(build?.files).toEqual(['Dockerfile']);
  expect(build?.dockerfile.split('\n')[0]).toBe(`FROM ${JOINED_BASE}`);
  expect(JOINED_BASE).toMatch(/^debian:bookworm-slim@sha256:[0-9a-f]{64}$/);
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
  paths: { goose: 'goose' },
};

it('copies every part into the joined image once, from its own tag, and puts their bins on the PATH', () => {
  const file = joinedDockerfile([...parts, goose], new Map([
    ['node', 'ahpd-part/node:24.21.0'],
    ['codex', 'ahpd-part/codex:2.1.1'],
    ['goose', 'ahpd-part/goose:1.53.0'],
  ]));

  expect(file.split('\n')[0]).toBe(`FROM ${JOINED_BASE}`);
  expect(file).toContain('apt-get install --yes --no-install-recommends ca-certificates git ripgrep');
  expect(file).toContain('COPY --from=ahpd-part/node:24.21.0 /opt/ahpd/node /opt/ahpd/node');
  expect(file).toContain('COPY --from=ahpd-part/codex:2.1.1 /opt/ahpd/codex /opt/ahpd/codex');
  expect(file).toContain('COPY --from=ahpd-part/goose:1.53.0 /opt/ahpd/goose /opt/ahpd/goose');
  expect(file.match(/COPY --from=ahpd-part\//gu)).toHaveLength(3);
  expect(file).toContain('ENV PATH="/opt/ahpd/node/bin:/opt/ahpd/codex/bin:/opt/ahpd/goose/bin:${PATH}"');
  // What it holds is on the image, so a machine it was built without is told
  // from one built from a file that has since moved.
  expect(file).toContain(labelLine('node', 'codex', 'goose'));
});

/*
 * The joined image is built at release with the parts, and a host whose parts
 * all loaded at the tags the release published them at pulls it, as VS Code's
 * build produces its agent SDKs once per release (build/agent-sdk/README.md
 * L1-L5 at 6b68d3fe).
 */
it('pulls the joined image the release built, at a tag that moves with the file, when every part loaded at its released tag, and pulls it once', async () => {
  const path = state();
  const docker = runtime(path);

  const one = await ensureJoined({ runtime: docker, parts: [...parts, goose] });
  // Twelve hex of the versions file's bytes, and the file that ships is what is
  // hashed - a fixture cannot move the tag, which is why this is a shape and
  // not a value.
  expect(one.tag).toMatch(/^ahpd-agents:[0-9a-f]{12}$/);
  expect(one.missing).toEqual([]);
  expect(one.parts.map((part) => part.id)).toEqual(['node', 'codex', 'goose']);
  expect(pulled(path)).toContain(`${registryOf()}/${one.tag}`);
  expect(held(path).images).toContain(one.tag);
  expect(held(path).builds).toEqual([]);

  // And a second call finds the tag.
  await ensureJoined({ runtime: docker, parts: [...parts, goose] });
  expect(pulled(path).filter((one_) => one_ === `${registryOf()}/${one.tag}`)).toHaveLength(1);
});

/*
 * A joined image holding an earlier image of a part is no release's, and is
 * built here from the part images here.
 */
it('builds the joined image here, on the pinned base, when it holds an earlier image of a part, which no release holds', async () => {
  const path = state();
  seeded(path, { images: ['ahpd-part/codex:2.0.0-aaaaaaaaaaaa'], failPull: [remoteFor(codex)] });
  const joined = await ensureJoined({ runtime: runtime(path), parts });
  expect(joined.missing).toEqual([]);
  const build = held(path).builds.find((one) => one.tag === joined.tag);
  expect(build?.dockerfile.split('\n')[0]).toBe(`FROM ${JOINED_BASE}`);
  expect(build?.dockerfile).toContain('COPY --from=ahpd-part/codex:2.0.0-aaaaaaaaaaaa /opt/ahpd/codex /opt/ahpd/codex');
  expect(pulled(path)).not.toContain(`${registryOf()}/${joined.tag}`);
});

it('builds the joined image without the part that failed, and says which one is missing', async () => {
  const path = state();
  const record = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  // One part that will not load, named, so the other two are unaffected.
  record.failPull = [remoteFor(goose)];
  writeFileSync(path, JSON.stringify(record));

  const joined = await ensureJoined({ runtime: runtime(path), parts: [...parts, goose] });

  // The two that loaded are in the image, and the one that did not is named
  // rather than refused: a machine needing goose is refused by name and every
  // other machine is made.
  expect(joined.missing).toEqual(['goose']);
  expect(joined.parts.map((part) => part.id)).toEqual(['node', 'codex']);
  const build = held(path).builds.find((one) => one.tag === joined.tag);
  expect(build?.dockerfile).not.toContain('goose');
  expect(build?.dockerfile).toContain(labelLine('node', 'codex'));
  expect(build?.dockerfile).toContain(`COPY --from=${tagFor(codex)} /opt/ahpd/codex /opt/ahpd/codex`);
});

it('does not hand back an image built without a part the file now has', async () => {
  const path = state();
  const first = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  // The one part that will not load this time, named, so the first joined
  // image is the image without it.
  first.failPull = [remoteFor(goose)];
  writeFileSync(path, JSON.stringify(first));

  const docker = runtime(path);
  const without = await ensureJoined({ runtime: docker, parts: [...parts, goose] });
  expect(without.missing).toEqual(['goose']);
  expect(held(path).builds.map((one) => one.tag)).toContain(without.tag);

  // The part pulls now, past the 30 seconds a failed load is held for, and the
  // file is the same one, so an image built without goose is not the image this
  // file stands for: the tag has to hold the parts that are in it, and this
  // file's goose is now one of them.
  const second = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  second.failPull = [];
  writeFileSync(path, JSON.stringify(second));

  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 31_000);
  const joined = await ensureJoined({ runtime: docker, parts: [...parts, goose] }).finally(() => { vi.useRealTimers(); });
  expect(joined.missing).toEqual([]);
  expect(joined.parts.map((part) => part.id)).toEqual(['node', 'codex', 'goose']);
  // The image with goose is the one the release built, pulled at its own tag.
  expect(joined.tag).not.toBe(without.tag);
  expect(pulled(path)).toContain(`${registryOf()}/${joined.tag}`);
});

it('pulls a part at its new tag, and the joined image at its new tag, when the Dockerfile that writes the part moves', async () => {
  const path = state();
  const docker = runtime(path);
  const file = [...parts, goose];
  /** What it was asked to pull of one image, by the tag here it was pulled for. */
  const pulledOf = (prefix: string): string[] =>
    pulled(path).map((one) => one.slice(registryOf().length + 1)).filter((tag) => tag.startsWith(prefix));

  const one = await ensureJoined({ runtime: docker, parts: file });
  expect(one.missing).toEqual([]);
  expect(pulledOf('ahpd-part/codex:')).toHaveLength(1);

  // The same file with one part whose Dockerfile this code writes differently:
  // a `bin` entry added, which is the shape of what an upgrade that changed
  // `dockerfileOf` leaves behind. The versions are the same ones.
  const moved = file.map((part) => (part.id === 'codex' ? { ...part, bin: ['codex-acp', 'codex'] } : part));
  const again = await ensureJoined({ runtime: docker, parts: moved });

  // The image is the text that writes it, so one version with two Dockerfiles
  // is two images: the part is pulled at its new tag...
  const codex = pulledOf('ahpd-part/codex:');
  expect(codex).toHaveLength(2);
  // ...and the joined image, which copies the part's new tag in, at its own new tag.
  expect(pulledOf('ahpd-agents:')).toEqual([one.tag, again.tag]);
  expect(again.tag).not.toBe(one.tag);
  // The node part's Dockerfile did not move, so it was not pulled twice.
  expect(pulledOf('ahpd-part/node:')).toHaveLength(1);
});

/*
 * `ahpdSourceOf` and the `pnpm pack` it runs, which is the one place in this
 * file where a real process is started.
 *
 * A real pack is not available here - `pnpm build` is what makes `prepack`'s
 * `tsc -p .` resolve, and CI runs the tests before it - so these cases put a
 * `pnpm` of their own first on `PATH`. It is a shell script that writes a
 * tarball where `--out` names it, as the real one does. Each case imports the
 * module again, because the answer is remembered once per process, and names
 * this checkout in `AHPD_PART_AHPD_ROOT`, the variable that asks for its code.
 */

/** This repository's root, the checkout the cases name. */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** How a fake `pnpm` answers: everything packs, only the first ask fails, or the pack never works. */
type Pnpm = 'never' | 'first' | 'always';

/** A `pnpm` that packs what it is asked into the file `--out` names. */
const fakePnpm = (dir: string, fail: Pnpm = 'never'): void => {
  const marker = join(dir, 'asked');
  const refuse = fail === 'always'
    ? `echo "pnpm pack: no build to pack yet" >&2
exit 1
`
    : fail === 'first'
      ? `if [ ! -e "${marker}" ]; then
  : > "${marker}"
  echo "pnpm pack: no build to pack yet" >&2
  exit 1
fi
`
      : '';
  writeFileSync(join(dir, 'pnpm'), `#!/bin/sh
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done
${refuse}printf 'the bytes of %s\\n' "$(basename "$out")" > "$out"
`, { mode: 0o755 });
};

/** The module again, so `answered` is the one this case fills. */
const freshParts = async (): Promise<typeof import('../src/parts.js')> => {
  vi.resetModules();
  return await import('../src/parts.js');
};

/** Whatever `PATH` and override a case replaced, put back; a `root` of `null` sets no override. */
const withFakePnpm = async (
  run: (parts: typeof import('../src/parts.js')) => Promise<void>,
  fail: Pnpm = 'never',
  root: string | null = ROOT,
): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-fake-pnpm-'));
  fakePnpm(dir, fail);
  const realPath = process.env.PATH;
  const realRoot = process.env.AHPD_PART_AHPD_ROOT;
  process.env.PATH = `${dir}:${realPath ?? ''}`;
  if (root === null) delete process.env.AHPD_PART_AHPD_ROOT;
  else process.env.AHPD_PART_AHPD_ROOT = root;
  try {
    await run(await freshParts());
  }
  finally {
    process.env.PATH = realPath;
    if (realRoot === undefined) delete process.env.AHPD_PART_AHPD_ROOT;
    else process.env.AHPD_PART_AHPD_ROOT = realRoot;
    rmSync(dir, { recursive: true, force: true });
  }
};

/** The scratch directories `pnpm pack` was given, as they are now. */
const scratch = (): string[] => readdirSync(tmpdir()).filter((one) => one.startsWith('ahpd-pack-'));

/*
 * The ahpd part is the version the versions file names, from npm, unless its
 * override variable names a checkout, as VS Code takes an agent SDK's local
 * code only from the SDK's override variable (agentSdkDownloader.ts
 * L364-L370 at 6b68d3fe), and a checkout's tarball is read where `--out`
 * wrote it.
 */
// POSIX-only: the stand-in pnpm is a shell script on `PATH`, which Windows does not run.
it.skipIf(!posix)('builds the ahpd part from npm at its version, and from the checkout AHPD_PART_AHPD_ROOT names', async () => {
  const ahpd = readParts().find((one) => one.kind === 'ahpd') as Part;
  // Run from this checkout with no variable: the pinned version, nothing packed.
  let source: { from: string; version?: string; hash: string } | undefined;
  await withFakePnpm(async (parts) => { source = await parts.ahpdSourceOf() as { from: string; hash: string }; }, 'always', null);
  expect(source).toMatchObject({ from: 'npm', version: ahpd.version });

  // With it: the checkout's own packages, each read from the file `--out` named,
  // and one line saying which checkout.
  const before = scratch();
  const lines: string[] = [];
  let packed: { from: string; hash: string; tarballs: { name: string; bytes: Buffer }[] } | undefined;
  await withFakePnpm(async (parts) => {
    packed = await parts.ahpdSourceOf((line) => { lines.push(line); }) as typeof packed;
  });
  expect(packed?.from).toBe('workspace');
  expect(packed?.hash).toMatch(/^[0-9a-f]{12}$/);
  expect(packed?.tarballs[0]).toMatchObject({ name: 'ahpd-server.tgz' });
  expect(packed?.tarballs[0]?.bytes.toString('utf8')).toBe('the bytes of ahpd-server.tgz\n');
  expect(lines).toEqual([`the ahpd part is built from the checkout at ${ROOT}, which AHPD_PART_AHPD_ROOT names`]);
  // And the directory it packed into is gone once the bytes are in hand.
  expect(scratch().filter((one) => !before.includes(one))).toEqual([]);
});

// POSIX-only: the stand-in pnpm is a shell script on `PATH`, which Windows does not run.
it.skipIf(!posix)('asks a pack that failed again, rather than handing back the same refusal', async () => {
  await withFakePnpm(async (parts) => {
    await expect(parts.ahpdSourceOf()).rejects.toThrow(/pnpm pack could not pack/);
    // The next build is a build, not the rejection the daemon was given once.
    const source = await parts.ahpdSourceOf() as { from: string };
    expect(source.from).toBe('workspace');
  }, 'first');
});

// POSIX-only: the stand-in pnpm is a shell script on `PATH`, which Windows does not run.
it.skipIf(!posix)('leaves no pack directory behind when the pack fails', async () => {
  const before = scratch();
  await withFakePnpm(async (parts) => {
    await expect(parts.ahpdSourceOf()).rejects.toThrow(/pnpm pack could not pack/);
    expect(scratch().filter((one) => !before.includes(one))).toEqual([]);
  }, 'first');
});

it('answers the ahpd part as missing when its own pack fails, rather than throwing out of the join', async () => {
  const path = state();
  const ahpd = readParts().find((one) => one.kind === 'ahpd') as Part;
  await withFakePnpm(async (mod) => {
    // The ahpd part cannot be built at all without `pnpm build`'s `tsc -p .`,
    // and the join is asked for the rest regardless: a machine whose agent
    // needs that part is refused by name, and every other machine is made.
    const joined = await mod.ensureJoined({ runtime: runtime(path), parts: [...parts, ahpd] });
    expect(joined.missing).toEqual(['ahpd']);
    expect(joined.parts.map((one) => one.id)).toEqual(['node', 'codex']);
  }, 'always');
});