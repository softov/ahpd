import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { machineAsked, refuseComputer } from '../packages/sdk/src/computers.js';
import type { Agent, Start } from '../packages/sdk/src/types/agent.js';
import type { ComputerPort } from '../packages/sdk/src/types/computers.js';

/*
 * A backend that cannot enter a machine refuses a session that names one.
 *
 * The dangerous failure is silence: a session says `computer://box`, the
 * backend spawns its own process on the host anyway, and the person believes
 * they are inside a sandbox that is not there. `a-backend-reaches-a-computer-
 * through-a-port` says such a backend must refuse, and this is the test that
 * catches one that does not - the ACP half lives in `computer-session.test.ts`,
 * where a real fixture proves which command ran.
 *
 * **The port is not the permission.** The host hands `computers` to every
 * backend, so a gate that read the port as the backend's own capability let
 * Claude run on the host while the session said `computer://box`. What decides
 * is whether the backend does something with it - Claude Code spawns the CLI
 * through it - or whether it declares `runsNested`, which is the host running a
 * whole host in the machine instead. cofold declares it; a backend that
 * declares neither must refuse.
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

it('refuses a named machine on a host with no computers port', async () => {
  // The backends that have no answer for a machine. A backend that declared
  // `runsNested` is not one of them: the host serves it elsewhere.
  const refusing = (await backends()).filter(({ agent }) => agent.runsNested !== true);
  expect(refusing.length).toBeGreaterThan(0);
  for (const { name, agent } of refusing) {
    // Synchronous, before anything is spawned: the refusal is the first thing
    // the factory does, so no backend that refuses has started a process yet.
    const failure = (): void => { void agent.create(asking('computer://box')); };
    expect(failure, name).toThrow(/cannot run a session inside computer:\/\/box/);
    // The sentence names the backend, so a person reading it in a client knows
    // which of the two is the wrong one.
    expect(failure, name).toThrow(name);
  }
});

it('refuses a backend that cannot enter one, port or no port', () => {
  // A backend with nothing to move and no `runsNested` refusal of its own: a
  // port changes nothing about that, and a session that named a machine must
  // not quietly run on the host instead.
  const failure = (): void => { refuseComputer(asking('computer://box', port), 'plain'); };
  expect(failure).toThrow(/cannot run a session inside computer:\/\/box/);
  expect(failure).toThrow('plain');
  // And without a port the same sentence, because the setting is what decides.
  expect(() => { refuseComputer(asking('computer://box'), 'plain'); }).toThrow('plain');
});

it('cofold runs nested, so a machine is served by a host started inside it', async () => {
  // cofold's loop, tools and shell all run in this process, so there is no
  // child to start anywhere else. `runsNested` is how it says so, and what the
  // host does with it is `test/nested-proxy.test.ts` and the proxy's own
  // suites: the backend itself no longer refuses, because refusing would make
  // a machine cofold can now run in unusable.
  const { cofoldAgent } = await import('../packages/agent-cofold/src/agent.js');
  const agent = cofoldAgent({ memory: true });
  expect(agent.runsNested).toBe(true);
  expect(() => { void agent.create(asking('computer://box', port)); }).not.toThrow();
});

it('lets Claude Code through, because it spawns the CLI in the machine', async () => {
  // The other half of the same rule. Claude Code moves the process it starts,
  // so a port is the whole of what it needs; the refusal above is for a
  // backend that has nothing to move, not for every backend.
  const { claude } = await import('../packages/agent-claude/src/claude.js');
  const agent = claude({ paths: [mkdtempSync(join(tmpdir(), 'ahpd-refusal-'))] });
  expect(agent.runsNested).toBeUndefined();
  expect(() => { void agent.create(asking('computer://box', port)); }).not.toThrow();
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
