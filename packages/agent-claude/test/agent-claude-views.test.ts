import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { withViewData } from '@ahpd/sdk';
import { checkView } from '../../sdk/src/plugins/view.js';
import type { AgentView, Connector, PluginView, ViewHandle } from '@ahpd/sdk';
import { echo } from '../../../examples/echo/agent.js';
import { loadPlugins } from '../../server/src/plugins.js';
import { OpenLogins } from '../src/logins.js';
import { AGENT_VIEW, LOGIN_VIEW } from '../src/views.js';

/*
 * A `claude-login` connector and a Claude agent show the plan usage on their
 * `main` view.
 *
 * Each shows its view once, at its open, and an account's answer sets the data
 * with `setViewData`. An agent's record names `claude-login` connectors, and
 * its view carries one entry for each one it may run on. An answer for one
 * login reaches the agents that name it and no other, and the record is read
 * as it is when the answer arrives, so an edit of its logins shows then.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/agent-claude/src/index.ts';
const DIR = mkdtempSync(join(tmpdir(), 'ahpd-agent-views-'));

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

/** A view handle that keeps the view as the host would, and each call it was made. */
const viewOf = (): { view: ViewHandle; shown: PluginView[]; set: [string, unknown][]; data: () => unknown } => {
  const shown: PluginView[] = [];
  const set: [string, unknown][] = [];
  let held: PluginView | undefined;
  const view: ViewHandle = {
    showView: (one) => { shown.push(one); held = one; },
    setViewData: (path, value) => { set.push([path, value]); if (held !== undefined) held = withViewData(held, path, value); },
    clearView: () => { held = undefined; },
  };
  return { view, shown, set, data: () => held?.dataModel };
};

it('declares a view capability named main on the adapter and the engine', async () => {
  const { problems, options } = await loadPlugins([{ name: SOURCE, options: {} }], {
    base: { path: DIR, agents: [echo({ path: DIR })] },
    configDir: REPO,
    cwd: REPO,
    log: () => {},
  });
  expect(problems).toEqual([]);
  expect(options.engines?.['claude']?.capabilities).toEqual([expect.objectContaining({ type: 'view', name: 'main' })]);
  expect(options.adapters?.['claude-login']?.capabilities).toEqual([expect.objectContaining({ type: 'view', name: 'main' })]);
});

it('shows views the host check passes', () => {
  expect(() => { checkView(LOGIN_VIEW, 'main', 'agent-claude', {}); }).not.toThrow();
  expect(() => { checkView(AGENT_VIEW, 'main', 'agent-claude', {}); }).not.toThrow();
});

it('shows a login\'s view at its open, and sets the plan on each answer', () => {
  const logins = new OpenLogins();
  const login = viewOf();
  logins.opened(connectorOf('work', 'token-work'), login.view);
  expect(login.shown).toEqual([{ ...LOGIN_VIEW, dataModel: { windows: [] } }]);

  logins.noted('work', 'token-work', {
    quotaSnapshots: { session: { remainingPercentage: 50, resetDate: '2026-11-04T15:00:00.000Z' } },
    account: { subscriptionType: 'max' },
  });
  expect(login.set).toHaveLength(1);
  expect(login.data()).toEqual({ plan: 'max', windows: [{ name: 'Session', left: 50, used: 50, reset: '2026-11-04T15:00:00.000Z', resetInSeconds: 0 }] });

  // A note of a token the login no longer holds sets nothing.
  logins.noted('work', 'token-old', { account: { subscriptionType: 'pro' } });
  expect(login.set).toHaveLength(1);
});

it('gives an agent one entry for one login, and two for two, leaving out one it may not use', () => {
  const logins = new OpenLogins();
  logins.opened(connectorOf('work', 'token-work'));
  logins.opened(connectorOf('home', 'token-home'));
  logins.opened(connectorOf('theirs', 'token-theirs', 'user:ana'));

  const one = viewOf();
  logins.agentOpened(recordOf('one', ['work', 'work']), one.view);
  expect(one.shown).toEqual([{ ...AGENT_VIEW, dataModel: { logins: [{ name: 'work', windows: [] }] } }]);

  const two = viewOf();
  logins.agentOpened(recordOf('two', ['work', 'home', 'theirs', 'gone']), two.view);
  expect(two.data()).toEqual({
    logins: [
      { name: 'work', windows: [] },
      { name: 'home', windows: [] },
    ],
  });
});

it('sets a plan answer only on the agents that name the login', () => {
  const logins = new OpenLogins();
  logins.opened(connectorOf('work', 'token-work'));
  logins.opened(connectorOf('home', 'token-home'));

  const mine = viewOf();
  const other = viewOf();
  logins.agentOpened(recordOf('mine', ['work']), mine.view);
  logins.agentOpened(recordOf('other', ['home']), other.view);

  logins.noted('work', 'token-work', {
    quotaSnapshots: { session: { remainingPercentage: 50, resetDate: '2026-11-04T15:00:00.000Z' } },
    account: { subscriptionType: 'max' },
  });
  expect(mine.set.map(([path]) => path)).toEqual(['/logins']);
  expect(mine.data()).toEqual({
    logins: [{ name: 'work', plan: 'max', windows: [{ name: 'Session', left: 50, used: 50, reset: '2026-11-04T15:00:00.000Z', resetInSeconds: 0 }] }],
  });
  // The other agent names another login, so nothing it shows changed.
  expect(other.set).toEqual([]);
});

it('carries extra usage on the window it is billed beside', () => {
  const logins = new OpenLogins();
  const login = viewOf();
  logins.opened(connectorOf('work', 'token-work'), login.view);
  logins.noted('work', 'token-work', {
    quotaSnapshots: {
      weekly: { remainingPercentage: 10, resetDate: '2026-11-10T12:00:00.000Z', overageAllowedWithExhaustedQuota: true, overage: 12.5, overageEntitlement: 50 },
    },
    account: { subscriptionType: 'max' },
  });
  expect(login.data()).toEqual({
    plan: 'max',
    windows: [
      {
        name: 'Weekly', left: 10, used: 90, reset: '2026-11-10T12:00:00.000Z', resetInSeconds: expect.any(Number),
        extra: true, extraUsed: 12.5, extraCap: 50,
      },
      // The extra usage follows its window as a bar of its own, as /usage shows it.
      { name: 'Extra usage', used: 25 },
    ],
  });
});

it('shows the last plan again when a login opens again with the same token, and none for a new token', () => {
  const logins = new OpenLogins();
  const first = viewOf();
  const close = logins.opened(connectorOf('work', 'token-work'), first.view);
  logins.noted('work', 'token-work', { account: { subscriptionType: 'max' }, quotaSnapshots: { session: { remainingPercentage: 40 } } });
  close();

  // A session sends a plan only when it changes, so the reopen is what shows it again.
  const again = viewOf();
  const closeAgain = logins.opened(connectorOf('work', 'token-work'), again.view);
  expect(again.data()).toEqual({ plan: 'max', windows: [{ name: 'Session', left: 40, used: 60 }] });
  closeAgain();

  // A new token may be another account's, so its view starts empty.
  const other = viewOf();
  logins.opened(connectorOf('work', 'token-other'), other.view);
  expect(other.data()).toEqual({ windows: [] });
});

it('keeps the login\'s email off the agent\'s view', () => {
  const logins = new OpenLogins();
  logins.opened(connectorOf('work', 'token-work'));
  const mine = viewOf();
  logins.agentOpened(recordOf('mine', ['work']), mine.view);

  logins.noted('work', 'token-work', { account: { subscriptionType: 'max' }, email: 'som****@example.com' });
  expect(mine.data()).toEqual({ logins: [{ name: 'work', plan: 'max', windows: [] }] });
});

it('reads a record\'s logins as they are now, not as they were when it opened', () => {
  const logins = new OpenLogins();
  logins.opened(connectorOf('work', 'token-work'));
  logins.opened(connectorOf('home', 'token-home'));

  const record = recordOf('mine', ['work']);
  const mine = viewOf();
  logins.agentOpened(record, mine.view);
  expect(mine.data()).toEqual({ logins: [{ name: 'work', windows: [] }] });

  // The channel fills the same view again on an edit, with a new config object.
  (record as { config: Record<string, unknown> }).config = { logins: ['work', 'home'] };
  logins.noted('home', 'token-home', { quotaSnapshots: { weekly: { remainingPercentage: 20 } } });
  expect(mine.data()).toEqual({
    logins: [
      { name: 'work', windows: [] },
      { name: 'home', windows: [{ name: 'Weekly', left: 20, used: 80 }] },
    ],
  });
});
