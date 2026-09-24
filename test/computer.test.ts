import { expect, it } from 'vitest';
import { computerProvider } from '../packages/computer/src/provider.js';
import { computerTools } from '../packages/computer/src/tools.js';
import type { ComputerRuntime } from '../packages/computer/src/runtime.js';
import type { ToolCall } from '../packages/sdk/src/types/host.js';
import type { Write } from '../packages/sdk/src/types/resources.js';

/*
 * The provider and the tools, against a runtime that is a plain object.
 *
 * What is under test is what this package does with a runtime, not what Docker
 * does: the listing, the two files, the refusals, and the three tools with the
 * limits they apply. The end-to-end case in `computer-plugin.test.ts` is where
 * a command is actually spawned.
 */

/** A runtime that keeps its machines in a map and every call in a list. */
const fake = () => {
  const held = new Map<string, Record<string, unknown>>();
  const calls: string[] = [];
  const runtime: ComputerRuntime = {
    kind: 'docker',
    list: async () => [...held.values()].map((one) => ({
      id: String(one.name), image: String(one.image), status: 'Up', created: String(one.Created),
    })),
    inspect: async (id) => held.get(id),
    run: async (spec) => {
      calls.push(`run ${spec.name} ${spec.image} ${spec.cpus ?? '-'} ${spec.memory ?? '-'} ${spec.label}${spec.mounts === undefined ? '' : ` v=${spec.mounts.join(',')}`}${spec.workdir === undefined ? '' : ` w=${spec.workdir}`}`);
      held.set(spec.name, { name: spec.name, image: spec.image, Created: new Date(0).toISOString() });
      return { id: spec.name, image: spec.image, status: 'running', created: '' };
    },
    stop: async (id) => { calls.push(`stop ${id}`); },
    remove: async (id) => { calls.push(`remove ${id}`); held.delete(id); },
    exec: async (id, command) => {
      calls.push(`exec ${id} ${command.join(' ')}`);
      return { output: 'hello', code: 0 };
    },
    capabilities: () => ({ runtime: 'docker', actions: ['create', 'destroy', 'exec'], resources: ['status', 'capabilities'] }),
  };
  return { runtime, held, calls };
};

const options = { image: 'debian:bookworm-slim', cpus: '2', memory: '2g', max: 2, label: 'ahpd.computer=1' };
const at = {} as ToolCall;
const by = (tools: ReturnType<typeof computerTools>, name: string) =>
  tools.find((one) => one.definition.name === name) as ReturnType<typeof computerTools>[number];

it('lists a machine, reads its status and its capabilities', async () => {
  const { runtime, held } = fake();
  held.set('box', { name: 'box', image: 'debian:bookworm-slim', Created: '2026-09-22T00:00:00Z' });
  const provider = computerProvider(runtime, options);

  expect(await provider.list('computer://')).toEqual([{ name: 'box', type: 'directory' }]);
  expect(await provider.list('computer://box')).toEqual([
    { name: 'status', type: 'file' },
    { name: 'capabilities', type: 'file' },
  ]);
  expect(await provider.resolve('computer://box')).toMatchObject({ type: 'directory' });
  expect(await provider.resolve('computer://box/status')).toMatchObject({ type: 'file' });

  const status = await provider.read('computer://box/status') as { data: string; contentType?: string };
  expect(status.contentType).toBe('application/json');
  expect(JSON.parse(status.data)).toMatchObject({ name: 'box' });

  const caps = JSON.parse((await provider.read('computer://box/capabilities') as { data: string }).data) as Record<string, unknown>;
  expect(caps).toMatchObject({ runtime: 'docker', defaultImage: 'debian:bookworm-slim', max: 2 });
});

it('refuses a machine that is not there, and a directory read', async () => {
  const { runtime } = fake();
  const provider = computerProvider(runtime, options);
  await expect(provider.read('computer://nope/status')).rejects.toMatchObject({ code: -32008 });
  await expect(provider.resolve('computer://nope')).rejects.toMatchObject({ code: -32008 });
  await expect(provider.list('computer://nope')).rejects.toMatchObject({ code: -32008 });
  await expect(provider.read('computer://nope')).rejects.toMatchObject({ code: -32008 });
});

it('makes a machine with the configured limits, uses it and releases it', async () => {
  const { runtime, calls } = fake();
  const tools = computerTools(runtime, { ...options, label: 'ahpd.computer=1', prefix: 'ahpd-computer' });

  expect(String(await by(tools, 'request_disposable_computer').run({ name: 'box' }, at))).toContain('computer://box');
  expect(calls[0]).toBe('run box debian:bookworm-slim 2 2g ahpd.computer=1');

  // An override is the call's, and the rest stays the host's.
  expect(String(await by(tools, 'request_disposable_computer').run({ name: 'other', cpus: '4' }, at))).toContain('computer://other');
  expect(calls[1]).toBe('run other debian:bookworm-slim 4 2g ahpd.computer=1');

  const ran = String(await by(tools, 'computer_exec').run({ id: 'box', command: 'echo hi' }, at));
  expect(ran).toContain('hello');
  expect(ran).toContain('exit 0');
  expect(calls).toContain('exec box sh -lc echo hi');

  expect(String(await by(tools, 'release_computer').run({ id: 'box' }, at))).toContain('gone');
  expect(calls).toContain('stop box');
  expect(calls).toContain('remove box');
});

it('refuses past the maximum, a name already taken, and a machine it does not have', async () => {
  const { runtime } = fake();
  const tools = computerTools(runtime, { ...options, max: 1, label: 'ahpd.computer=1', prefix: 'ahpd-computer' });
  await by(tools, 'request_disposable_computer').run({ name: 'one' }, at);

  expect(String(await by(tools, 'request_disposable_computer').run({ name: 'two' }, at)))
    .toContain('most this host will have');
  expect(String(await by(tools, 'release_computer').run({ id: 'nope' }, at))).toContain('no computer called nope');
  expect(String(await by(tools, 'computer_exec').run({ id: 'nope', command: 'true' }, at))).toContain('no computer called nope');
  // A call with nothing named is a sentence, not a throw: the model reads it.
  expect(String(await by(tools, 'release_computer').run({}, at))).toContain('Which computer?');
  expect(String(await by(tools, 'computer_exec').run({ id: 'one' }, at))).toContain('What command?');
});

it('declares what each tool does, so a policy has something to ask on', () => {
  const { runtime } = fake();
  const tools = computerTools(runtime, { ...options, label: 'l', prefix: 'p' });
  expect(by(tools, 'request_disposable_computer').effects).toEqual({ writes: true, network: true });
  expect(by(tools, 'release_computer').effects).toEqual({ destructive: true });
  expect(by(tools, 'computer_exec').effects).toEqual({ writes: true, network: true, destructive: true });
});

/** A create body, as a client sends one. */
const made = (value: unknown, extra: Record<string, unknown> = {}): Write =>
  ({ data: JSON.stringify(value), encoding: 'utf-8', ...extra }) as Write;

it('makes a machine from a manifest, with the limits and the mounts it names', async () => {
  const { runtime, calls } = fake();
  const provider = computerProvider(runtime, options);

  await provider.write('computer://box', made({
    image: 'node:22-slim',
    cpus: '4',
    memory: '512m',
    mounts: ['/work:/work', '/srv/server.mjs:/srv/server.mjs:ro'],
    workdir: '/work',
  }));

  expect(calls).toEqual(['run box node:22-slim 4 512m ahpd.computer=1 v=/work:/work,/srv/server.mjs:/srv/server.mjs:ro w=/work']);
});

it('makes a machine with the host\'s own defaults when the body names few', async () => {
  const { runtime, calls } = fake();
  const provider = computerProvider(runtime, options);
  await provider.write('computer://box', made({}));
  expect(calls[0]).toBe('run box debian:bookworm-slim 2 2g ahpd.computer=1');
});

it('refuses a body that is not a manifest, field by field', async () => {
  const { runtime } = fake();
  const provider = computerProvider(runtime, options);
  const bad = async (content: Write): Promise<unknown> => provider.write('computer://box', content).catch((error: unknown) => error);

  expect(await bad({ data: 'not json', encoding: 'utf-8' })).toMatchObject({ code: -32602 });
  expect(await bad({ data: '[]', encoding: 'utf-8' })).toMatchObject({ code: -32602 });
  expect(await bad(made({ runtime: 'kvm' }))).toMatchObject({ code: -32602 });
  expect(await bad(made({ image: '  ' }))).toMatchObject({ code: -32602 });
  expect(await bad(made({ cpus: 'two' }))).toMatchObject({ code: -32602 });
  expect(await bad(made({ memory: 'lots' }))).toMatchObject({ code: -32602 });
  expect(await bad(made({ mounts: ['/work'] }))).toMatchObject({ code: -32602 });
  expect(await bad(made({ workdir: 'work' }))).toMatchObject({ code: -32602 });
  expect(await bad(made({ mounts: [7] }))).toMatchObject({ code: -32602 });
});

it('refuses a create onto a name already taken, and past the maximum', async () => {
  const { runtime, held } = fake();
  const provider = computerProvider(runtime, { ...options, max: 1 });
  await provider.write('computer://box', made({}));

  await expect(provider.write('computer://box', made({}, { createOnly: true }))).rejects.toMatchObject({ code: -32010 });
  await expect(provider.write('computer://box', made({}))).rejects.toMatchObject({ code: -32010 });
  await expect(provider.write('computer://other', made({}))).rejects.toMatchObject({ code: -32602, message: expect.stringContaining('holds 1 computers') });

  // A write to a leaf or to the root is not a create at all.
  await expect(provider.write('computer://box/status', made({}))).rejects.toMatchObject({ code: -32602 });
  await expect(provider.write('computer://', made({}))).rejects.toMatchObject({ code: -32602 });
  expect(held.has('box')).toBe(true);
});

it('destroys a machine, and refuses what is not one', async () => {
  const { runtime, held, calls } = fake();
  held.set('box', { name: 'box', image: 'debian:bookworm-slim', Created: '2026-09-22T00:00:00Z' });
  const provider = computerProvider(runtime, options);

  await provider.remove('computer://box');
  expect(calls).toContain('remove box');
  expect(held.has('box')).toBe(false);

  await expect(provider.remove('computer://box')).rejects.toMatchObject({ code: -32008 });
  await expect(provider.remove('computer://')).rejects.toMatchObject({ code: -32602 });
  await expect(provider.remove('computer://box/status')).rejects.toMatchObject({ code: -32602 });
});

it('says in capabilities what a create body may contain', async () => {
  const { runtime, held } = fake();
  held.set('box', { name: 'box', image: 'debian:bookworm-slim', Created: '2026-09-22T00:00:00Z' });
  const provider = computerProvider(runtime, options);
  const caps = JSON.parse((await provider.read('computer://box/capabilities') as { data: string }).data) as {
    actions: string[];
    manifest: { type: string; properties: Record<string, { default?: string }> };
  };
  expect(caps.actions).toEqual(['create', 'destroy', 'exec']);
  expect(Object.keys(caps.manifest.properties)).toEqual(['runtime', 'image', 'cpus', 'memory', 'mounts', 'workdir']);
  // The same schema `describe` advertises, with this provider's own default.
  expect(caps.manifest).toEqual(provider.describe().manifest);
  expect(caps.manifest.properties.image?.default).toBe('debian:bookworm-slim');
});

it('describes itself, so a client can draw a screen for the scheme', () => {
  const { runtime } = fake();
  const provider = computerProvider(runtime, options);
  const said = provider.describe();
  expect(said.title).toBe('Computer');
  expect(said.description).toContain('session');
  // `root` and the operations are the host's to add, not the provider's to claim.
  expect(said).not.toHaveProperty('root');
  expect(said).not.toHaveProperty('operations');
});
