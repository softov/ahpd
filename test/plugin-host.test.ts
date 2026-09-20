import { expect, it } from 'vitest';
import { createHost } from '../packages/sdk/src/host.js';
import { AGENT_CLASH, foldHostOptions } from '../packages/sdk/src/plugins.js';
import { echo } from '../examples/echo/agent.js';
import type { Agent } from '../packages/sdk/src/types/agent.js';
import type { HostOptions } from '../packages/sdk/src/types/host.js';
import type { Contribution } from '../packages/sdk/src/types/plugin.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';

/*
 * What the fold is for: a host that serves a plugin's backend.
 *
 * `main.ts` is not started here - the daemon domain records why - so this
 * checks the part that matters and can be checked: the object `foldHostOptions`
 * answers is a `HostOptions` in every way `createHost` cares about, and a
 * client that initializes against it sees the contributed backend beside the
 * daemon's own.
 */

const peer = (): Peer => ({
  send: () => {},
  notify: () => {},
  request: async () => ({}),
  answered: () => {},
  close: () => {},
});

const base = (): HostOptions => ({ path: '/tmp/plugin-host', agents: [echo({ path: '/tmp/plugin-host' })] });

const contributed: Agent = {
  ...echo({ path: '/tmp/plugin-host' }),
  provider: 'contributed',
  displayName: 'Contributed backend',
};

const contribution: Contribution = { by: 'fixture', agents: [contributed], tools: [], ports: {} };

it('serves a backend a plugin contributed, beside the daemon\'s own', async () => {
  const { options, problems } = foldHostOptions(base(), [contribution]);
  expect(problems).toEqual([]);

  const host = createHost(options);
  const client = host.accept(peer());
  const ready = await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.8.0'], initialSubscriptions: ['ahp-root://'] },
  }) as { snapshots: { state: { agents: { provider: string; displayName: string }[] } }[] };

  expect(ready.snapshots[0]?.state.agents.map((one) => one.provider)).toEqual(['echo', 'contributed']);
  expect(ready.snapshots[0]?.state.agents[1]?.displayName).toBe('Contributed backend');

  // A host built from folded options is a host in every other way too: the
  // catalogue answers, which is what a client asks next.
  const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
  expect(listed).toMatchObject({ items: [] });
});

it('marks a provider clash so a caller can refuse over one without reading prose', () => {
  const twice = foldHostOptions(base(), [
    { by: 'one', agents: [{ ...echo({ path: '/x' }), provider: 'echo' }], tools: [], ports: {} },
  ]);
  expect(twice.problems).toHaveLength(1);
  expect(twice.problems[0]?.startsWith(AGENT_CLASH)).toBe(true);
});
