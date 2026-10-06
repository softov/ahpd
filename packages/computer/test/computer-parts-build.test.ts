import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { contextOf, dockerfileOf, ensureJoined, ensurePart, joinedDockerfile, readParts, tagOf } from '../src/parts.js';
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
const held = (path: string): { calls: string[][]; images: string[]; builds: { tag: string; dockerfile: string; files: string[] }[] } =>
  JSON.parse(readFileSync(path, 'utf8'));

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
const tagFor = (part: Part): string => tagOf(part, undefined, dockerfileOf(part));

it('builds a missing part and answers its tag, and a second call builds nothing', async () => {
  const path = state();
  const docker = runtime(path);

  expect(await ensurePart('codex', { runtime: docker, parts })).toBe(tagFor(codex));
  // The node part is required, so it is built first and the codex build copies
  // its image in by tag.
  expect(held(path).images).toEqual([tagFor(node), tagFor(codex)]);
  expect(held(path).builds[0]?.tag).toBe(tagFor(node));
  expect(held(path).builds[1]?.dockerfile).toContain(`COPY --from=${tagFor(node)}`);
  expect(held(path).builds[1]?.dockerfile).toContain('@agentclientprotocol/codex-acp@2.1.1');

  // The second call finds the tag and stops: two builds of one tag would be two
  // downloads of the same tarball and whichever finished last would win.
  expect(await ensurePart('codex', { runtime: docker, parts })).toBe(tagFor(codex));
  expect(held(path).builds).toHaveLength(2);
});

it('runs one build for two callers that arrive at once', async () => {
  const path = state();
  const docker = runtime(path);

  const tags = await Promise.all([
    ensurePart('codex', { runtime: docker, parts }),
    ensurePart('codex', { runtime: docker, parts }),
  ]);

  expect(tags).toEqual([tagFor(codex), tagFor(codex)]);
  // The node part and the codex part, once each, whatever the callers were.
  expect(held(path).builds.map((one) => one.tag))
    .toEqual([tagFor(node), tagFor(codex)]);
});

it('runs no build for a tag the daemon already has', async () => {
  const path = state();
  const record = JSON.parse(readFileSync(path, 'utf8')) as { images: string[] };
  record.images.push(tagFor(node));
  writeFileSync(path, JSON.stringify(record));

  expect(await ensurePart('codex', { runtime: runtime(path), parts })).toBe(tagFor(codex));
  // Only the codex part was missing, so only it was built.
  expect(held(path).builds.map((one) => one.tag)).toEqual([tagFor(codex)]);
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
  record.images = [tagFor(node)];
  record.failBuild = true;
  writeFileSync(path, JSON.stringify(record));

  const docker = runtime(path);
  const failed = await ensurePart('codex', { runtime: docker, parts }).catch((error: unknown) => error as Error);
  expect(failed).toBeInstanceOf(Error);
  expect((failed as Error).message).toContain(`build -t ${tagFor(codex)} exited 1`);
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
  expect(held(path).images).toEqual([tagFor(node)]);
  expect(held(path).builds.map((one) => one.tag))
    .toEqual([tagFor(codex), tagFor(codex)]);
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
  record.failBuild = [tagFor(goose)];
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
  expect(build?.dockerfile).toContain(`COPY --from=${tagFor(codex)} /opt/ahpd/codex /opt/ahpd/codex`);
});

it('does not hand back an image built without a part the file now has', async () => {
  const path = state();
  const first = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  // The one part that will not build this time, named, so the first joined
  // image is the image without it.
  first.failBuild = [tagFor(goose)];
  writeFileSync(path, JSON.stringify(first));

  const docker = runtime(path);
  const without = await ensureJoined({ runtime: docker, parts: [...parts, goose] });
  expect(without.missing).toEqual(['goose']);
  expect(held(path).builds.map((one) => one.tag)).toContain(without.tag);

  // The part downloads now, and the file is the same one, so an image built
  // without goose is not the image this file stands for: the tag has to hold
  // the parts that are in it, and this file's goose is now one of them.
  const second = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  second.failBuild = [];
  writeFileSync(path, JSON.stringify(second));

  const joined = await ensureJoined({ runtime: docker, parts: [...parts, goose] });
  expect(joined.missing).toEqual([]);
  expect(joined.parts.map((part) => part.id)).toEqual(['node', 'codex', 'goose']);

  const build = held(path).builds.find((one) => one.tag === joined.tag);
  expect(build?.dockerfile).toContain(`COPY --from=${tagFor(goose)} /opt/ahpd/goose /opt/ahpd/goose`);
  expect(build?.dockerfile).toContain('LABEL ahpd.parts="node,codex,goose"');
});

it('builds a part, and the joined image, again when the Dockerfile that writes them moves', async () => {
  const path = state();
  const docker = runtime(path);
  const file = [...parts, goose];
  /** What the scripted docker was asked to build, by the tag it was asked to build it at. */
  const built = (prefix: string): string[] =>
    held(path).builds.map((one) => one.tag).filter((tag) => tag.startsWith(prefix));

  const one = await ensureJoined({ runtime: docker, parts: file });
  expect(one.missing).toEqual([]);
  expect(built('ahpd-part/codex:')).toHaveLength(1);

  // The same file with one part whose Dockerfile this code writes differently:
  // a `bin` entry added, which is the shape of what an upgrade that changed
  // `dockerfileOf` leaves behind. The versions are the same ones.
  const moved = file.map((part) => (part.id === 'codex' ? { ...part, bin: ['codex-acp', 'codex'] } : part));
  const again = await ensureJoined({ runtime: docker, parts: moved });

  // The image is the text that writes it, so one version with two Dockerfiles
  // is two images: the part is built again...
  const codex = built('ahpd-part/codex:');
  expect(codex).toHaveLength(2);
  // ...and so is the joined image, which copies the part's new tag in.
  expect(built('ahpd-agents:')).toHaveLength(2);
  expect(again.tag).not.toBe(one.tag);
  const joined = held(path).builds.find((one_) => one_.tag === again.tag);
  expect(joined?.dockerfile).toContain(`COPY --from=${String(codex[1])} /opt/ahpd/codex /opt/ahpd/codex`);
  // The node part's Dockerfile did not move, so it was not built twice.
  expect(built('ahpd-part/node:')).toHaveLength(1);
});

/*
 * `ahpdSourceOf` and the `pnpm pack` it runs, which is the one place in this
 * file where a real process is started.
 *
 * A real pack is not available here - `pnpm build` is what makes `prepack`'s
 * `tsc -p .` resolve, and CI runs the tests before it - so these cases put a
 * `pnpm` of their own first on `PATH`. It is a shell script that writes a
 * tarball into the directory it was given and prints its absolute path as its
 * last line, which is what the real one prints and where the reading went
 * wrong. Each case imports the module again, because the answer is remembered
 * once per process.
 */

/** How a fake `pnpm` answers: everything packs, only the first ask fails, or the pack never works. */
type Pnpm = 'never' | 'first' | 'always';

/** A `pnpm` that packs what it is asked into a file of its own, and says where. */
const fakePnpm = (dir: string, fail: Pnpm = 'never', relative = false): void => {
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
  // The last line is where the tarball is: the real `pnpm` prints an absolute
  // path, and a version that printed the name alone is the other shape read.
  const where = relative ? '"$name"' : '"$into/$name"';
  writeFileSync(join(dir, 'pnpm'), `#!/bin/sh
into=""
while [ $# -gt 0 ]; do
  case "$1" in
    --pack-destination) into="$2"; shift 2 ;;
    *) shift ;;
  esac
done
${refuse}name="packed-$$.tgz"
printf 'packed %s\\n' "$name"
printf 'the bytes of %s\\n' "$name" > "$into/$name"
printf '%s\\n' ${where}
`, { mode: 0o755 });
};

/** The module again, so `answered` is the one this case fills. */
const freshParts = async (): Promise<typeof import('../src/parts.js')> => {
  vi.resetModules();
  return await import('../src/parts.js');
};

/** Whatever `PATH` a case replaced, put back. */
let realPath: string | undefined;
const withFakePnpm = async (run: (parts: typeof import('../src/parts.js')) => Promise<void>, fail: Pnpm = 'never', relative = false): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-fake-pnpm-'));
  fakePnpm(dir, fail, relative);
  realPath = process.env.PATH;
  process.env.PATH = `${dir}:${realPath ?? ''}`;
  try {
    await run(await freshParts());
  }
  finally {
    process.env.PATH = realPath;
    rmSync(dir, { recursive: true, force: true });
  }
};

/** The scratch directories `pnpm pack` was given, as they are now. */
const scratch = (): string[] => readdirSync(tmpdir()).filter((one) => one.startsWith('ahpd-pack-'));

it('reads the tarball a pack names, by the absolute path it printed', async () => {
  const before = scratch();
  let source: { from: string; version?: string; hash: string } | undefined;
  await withFakePnpm(async (parts) => { source = await parts.ahpdSourceOf() as { from: string; hash: string }; });
  // `pnpm pack` prints the tarball's absolute path, and `join(into, file)`
  // read the scratch directory twice over - `ENOENT` whatever the pack did, so
  // a checkout could never answer where its own ahpd part came from.
  expect(source?.from).toBe('workspace');
  expect(source?.hash).toMatch(/^[0-9a-f]{12}$/);
  // And the directory it packed into is gone once the bytes are in hand.
  expect(scratch().filter((one) => !before.includes(one))).toEqual([]);
});

it('reads the tarball a pack named relatively, against the directory it packed into', async () => {
  let source: { from: string; hash: string } | undefined;
  await withFakePnpm(async (parts) => { source = await parts.ahpdSourceOf() as { from: string; hash: string }; }, 'never', true);
  // A `pnpm` that names the tarball `packed-123.tgz` rather than its full path:
  // resolved against the scratch directory it was packed into, which is where
  // the file is. Resolved against the working directory it is not there at all.
  expect(source?.from).toBe('workspace');
  expect(source?.hash).toMatch(/^[0-9a-f]{12}$/);
});

it('asks a pack that failed again, rather than handing back the same refusal', async () => {
  await withFakePnpm(async (parts) => {
    await expect(parts.ahpdSourceOf()).rejects.toThrow(/pnpm pack could not pack/);
    // The next build is a build, not the rejection the daemon was given once.
    const source = await parts.ahpdSourceOf() as { from: string };
    expect(source.from).toBe('workspace');
  }, 'first');
});

it('leaves no pack directory behind when the pack fails', async () => {
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