import { expect, it } from 'vitest';
import { BARE, parseMachineId, routed, spellMachineId } from '../src/router.js';
import { listingMeter, makesMachines } from '../src/plugin.js';
import type { Claim, StretchBook } from '../src/plugin.js';
import type { ComputerRuntime, Machine, MachineSpec, RuntimeCapabilities } from '../src/runtime.js';

/*
 * One host, several runtimes, and the id that says which one answers.
 *
 * Nothing here spawns anything: the runtimes are fakes that answer what the
 * test told them to. What is under test is the spelling of a machine's id, the
 * routing of a call by it, the listing that survives one runtime being down,
 * and the up-time rule for a runtime that only lists.
 */

/** A row a fake runtime lists, with only what a listing reads. */
const row = (id: string): Machine => ({
  id,
  image: 'debian:bookworm-slim',
  status: 'running',
  created: new Date(0).toISOString(),
});

const capabilities = (name: string, actions: string[]): RuntimeCapabilities =>
  ({ runtime: name, actions, resources: ['cpu', 'memory'] });

/**
 * A runtime that answers nothing of its own, for a test to override the part
 * it is about.
 */
const faker = (name: string, over: Partial<ComputerRuntime> = {}): ComputerRuntime => ({
  kind: name,
  remote: name !== BARE,
  list: async () => [],
  inspect: async () => undefined,
  state: async () => undefined,
  agents: async () => undefined,
  parts: async () => undefined,
  owner: async () => undefined,
  how: async () => undefined,
  hostCommand: async () => undefined,
  run: async (spec: MachineSpec) => row(spec.name),
  stop: async () => {},
  remove: async () => {},
  exec: async () => ({ output: '', code: 0 }),
  putIn: async () => {},
  takeOut: async () => {},
  copyOut: async () => false,
  bringBack: async () => undefined,
  follow: async () => {},
  start: async () => {},
  restart: async () => {},
  stats: async () => undefined,
  capabilities: () => capabilities(name, ['create', 'list', 'exec']),
  hasImage: async () => false,
  buildImage: async () => {},
  pullImage: async () => {},
  removeImage: async () => {},
  imagesOf: async () => [],
  checkPart: async () => undefined,
  ...over,
});

it('spells an id with its runtime, and reads back the runtime and the name', () => {
  // Every runtime but the local Docker, whose machines keep the name they have
  // always had: an operator's machines do not change id because a second
  // runtime arrived.
  for (const runtime of ['ssh', 'libvirt', 'proxmox', 'node', 'docker-far']) {
    expect(spellMachineId(runtime, 'dev02')).toBe(`${runtime}.dev02`);
    expect(parseMachineId(spellMachineId(runtime, 'dev02'))).toEqual({ runtime, name: 'dev02' });
  }
  expect(spellMachineId(BARE, 'box')).toBe('box');
  expect(parseMachineId('box')).toEqual({ runtime: BARE, name: 'box' });

  /*
   * The first dot separates, so a name may hold dots and a runtime value may
   * not: `docker-far.box` is a machine on `docker-far`, not on `docker`.
   */
  expect(parseMachineId('docker-far.box')).toEqual({ runtime: 'docker-far', name: 'box' });
  expect(parseMachineId('ssh.team.dev02')).toEqual({ runtime: 'ssh', name: 'team.dev02' });
  // A leading dot names no runtime, and an empty id is the bare runtime's.
  expect(parseMachineId('.box')).toEqual({ runtime: BARE, name: '.box' });
  expect(parseMachineId('')).toEqual({ runtime: BARE, name: '' });
});

it('lists every runtime, each set under the ids its own runtime spells', async () => {
  const docker = faker(BARE, { list: async () => [row('box'), row('other')] });
  const ssh = faker('ssh', { list: async () => [row('dev02')] });
  const one = routed({ [BARE]: docker, ssh }, BARE);

  expect((await one.list()).map((machine) => machine.id)).toEqual(['box', 'other', 'ssh.dev02']);
  expect(one.kind).toBe(BARE);
  expect(one.remote).toBe(false);

  // A call in the other direction: the second runtime answers with the name
  // alone, which is the id without the prefix that named it.
  const asked: [string, unknown][] = [];
  const spied = faker('ssh', {
    inspect: async (id) => { asked.push(['inspect', id]); return { Name: `/${id}` }; },
    start: async (id) => { asked.push(['start', id]); },
  });
  const local = faker(BARE, { inspect: async (id) => { asked.push(['inspect', id]); return { Name: `/${id}` }; } });
  const two = routed({ [BARE]: local, ssh: spied }, BARE);

  expect(await two.inspect('ssh.dev02')).toEqual({ Name: '/dev02' });
  await two.start('ssh.dev02');
  // And a bare name reaches the local Docker the same way, with the name whole.
  await two.inspect('box');
  expect(asked).toEqual([['inspect', 'dev02'], ['start', 'dev02'], ['inspect', 'box']]);
  expect(two.runtimeFor('ssh.dev02')).toBe(spied);
  expect(two.runtimeFor('nowhere.box')).toBeUndefined();
});

it('routes a machine state, its agents and its owner to the runtime its id names', async () => {
  const asked: string[] = [];
  const docker = faker(BARE, {
    state: async () => 'running',
    agents: async () => ['claude'],
    owner: async (id) => { asked.push(id); return { owner: 'user:ana', team: 'blue' }; },
  });
  const ssh = faker('ssh', {
    state: async () => 'stopped',
    agents: async () => [],
    owner: async (id) => { asked.push(id); return {}; },
  });
  const one = routed({ [BARE]: docker, ssh }, BARE);

  expect(await one.state('box')).toBe('running');
  expect(await one.agents('box')).toEqual(['claude']);
  expect(await one.owner('box')).toEqual({ owner: 'user:ana', team: 'blue' });
  // A box answers all three for itself, and what it is given is the name alone.
  expect(await one.state('ssh.dev02')).toBe('stopped');
  expect(await one.agents('ssh.dev02')).toEqual([]);
  expect(await one.owner('ssh.dev02')).toEqual({});
  expect(asked).toEqual(['box', 'dev02']);

  // A runtime this host does not serve answers nothing, which is the same
  // answer as a machine that is not there.
  expect(await one.state('libvirt.web1')).toBeUndefined();
  expect(await one.agents('libvirt.web1')).toBeUndefined();
  expect(await one.owner('libvirt.web1')).toBeUndefined();
});

it('makes a machine on the runtime it was configured with, and never a dotted name there', async () => {
  const docker = faker(BARE);
  const ssh = faker('ssh');
  const one = routed({ [BARE]: docker, ssh }, BARE);
  const spec = (name: string): MachineSpec => ({ name, image: 'debian:bookworm-slim', label: 'ahpd.computer=1' });

  expect((await one.run(spec('box'))).id).toBe('box');
  /*
   * A dot in a bare name is refused at the one moment a name becomes an id.
   * `docker-far.box` reads as another runtime's machine, and a machine made
   * under that name could not be addressed again.
   */
  await expect(one.run(spec('docker-far.box'))).rejects.toThrow(/a dot in it reads as another runtime's/);

  // Configured with another runtime, a create goes there and is spelled by it.
  const two = routed({ [BARE]: docker, ssh }, 'ssh');
  expect(two.kind).toBe('ssh');
  expect(two.remote).toBe(true);
  expect((await two.run(spec('dev02'))).id).toBe('ssh.dev02');
  expect((await two.run(spec('with.dots'))).id).toBe('ssh.with.dots');
});

it('names what this host serves when an id is on a runtime it does not', async () => {
  const one = routed({ [BARE]: faker(BARE), ssh: faker('ssh') }, BARE);
  const asked = async (): Promise<unknown> => one.exec('libvirt.web1', ['true']);
  await expect(asked).rejects.toThrow(/libvirt/);
  await expect(asked).rejects.toThrow(/docker, ssh/);

  // Nothing is the answer for a machine that is not on a runtime served here,
  // which is what every "there is no such machine" reads as.
  expect(await one.inspect('libvirt.web1')).toBeUndefined();
  expect(await one.how('libvirt.web1', { command: 'node' })).toBeUndefined();
  expect(await one.hostCommand('libvirt.web1')).toBeUndefined();
});

it('keeps the rows of a runtime that answered when another threw or hung', async () => {
  const lines: string[] = [];
  const docker = faker(BARE, { list: async () => { throw new Error('Cannot connect to the Docker daemon'); } });
  const ssh = faker('ssh', { list: async () => [row('dev02')] });
  const hung = faker('libvirt', { list: () => new Promise<Machine[]>(() => {}) });

  const one = routed({ [BARE]: docker, ssh, libvirt: hung }, BARE, {
    log: (line) => lines.push(line),
    listTimeout: 20,
  });

  // Docker's own `list` throws by design when Docker is not answering, and a
  // host that also serves a box over ssh still lists that box, beside a line
  // for each runtime that did not answer in VS Code's words for a listing
  // that failed (devContainerAgentHostService.ts L970-L972 at 6b68d3fe).
  expect((await one.list()).map((machine) => machine.id)).toEqual(['ssh.dev02']);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(/^Could not list the docker machines, so the 0 it last listed are kept: /);
  expect(lines[0]).toContain('Cannot connect to the Docker daemon');
  expect(lines[1]).toMatch(/^Could not list the libvirt machines, so the 0 it last listed are kept: /);
  expect(lines[1]).toContain('did not answer within 20ms');
});

/*
 * A runtime that answered once and then does not answer keeps the rows it
 * last answered, as VS Code keeps the list it had when a refresh fails, so a
 * catalogue over the listing does not say its machines removed.
 */
it('keeps the rows a runtime last answered while it does not answer', async () => {
  let answering = true;
  const ssh = faker('ssh', { list: async () => { if (!answering) throw new Error('ssh: connect to host dev02: No route to host'); return [row('dev02')]; } });
  const lines: string[] = [];
  const one = routed({ ssh }, 'ssh', { log: (line) => lines.push(line) });

  expect((await one.list()).map((machine) => machine.id)).toEqual(['ssh.dev02']);
  answering = false;
  expect((await one.list()).map((machine) => machine.id)).toEqual(['ssh.dev02']);
  expect(lines).toEqual(['Could not list the ssh machines, so the 1 it last listed are kept: ssh: connect to host dev02: No route to host']);
});

it('charges the host for a machine a listing runtime found up and then gone', async () => {
  const opened: string[] = [];
  const closed: [string, Claim][] = [];
  // The same book the plugin keeps: one stretch per machine, and a close for a
  // machine with none open writes nothing.
  const up = new Set<string>();
  const book: StretchBook = {
    open: (id) => { if (!up.has(id)) { up.add(id); opened.push(id); } },
    close: async (id, claimed) => { if (!up.has(id)) return; up.delete(id); closed.push([id, claimed]); },
  };
  const meter = listingMeter(book, 'dev03.example.com');

  // Two listings in a row that see it reachable are one stretch, not two: the
  // machine was up the whole time and is charged for the whole time.
  meter.reachable('ssh.dev02');
  meter.reachable('ssh.dev02');
  expect(opened).toEqual(['ssh.dev02']);
  expect(closed).toEqual([]);

  // The listing that finds it gone is what closes the stretch, and nobody here
  // made the machine, so the host pays.
  await meter.unreachable('ssh.dev02');
  expect(closed).toEqual([['ssh.dev02', { owner: 'root:dev03.example.com' }]]);

  // A machine found down with no stretch open writes nothing.
  await meter.unreachable('ssh.other');
  expect(closed).toHaveLength(1);
});

it('reads whether a runtime makes machines from what it says it can do', () => {
  // A runtime that declares no `create` only lists, so it is metered from its
  // listings rather than from a start and a stop.
  expect(makesMachines(faker('ssh', { capabilities: () => capabilities('ssh', ['list', 'exec']) }))).toBe(false);
  expect(makesMachines(faker(BARE))).toBe(true);
  // A machine whose runtime this host does not serve has no answer either way,
  // and what is not known is not a listing runtime.
  expect(makesMachines(undefined)).toBe(true);
});

it('makes a machine on the runtime its spec picks, under that runtime\'s id', async () => {
  const docker = faker(BARE);
  const far = faker('docker-far');
  const one = routed({ [BARE]: docker, 'docker-far': far }, BARE, {
    makerFor: (spec) => (spec.profile === 'far' ? 'docker-far' : undefined),
  });
  expect((await one.run({ name: 'box', image: 'node:22', profile: 'far' } as MachineSpec)).id).toBe('docker-far.box');
  expect((await one.run({ name: 'here', image: 'node:22' } as MachineSpec)).id).toBe('here');
});

it('bounds a hung runtime\'s listing and reads by its own timeout, and tells what each runtime answered', async () => {
  const never = new Promise<never>(() => {});
  const docker = faker(BARE, { list: async () => [row('here')] });
  const far = faker('docker-far', { list: () => never, inspect: () => never });
  const lines: string[] = [];
  const answered: [string, string[] | undefined][] = [];
  const one = routed({ [BARE]: docker, 'docker-far': far }, BARE, {
    log: (line) => { lines.push(line); },
    timeouts: { 'docker-far': 20 },
    listed: (value, rows) => { answered.push([value, rows?.map((machine) => machine.id)]); },
  });

  expect((await one.list()).map((machine) => machine.id)).toEqual(['here']);
  expect(lines).toEqual(['Could not list the docker-far machines, so the 0 it last listed are kept: the docker-far runtime did not answer within 20ms']);
  expect(answered.sort()).toEqual([['docker', ['here']], ['docker-far', undefined]]);
  await expect(one.inspect('docker-far.box')).rejects.toThrow('the docker-far runtime did not answer within 20ms');
});

it('gives a bring-back on a box the time it takes, past the bound on its reads', async () => {
  const far = faker('docker-far', {
    bringBack: () => new Promise((resolve) => { setTimeout(() => { resolve({ moved: true }); }, 60); }),
  });
  const one = routed({ [BARE]: faker(BARE), 'docker-far': far }, BARE, { timeouts: { 'docker-far': 20 } });
  expect(await one.bringBack('docker-far.box')).toEqual({ moved: true });
  expect(await one.bringBack('nowhere.box')).toBeUndefined();
});
