import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { AgentView, Connector, UiHandle } from '@ahpd/sdk';
import { echo } from '../../../examples/echo/agent.js';
import { loadPlugins } from '../../server/src/plugins.js';
import { OpenLogins } from '../src/logins.js';

/*
 * A Claude agent draws the plan usage of each of its logins.
 *
 * Its record names `claude-login` connectors, and the agent's ui carries one
 * entry for each one it may run on. An answer for one login is drawn by the
 * agents that name it and by no other, and the record is read as it is when the
 * answer arrives, so an edit of its logins shows at that answer.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/agent-claude/src/index.ts';
const DIR = mkdtempSync(join(tmpdir(), 'ahpd-agent-ui-'));

/** One open login, as the adapter's `open` is handed it. */
const connectorOf = (id: string, token: string, owner: Connector['owner'] = 'host'): Connector =>
  ({ id, adapter: 'claude-login', owner, config: { token } });

/** One record's view, as the engine's `open` is handed it. */
const recordOf = (id: string, logins: string[], owner: AgentView['owner'] = 'host'): AgentView => ({
  id,
  engine: 'claude',
  owner,
  name: id,
  description: undefined,
  icon: undefined,
  model: undefined,
  config: { logins },
});

/** A ui handle, and the data each show sent. */
const shownOf = (): { ui: UiHandle; shown: Record<string, unknown>[] } => {
  const shown: Record<string, unknown>[] = [];
  return { ui: { show: (data) => { shown.push(data); }, clear: () => {} }, shown };
};

it('registers the agent schema as a ui capability of the Claude engine', async () => {
  const { problems, options } = await loadPlugins([{ name: SOURCE, options: {} }], {
    base: { path: DIR, agents: [echo({ path: DIR })] },
    configDir: REPO,
    cwd: REPO,
    log: () => {},
  });
  expect(problems).toEqual([]);
  const capabilities = options.engines?.['claude']?.capabilities;
  expect(capabilities).toHaveLength(1);
  expect(capabilities?.[0]).toMatchObject({ type: 'ui', name: 'plan' });
  expect(capabilities?.[0]?.ui?.root).toBe('logins');
});

it('gives an agent one entry for one login, and two for two, leaving out one it may not use', () => {
  const logins = new OpenLogins();
  logins.opened(connectorOf('work', 'token-work'));
  logins.opened(connectorOf('home', 'token-home'));
  logins.opened(connectorOf('theirs', 'token-theirs', 'user:ana'));

  const one = shownOf();
  logins.agentOpened(recordOf('one', ['work', 'work']), one.ui);
  expect(one.shown).toEqual([{ logins: [{ name: 'work', windows: [] }] }]);

  const two = shownOf();
  logins.agentOpened(recordOf('two', ['work', 'home', 'theirs', 'gone']), two.ui);
  expect(two.shown).toEqual([{
    logins: [
      { name: 'work', windows: [] },
      { name: 'home', windows: [] },
    ],
  }]);
});

it('draws a plan answer only on the agents that name the login', () => {
  const logins = new OpenLogins();
  logins.opened(connectorOf('work', 'token-work'));
  logins.opened(connectorOf('home', 'token-home'));

  const mine = shownOf();
  const other = shownOf();
  logins.agentOpened(recordOf('mine', ['work']), mine.ui);
  logins.agentOpened(recordOf('other', ['home']), other.ui);

  logins.noted('work', 'token-work', {
    quotaSnapshots: { session: { remainingPercentage: 50, resetDate: '2026-11-04T15:00:00.000Z' } },
    account: { subscriptionType: 'max' },
  });
  expect(mine.shown).toHaveLength(2);
  expect(mine.shown[1]).toEqual({
    logins: [{ name: 'work', plan: 'max', windows: [{ name: 'Session', left: 50, reset: '2026-11-04T15:00:00.000Z' }] }],
  });
  // The other agent names another login, so nothing it draws changed.
  expect(other.shown).toHaveLength(1);
});

it('reads a record\'s logins as they are now, not as they were when it opened', () => {
  const logins = new OpenLogins();
  logins.opened(connectorOf('work', 'token-work'));
  logins.opened(connectorOf('home', 'token-home'));

  const record = recordOf('mine', ['work']);
  const mine = shownOf();
  logins.agentOpened(record, mine.ui);
  expect(mine.shown).toEqual([{ logins: [{ name: 'work', windows: [] }] }]);

  // The channel fills the same view again on an edit, with a new config object.
  (record as { config: Record<string, unknown> }).config = { logins: ['work', 'home'] };
  logins.noted('home', 'token-home', { quotaSnapshots: { weekly: { remainingPercentage: 20 } } });
  expect(mine.shown.at(-1)).toEqual({
    logins: [
      { name: 'work', windows: [] },
      { name: 'home', windows: [{ name: 'Weekly', left: 20 }] },
    ],
  });
});
