import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { dockerRuntime } from '../src/runtime.js';
import type { DockerOptions } from '../src/runtime.js';
import type { MadePart } from '../src/parts.js';

/*
 * A part reaches a machine read-only at `/opt/ahpd/<id>`: from its own image
 * where Docker takes an image mount, and from a volume filled once from that
 * image where it does not - decision
 * `a-part-is-mounted-from-its-image-and-a-volume-is-the-fallback`.
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
  volumes?: Record<string, { files: string[] }>;
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

/** The probes the runtime ran: a create with an image mount at `/probe`. */
const probes = (path: string): string[][] =>
  held(path).calls.filter((one) => one[0] === 'create' && one.some((arg) => arg.endsWith(',target=/probe')));

const IMAGE = (part: MadePart): string =>
  `type=image,source=${part.tag},image-subpath=opt/ahpd/${part.id},target=/opt/ahpd/${part.id},readonly`;

it('mounts each part from its own image where Docker takes one, after the binds', async () => {
  const path = state();
  const docker = runtime(path);
  await make(docker, 'one');

  const run = held(path).calls.find((one) => one[0] === 'run') ?? [];
  // After the bind mounts, one read-only image mount per part.
  expect(run.indexOf('--mount')).toBeGreaterThan(run.indexOf('/srv:/srv'));
  expect(run.filter((_, at) => run[at - 1] === '--mount')).toEqual([IMAGE(CODEX), IMAGE(NODE)]);
  expect(held(path).machines.find((one) => one.name === 'one')?.labels?.['ahpd.parts']).toBe('codex@2.1.1,node@24.21.0');

  // The probe named the part being mounted, and left nothing behind.
  expect(probes(path)).toEqual([
    ['create', '--name', expect.stringMatching(/^ahpd-part-probe-/) as unknown as string, '--mount', `type=image,source=${CODEX.tag},target=/probe`, CODEX.tag, 'x'],
  ]);
  expect(held(path).machines.map((one) => one.name)).toEqual(['one']);

  // A yes is kept, so the next machine is not probed again.
  await make(docker, 'two');
  expect(probes(path)).toHaveLength(1);
});

it('asks again after a probe the image failed, and keeps a refusal of the mount type', async () => {
  const path = state({ failMount: "Unable to find image 'ahpd-part/codex:2.1.1' locally" });
  const docker = runtime(path);
  await make(docker, 'one');
  // The image was missing, which says nothing about image mounts: this machine
  // takes the volumes, and the next one asks again.
  expect(held(path).calls.find((one) => one[0] === 'run')).toContain('ahpd-part-codex-2.1.1:/opt/ahpd/codex:ro');
  set(path, { failMount: undefined });
  await make(docker, 'two');
  expect(probes(path)).toHaveLength(2);
  expect(held(path).calls.filter((one) => one[0] === 'run')[1]).toContain(IMAGE(CODEX));

  // A Docker that does not know the mount type is asked once.
  const older = state({ imageMounts: false });
  const old = runtime(older);
  await make(old, 'one');
  await make(old, 'two');
  expect(probes(older)).toHaveLength(1);
  expect(held(older).calls.filter((one) => one[0] === 'run').every((one) => one.includes('ahpd-part-node-24.21.0:/opt/ahpd/node:ro'))).toBe(true);
});

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
  expect(box?.labels?.['ahpd.parts']).toBe('goose@1.53.0');
  expect(box?.mounts).toEqual(['ahpd-part-goose-1.53.0:/opt/ahpd/goose:ro']);
  expect(lines).toEqual([
    expect.stringMatching(/^one is made without the part node: its volume ahpd-part-node-24\.21\.0 could not be filled: .*no space left on device$/) as unknown as string,
    'one is made without the part codex: it requires node, which the machine is made without',
  ]);
});

it('takes the volumes without asking where the option switches image mounts off', async () => {
  const path = state();
  await make(runtime(path, { imageMounts: false }), 'one');
  expect(probes(path)).toEqual([]);
  expect(held(path).calls.find((one) => one[0] === 'run')).toContain('ahpd-part-codex-2.1.1:/opt/ahpd/codex:ro');
});
