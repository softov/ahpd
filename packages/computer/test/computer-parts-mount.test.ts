import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { markerText, readParts, requestedVolume } from '../src/parts.js';
import { dockerRuntime } from '../src/runtime.js';
import type { DockerOptions } from '../src/runtime.js';
import type { MadePart } from '../src/parts.js';

/*
 * A part reaches a machine read-only at `/opt/ahpd/<id>`: from its own image
 * where Docker takes an image mount, and from a volume filled once from that
 * image where it does not.
 *
 * The parts here are already built: building them is the plugin's, before the
 * runtime is asked to make anything, so the fake Docker holds their images.
 */

let loose: string;
afterEach(() => { rmSync(loose, { recursive: true, force: true }); });

const CODEX: MadePart = { id: 'codex', tag: 'ahpd-part/codex:2.1.1', version: '2.1.1' };
const NODE: MadePart = { id: 'node', tag: 'ahpd-part/node:24.21.0', version: '24.21.0' };

interface Held {
  machines: { name: string; mounts?: string[]; typed?: string[]; labels?: Record<string, string>; env?: Record<string, string> }[];
  calls: string[][];
  volumes?: Record<string, { files: string[]; contents?: Record<string, string>; labels?: Record<string, string>; created?: string }>;
  fills?: string[];
}

/** The fake Docker's state, holding both part images and whatever else a case needs. */
const state = (extra: Record<string, unknown> = {}): string => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-parts-mount-'));
  const path = join(loose, 'docker.json');
  writeFileSync(path, JSON.stringify({ machines: [], calls: [], images: [CODEX.tag, NODE.tag], ...extra }));
  return path;
};

const held = (path: string): Held => JSON.parse(readFileSync(path, 'utf8')) as Held;

/** Change the fake's state between two makes, as a Docker changing under the daemon would. */
const set = (path: string, more: Record<string, unknown>): void => {
  writeFileSync(path, JSON.stringify({ ...held(path), ...more }));
};

const runtime = (path: string, more: Partial<DockerOptions> = {}) => dockerRuntime({
  command: process.execPath,
  args: [fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url))],
  env: { DOCKER_FAKE_STATE: path },
  label: 'ahpd.computer=1',
  ...more,
});

const make = (docker: ReturnType<typeof runtime>, name: string) =>
  docker.run({ name, image: 'debian:bookworm-slim', label: 'ahpd.computer=1', mounts: ['/srv:/srv'], parts: [CODEX, NODE] });

/** The times the runtime asked the daemon what it is. */
const asked = (path: string): string[][] => held(path).calls.filter((one) => one[0] === 'info');

const IMAGE = (part: MadePart): string =>
  `type=image,source=${part.tag},image-subpath=opt/ahpd/${part.id},target=/opt/ahpd/${part.id},readonly`;

/*
 * Whether Docker takes an image mount is the condition Docker documents,
 * asked of the daemon: the containerd image store, which `docker info`
 * reports as its driver type (image-mounts.md L70-L71, containerd.md
 * L103-L104), on an Engine of 28.0.0 or later, the release that added the
 * mount type (release-notes/28.md L718-L731).
 */
it('mounts each part from its own image where Docker takes one, after the binds', async () => {
  const path = state();
  const docker = runtime(path);
  await make(docker, 'one');

  const run = held(path).calls.find((one) => one[0] === 'run') ?? [];
  // After the bind mounts, one read-only image mount per part.
  expect(run.indexOf('--mount')).toBeGreaterThan(run.indexOf('/srv:/srv'));
  expect(run.filter((_, at) => run[at - 1] === '--mount')).toEqual([IMAGE(CODEX), IMAGE(NODE)]);
  expect(held(path).machines.find((one) => one.name === 'one')?.labels?.['ahpd.parts'])
    .toBe(JSON.stringify([{ id: 'codex', version: '2.1.1' }, { id: 'node', version: '24.21.0' }]));

  // The daemon was asked what it is, and nothing was made to find out.
  expect(asked(path)).toEqual([['info', '--format', '{{json .}}']]);
  expect(held(path).calls.filter((one) => one[0] === 'create')).toEqual([]);
  expect(held(path).machines.map((one) => one.name)).toEqual(['one']);

  // The answer is kept, so the next machine does not ask again.
  await make(docker, 'two');
  expect(asked(path)).toHaveLength(1);
});

it('takes the volumes on a classic store or an Engine before 28, asking once, and asks again a daemon that did not answer', async () => {
  // A daemon that does not answer says nothing about image mounts: this
  // machine takes the volumes, and the next one asks again.
  const path = state({ failInfo: true });
  const docker = runtime(path);
  await make(docker, 'one');
  expect(held(path).calls.find((one) => one[0] === 'run')).toContain('ahpd-part-codex-2.1.1:/opt/ahpd/codex:ro');
  set(path, { failInfo: false });
  await make(docker, 'two');
  expect(asked(path)).toHaveLength(2);
  expect(held(path).calls.filter((one) => one[0] === 'run')[1]).toContain(IMAGE(CODEX));

  // The classic store, and the containerd store on an Engine without the
  // mount type, are each asked once.
  for (const said of [{ imageMounts: false }, { engine: '27.5.1' }]) {
    const older = state(said);
    const old = runtime(older);
    await make(old, 'one');
    await make(old, 'two');
    expect(asked(older)).toHaveLength(1);
    expect(held(older).calls.filter((one) => one[0] === 'run').every((one) => one.includes('ahpd-part-node-24.21.0:/opt/ahpd/node:ro'))).toBe(true);
  }
}, 30_000);

it('mounts each part from a volume filled once where Docker refuses image mounts', async () => {
  const path = state({ imageMounts: false });
  const docker = runtime(path);
  await make(docker, 'one');
  await make(docker, 'two');

  const runs = held(path).calls.filter((one) => one[0] === 'run');
  for (const run of runs) {
    expect(run.filter((_, at) => run[at - 1] === '-v')).toEqual([
      '/srv:/srv',
      'ahpd-part-codex-2.1.1:/opt/ahpd/codex:ro',
      'ahpd-part-node-24.21.0:/opt/ahpd/node:ro',
    ]);
    expect(run).not.toContain('--mount');
  }
  // Each volume was filled from its part image once across the two machines,
  // and carries the marker written after the fill.
  expect(held(path).fills).toEqual(['ahpd-part-codex-2.1.1', 'ahpd-part-node-24.21.0']);
  expect(held(path).volumes?.['ahpd-part-codex-2.1.1']?.files).toEqual(['from ahpd-part/codex:2.1.1 at /opt/ahpd/codex', '.ahpd-filled']);
  // No fill helper is left: the machines are the only containers.
  expect(held(path).machines.map((one) => one.name)).toEqual(['one', 'two']);
});

it('fills again a volume that holds no marker, and writes the marker last', async () => {
  const path = state({
    imageMounts: false,
    volumes: { 'ahpd-part-codex-2.1.1': { files: ['half'] }, 'ahpd-part-node-24.21.0': { files: ['whole', '.ahpd-filled'] } },
  });
  await make(runtime(path), 'one');

  const calls = held(path).calls.map((one) => one.join(' '));
  const removed = calls.indexOf('volume rm ahpd-part-codex-2.1.1');
  const filled = calls.findIndex((one, at) => at > removed && one.startsWith('create') && one.includes('ahpd-part-codex-2.1.1:/opt/ahpd/codex ahpd-part/codex:2.1.1 x'));
  const marked = calls.findIndex((one) => one.startsWith('cp - ') && one.endsWith(':/opt/ahpd/codex'));
  expect(removed).toBeGreaterThan(-1);
  expect(filled).toBeGreaterThan(removed);
  expect(marked).toBeGreaterThan(filled);
  expect(held(path).volumes?.['ahpd-part-codex-2.1.1']?.files).toEqual(['from ahpd-part/codex:2.1.1 at /opt/ahpd/codex', '.ahpd-filled']);
  // The one with its marker is mounted as it is.
  expect(calls).not.toContain('volume rm ahpd-part-node-24.21.0');
  expect(held(path).fills).toEqual(['ahpd-part-codex-2.1.1']);
});

it('makes the machine without a part whose volume cannot be filled, and without what requires it', async () => {
  const path = state({ imageMounts: false, failVolume: ['ahpd-part-node-24.21.0'] });
  const lines: string[] = [];
  const docker = runtime(path, { log: (line) => { lines.push(line); } });
  const GOOSE: MadePart = { id: 'goose', tag: 'ahpd-part/goose:1.53.0', version: '1.53.0' };
  set(path, { images: [CODEX.tag, NODE.tag, GOOSE.tag] });
  await docker.run({ name: 'one', image: 'debian:bookworm-slim', label: 'ahpd.computer=1', parts: [{ ...CODEX, requires: ['node'] }, NODE, GOOSE] });

  // The healthy part beside them is mounted, and the label says so.
  const box = held(path).machines.find((one) => one.name === 'one');
  expect(box?.labels?.['ahpd.parts']).toBe(JSON.stringify([{ id: 'goose', version: '1.53.0' }]));
  expect(box?.mounts).toEqual(['ahpd-part-goose-1.53.0:/opt/ahpd/goose:ro']);
  expect(lines).toEqual([
    expect.stringMatching(/^one is made without the part node: its volume ahpd-part-node-24\.21\.0 could not be filled: .*no space left on device$/) as unknown as string,
    'one is made without the part codex: it requires node, which the machine is made without',
  ]);
});

it('takes the volumes without asking where the option switches image mounts off', async () => {
  const path = state();
  await make(runtime(path, { imageMounts: false }), 'one');
  expect(asked(path)).toEqual([]);
  expect(held(path).calls.find((one) => one[0] === 'run')).toContain('ahpd-part-codex-2.1.1:/opt/ahpd/codex:ro');
});

/*
 * A part volume's last use is in its marker, written again by a machine made
 * with it once an hour has passed, as VS Code's sentinel records a cached
 * SDK's last use (agentSdkCache.ts L11-L15, agentSdkDownloader.ts L244-L245
 * at 6b68d3fe); and the volume is made with the label naming its image.
 */
it('writes the time a machine used a part volume into its marker, and again once an hour has passed', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    const path = state({ imageMounts: false });
    const docker = runtime(path);
    const marker = (): string | undefined => held(path).volumes?.['ahpd-part-codex-2.1.1']?.contents?.['.ahpd-filled'];
    await make(docker, 'one');
    const first = marker();
    expect(first).toBe(markerText(CODEX.tag, Date.now()));
    expect(held(path).volumes?.['ahpd-part-codex-2.1.1']?.labels).toEqual({ 'ahpd.part': CODEX.tag });

    // Within the hour a machine made with it writes nothing.
    vi.setSystemTime(Date.now() + 59 * 60 * 1000);
    await make(docker, 'two');
    expect(marker()).toBe(first);

    // After it, the use is written again.
    vi.setSystemTime(Date.now() + 2 * 60 * 1000);
    await make(docker, 'three');
    expect(marker()).toBe(markerText(CODEX.tag, Date.now()));
  }
  finally {
    vi.useRealTimers();
  }
});

/*
 * A part volume of a version the versions file does not name goes once no
 * machine has used it for a week, as VS Code removes a cached SDK version the
 * product does not ask for (agentSdkCache.ts L17-L78 at 6b68d3fe); every
 * volume of a version the file names stays, and one a machine mounts is left.
 */
it('removes a part volume of a version not asked for once no machine has used it for a week, and keeps the rest', async () => {
  const now = Date.now();
  const days = (count: number): number => now - count * 24 * 60 * 60 * 1000;
  const old = 'ahpd-part/codex:1.0.0';
  const volume = (used: number | undefined, extra: Record<string, unknown> = {}) => ({
    files: used === undefined ? [] : ['.ahpd-filled'],
    ...(used === undefined ? {} : { contents: { '.ahpd-filled': markerText(old, used) }, labels: { 'ahpd.part': old } }),
    created: new Date(days(30)).toISOString(),
    ...extra,
  });
  const path = state({
    images: [CODEX.tag, NODE.tag, old],
    machines: [{ name: 'busy', mounts: ['ahpd-part-node-1.0.0-cccccccccccc:/opt/ahpd/node:ro'] }],
    volumes: {
      // Another version, last used eight days ago.
      'ahpd-part-codex-1.0.0-aaaaaaaaaaaa': volume(days(8)),
      // Another version made a month ago and used two days ago.
      'ahpd-part-codex-1.1.0-aaaaaaaaaaaa': volume(days(2)),
      // The version the file names, at a Dockerfile of its own, used a month ago.
      'ahpd-part-codex-2.1.1-bbbbbbbbbbbb': volume(days(30)),
      // Another version a machine still mounts.
      'ahpd-part-node-1.0.0-cccccccccccc': volume(days(30)),
      // One an older daemon made, with no label and no time: its making is its last use.
      'ahpd-part-goose-0.1.0': volume(undefined, { created: new Date(days(10)).toISOString() }),
      // And a volume that is not a part's.
      'ahpd-git-box': { files: [], created: new Date(days(30)).toISOString() },
    },
  });
  const lines: string[] = [];
  const named = [{ id: 'codex', name: 'Codex', kind: 'npm' as const, version: '2.1.1', bin: ['codex-acp'] }];
  await runtime(path, { log: (line) => { lines.push(line); } }).removeUnusedPartVolumes?.((one) => requestedVolume(one, named));

  expect(Object.keys(held(path).volumes ?? {}).sort()).toEqual([
    'ahpd-git-box',
    'ahpd-part-codex-1.1.0-aaaaaaaaaaaa',
    'ahpd-part-codex-2.1.1-bbbbbbbbbbbb',
    'ahpd-part-node-1.0.0-cccccccccccc',
  ]);
  expect(lines.sort()).toEqual([
    'removed ahpd-part-codex-1.0.0-aaaaaaaaaaaa, which no machine has used for over a week',
    'removed ahpd-part-goose-0.1.0, which no machine has used for over a week',
  ]);
  // Every container read through is gone again.
  expect(held(path).machines.map((one) => one.name)).toEqual(['busy']);
});

it('asks for every Dockerfile\'s volume of each version the versions file names', () => {
  const parts = readParts();
  const codex = parts.find((one) => one.id === 'codex');
  expect(requestedVolume(`ahpd-part-codex-${codex?.version ?? ''}-0123456789ab`, parts)).toBe(true);
  expect(requestedVolume(`ahpd-part-codex-${codex?.version ?? ''}-fedcba987654`, parts)).toBe(true);
  expect(requestedVolume('ahpd-part-codex-0.0.1-0123456789ab', parts)).toBe(false);
  expect(requestedVolume('ahpd-part-nonesuch-1.0.0-0123456789ab', parts)).toBe(false);
});
