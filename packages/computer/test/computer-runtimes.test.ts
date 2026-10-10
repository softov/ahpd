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
  how: async () => undefined,
  hostCommand: async () => undefined,
  run: async (spec: MachineSpec) => row(spec.name),
  stop: async () => {},
  remove: async () => {},
  exec: async () => ({ output: '', code: 0 }),
  putIn: async () => {},
  takeOut: async () => {},
  bringBack: async () => undefined,
  follow: async () => {},
  start: async () => {},
  restart: async () => {},
  stats: async () => undefined,
  capabilities: () => capabilities(name, ['create', 'list', 'exec']),
  hasImage: async () => false,
  buildImage: async () => {},
  ...over,
});

it('spells an id with its runtime, and reads back the runtime and the name', () => {
  // Every runtime but the local Docker, whose machines keep the name they have
  // always had: an operator's machines do not change id because a second
  // runtime arrived.
  for (const runtime of ['ssh', 'libvirt', 'proxmox', 'node', 'docker-far']) {
    expect(spellMachineId(runtime, 'dev86')).toBe(`${runtime}.dev86`);
    expect(parseMachineId(spellMachineId(runtime, 'dev86'))).toEqual({ runtime, name: 'dev86' });
  }
  expect(spellMachineId(BARE, 'box')).toBe('box');
  expect(parseMachineId('box')).toEqual({ runtime: BARE, name: 'box' });

  /*
   * The first dot separates, so a name may hold dots and a runtime value may
   * not: `docker-far.box` is a machine on `docker-far`, not on `docker`.
   */
  expect(parseMachineId('docker-far.box')).toEqual({ runtime: 'docker-far', name: 'box' });
  expect(parseMachineId('ssh.team.dev86')).toEqual({ runtime: 'ssh', name: 'team.dev86' });
  // A leading dot names no runtime, and an empty id is the bare runtime's.
  expect(parseMachineId('.box')).toEqual({ runtime: BARE, name: '.box' });
  expect(parseMachineId('')).toEqual({ runtime: BARE, name: '' });
});

it('lists every runtime, each set under the ids its own runtime spells', async () => {
  const docker = faker(BARE, { list: async () => [row('box'), row('other')] });
  const ssh = faker('ssh', { list: async () => [row('dev86')] });
  const one = routed({ [BARE]: docker, ssh }, BARE);

  expect((await one.list()).map((machine) => machine.id)).toEqual(['box', 'other', 'ssh.dev86']);
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

  expect(await two.inspect('ssh.dev86')).toEqual({ Name: '/dev86' });
  await two.start('ssh.dev86');
  // And a bare name reaches the local Docker the same way, with the name whole.
  await two.inspect('box');
  expect(asked).toEqual([['inspect', 'dev86'], ['start', 'dev86'], ['inspect', 'box']]);
  expect(two.runtimeFor('ssh.dev86')).toBe(spied);
  expect(two.runtimeFor('nowhere.box')).toBeUndefined();
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
  expect((await two.run(spec('dev86'))).id).toBe('ssh.dev86');
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
  const ssh = faker('ssh', { list: async () => [row('dev86')] });
  const hung = faker('libvirt', { list: () => new Promise<Machine[]>(() => {}) });

  const one = routed({ [BARE]: docker, ssh, libvirt: hung }, BARE, {
    log: (line) => lines.push(line),
    listTimeout: 20,
  });

  // Docker's own `list` throws by design when Docker is not answering, and a
  // host that also serves a box over ssh still lists that box.
  expect((await one.list()).map((machine) => machine.id)).toEqual(['ssh.dev86']);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(/^the docker runtime did not list its machines, so they are left out: /);
  expect(lines[0]).toContain('Cannot connect to the Docker daemon');
  expect(lines[1]).toMatch(/^the libvirt runtime did not list its machines, so they are left out: /);
  expect(lines[1]).toContain('did not answer within 20ms');
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
  const meter = listingMeter(book, 'dev82.brbyte.com');

  // Two listings in a row that see it reachable are one stretch, not two: the
  // machine was up the whole time and is charged for the whole time.
  meter.reachable('ssh.dev86');
  meter.reachable('ssh.dev86');
  expect(opened).toEqual(['ssh.dev86']);
  expect(closed).toEqual([]);

  // The listing that finds it gone is what closes the stretch, and nobody here
  // made the machine, so the host pays.
  await meter.unreachable('ssh.dev86');
  expect(closed).toEqual([['ssh.dev86', { owner: 'root:dev82.brbyte.com' }]]);

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
