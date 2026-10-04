import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import type { ComputerPort } from '../src/types/computers.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * A session counted in and out of a machine.
 *
 * `enter` and `leave` are the only two moments a machine's count moves, and a
 * port may do work before it answers either: a plugin that finds its machines
 * by listing them at startup cannot count a session into one it has not found
 * yet. So both may answer a promise, and what this file is about is the host
 * around a promise - a session starts and a session goes whether the port
 * answered, and a port that fails is a line in the log rather than this process
 * on the floor.
 */

const DIR = '/tmp/ahpd-computer-count';

const peer = (): Peer => ({
  send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
});

const settle = async (times = 40): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** A port that answers late and, when it is asked, not at all. */
const failing = (said: string[]): ComputerPort => ({
  how: async () => undefined,
  create: async () => 'box',
  enter: async (id, session) => {
    said.push(`enter ${id} ${session}`);
    throw new Error('docker is not running');
  },
  leave: async (id, session) => {
    said.push(`leave ${id} ${session}`);
    throw new Error('docker is not running');
  },
});

it('starts and disposes a session whether the port answered its enter and leave', async () => {
  const said: string[] = [];
  const lines: string[] = [];
  const host = createHost({
    path: DIR,
    agents: [echo({ path: DIR, pace: 0 })],
    computers: failing(said),
    onEvent: (line) => { lines.push(line); },
  });
  const client = host.accept(peer());
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });

  // The session runs, in a machine the port could not count it into.
  await client.handle({
    method: 'createSession',
    params: { channel: 'echo:/one', provider: 'echo', config: { computer: 'computer://box' } },
  });
  await settle();
  expect(said).toEqual(['enter box echo:/one']);

  // And it goes, the same way.
  await client.handle({ method: 'disposeSession', params: { channel: 'echo:/one' } });
  await settle();
  expect(said).toEqual(['enter box echo:/one', 'leave box echo:/one']);

  // A port that failed says so, in the one place a person reads it. Nothing
  // waits on these promises, so without that line this is where the daemon
  // would be going down instead.
  expect(lines.some((one) => one.includes('computers: enter of box for echo:/one failed: docker is not running'))).toBe(true);
  expect(lines.some((one) => one.includes('computers: leave of box for echo:/one failed: docker is not running'))).toBe(true);
});

/** The same port, failing before it answers rather than after. */
const throwing = (said: string[]): ComputerPort => ({
  how: async () => undefined,
  create: async () => 'box',
  enter: (id, session) => {
    said.push(`enter ${id} ${session}`);
    throw new Error('the machine list is not in yet');
  },
  leave: (id, session) => {
    said.push(`leave ${id} ${session}`);
    throw new Error('the machine list is not in yet');
  },
});

/*
 * A port written as `enter(id) { throw }` rather than as an async one that
 * rejects: the two are the same failure to the caller and not the same thing to
 * anything wrapping the call. Asked inside the promise rather than around it,
 * so both are one thing to catch.
 */
it('logs a port that throws before it answers, rather than letting it out', async () => {
  const said: string[] = [];
  const lines: string[] = [];
  const host = createHost({
    path: DIR,
    agents: [echo({ path: DIR, pace: 0 })],
    computers: throwing(said),
    onEvent: (line) => { lines.push(line); },
  });
  const client = host.accept(peer());
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });

  await client.handle({
    method: 'createSession',
    params: { channel: 'echo:/one', provider: 'echo', config: { computer: 'computer://box' } },
  });
  await settle();
  expect(said).toEqual(['enter box echo:/one']);

  await client.handle({ method: 'disposeSession', params: { channel: 'echo:/one' } });
  await settle();
  expect(said).toEqual(['enter box echo:/one', 'leave box echo:/one']);

  expect(lines.some((one) => one.includes('computers: enter of box for echo:/one failed: the machine list is not in yet'))).toBe(true);
  expect(lines.some((one) => one.includes('computers: leave of box for echo:/one failed: the machine list is not in yet'))).toBe(true);
});