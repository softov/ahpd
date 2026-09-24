import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { machineAsked, refuseComputer } from '../packages/sdk/src/computers.js';
import type { Agent, Start } from '../packages/sdk/src/types/agent.js';
import type { ComputerPort } from '../packages/sdk/src/types/computers.js';

/*
 * A backend that cannot reach a machine refuses a session that names one.
 *
 * The dangerous failure is silence: a session says `computer://box`, the
 * backend spawns its own process on the host anyway, and the person believes
 * they are inside a sandbox that is not there. `a-backend-reaches-a-computer-
 * through-a-port` says such a backend must refuse, and this is the test that
 * catches one that does not - the ACP half lives in `computer-session.test.ts`,
 * where a real fixture proves which command ran.
 *
 * A backend that has the port refuses nothing: the machine may still be missing,
 * but that is that backend's error to report when it tries to reach it.
 */

const port: ComputerPort = {
  how: async () => ({ command: 'true', args: [] }),
};

/** The least a session is, for a backend that must decide before it spawns. */
const asking = (computer: string | undefined, computers?: ComputerPort): Start => ({
  uri: 'ahp-session:/asked',
  chatUri: 'ahp-chat:/asked',
  settings: computer === undefined ? {} : { computer },
  ...(computers === undefined ? {} : { computers }),
} as unknown as Start);

/** Every backend that ships here, so a new one cannot skip the rule. */
async function backends(): Promise<{ name: string; agent: Agent }[]> {
  const [{ claude }, { cofoldAgent }] = await Promise.all([
    import('../packages/agent-claude/src/claude.js'),
    import('../packages/agent-cofold/src/agent.js'),
  ]);
  return [
    { name: 'Claude Code', agent: claude({ paths: [mkdtempSync(join(tmpdir(), 'ahpd-refusal-'))] }) },
    { name: 'cofold', agent: cofoldAgent({ memory: true }) },
  ];
}

it('refuses a named machine when the host carries no computers port', async () => {
  for (const { name, agent } of await backends()) {
    // Synchronous, before anything is spawned: the refusal is the first thing
    // the factory does, so no backend that refuses has started a process yet.
    const failure = (): void => { void agent.create(asking('computer://box')); };
    expect(failure, name).toThrow(/cannot run a session inside computer:\/\/box/);
    // The sentence names the backend, so a person reading it in a client knows
    // which of the two is the wrong one.
    expect(failure, name).toThrow(name);
  }
});

it('does not refuse a backend that was handed the port', async () => {
  // The gate asks one question - does this backend have a way to reach a
  // machine - and a port is that way, whether or not it can reach *this* one.
  expect(() => {
    refuseComputer(asking('computer://box', port) as Start, 'Claude Code');
  }).not.toThrow();
});

it('treats an empty or absent machine as the host', () => {
  // The computer plugin's own schema says an empty value runs on the host, and
  // that arrives as often as an absent one, so neither is a machine to refuse.
  expect(machineAsked(asking(undefined))).toBeUndefined();
  expect(machineAsked(asking(''))).toBeUndefined();
  expect(machineAsked(asking('   '))).toBeUndefined();
  expect(machineAsked(asking('computer://box'))).toBe('computer://box');
  // Trimmed, so a value with a stray space is not a machine named ` box`.
  expect(machineAsked(asking(' computer://box '))).toBe('computer://box');
});
