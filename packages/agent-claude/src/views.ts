/**
 * What a `claude-login` connector and a Claude agent show on their `main`
 * view, and the data model each view reads.
 *
 * Each open record shows its view once, with the data it has, and sets the
 * data again with `setViewData` when an account answers: the login's own plan,
 * and one entry for each login an agent's record names. A path a view binds
 * that the data does not hold draws nothing, so a login nobody has heard from
 * yet shows no window.
 *
 * A `Text` reads its `text` from the data, and a `List` repeats one row over
 * the items at its path. Inside a repeated row every path is relative, so
 * `name`, `left` and `reset` read the row's own window.
 */

import type { PluginView, QuotaSnapshots } from '@ahpd/sdk';
import type { PlanNote } from './logins.js';

/** One window of a plan, as a row draws it. */
export type WindowData = {
  /** The window's name, as the plan keys it: `Session`, `Weekly: opus`. */
  name: string;
  /** What is left of the window, as a percentage. Absent when the plan gave none. */
  left?: number;
  /** When the window resets, as the ISO time the plan reported. */
  reset?: string;
};

/** What a login draws: the plan its account is on, and one row for each window. */
export type LoginData = {
  /** The plan type, or the provider when the account named no plan type. */
  plan?: string;
  /** One row for each window the account reported. */
  windows: WindowData[];
};

/** One login of an agent, as the agent draws it. */
export type AgentLoginData = LoginData & {
  /** The login's name, which is its connector's id. */
  name: string;
};

/** What a Claude agent draws: one entry for each login its record names. */
export type AgentData = {
  /** The logins the agent may run on now, in the order its record names them. */
  logins: AgentLoginData[];
};

/** The name of a window, as its key spells it: `weekly:opus 4` is `Weekly: opus 4`. */
const nameOf = (key: string): string => {
  const [first = '', ...rest] = key.split(':');
  const head = first.charAt(0).toUpperCase() + first.slice(1);
  return rest.length === 0 ? head : `${head}: ${rest.join(':').replace(/_/g, ' ')}`;
};

/** One row for each window a plan holds. A window with no figure draws no row cell. */
const windowsOf = (snapshots: QuotaSnapshots | undefined): WindowData[] =>
  Object.entries(snapshots ?? {}).map(([key, snapshot]) => ({
    name: nameOf(key),
    ...(snapshot.remainingPercentage === undefined ? {} : { left: snapshot.remainingPercentage }),
    ...(snapshot.resetDate === undefined ? {} : { reset: snapshot.resetDate }),
  }));

/** The plan type a login's account named, or the provider when it named no plan. */
const planOf = (said: PlanNote | undefined): string | undefined =>
  said?.account?.subscriptionType ?? said?.account?.apiProvider;

/** The data a login sends, from the last plan answer its account gave. */
export const loginDataOf = (said: PlanNote | undefined): LoginData => {
  const plan = planOf(said);
  return {
    ...(plan === undefined ? {} : { plan }),
    windows: windowsOf(said?.quotaSnapshots),
  };
};

/** The data an agent sends, from the logins its record names and their last answers. */
export const agentDataOf = (logins: readonly { id: string; said?: PlanNote }[]): AgentData => ({
  logins: logins.map((login) => ({ name: login.id, ...loginDataOf(login.said) })),
});

/**
 * The components one window row draws, under the ids `prefix` names them.
 *
 * A row is the window's name, what is left of it and when it resets, and each
 * cell reads its own item of the list the row is repeated over.
 */
const windowRow = (prefix: string): PluginView['components'] => ({
  [prefix]: { id: prefix, component: 'Row', children: [`${prefix}Name`, `${prefix}Left`, `${prefix}Reset`] },
  [`${prefix}Name`]: { id: `${prefix}Name`, component: 'Text', text: { path: 'name' } },
  [`${prefix}Left`]: { id: `${prefix}Left`, component: 'Text', text: { path: 'left' } },
  [`${prefix}Reset`]: { id: `${prefix}Reset`, component: 'Text', text: { path: 'reset' } },
});

/** A `claude-login` connector's view, with no data: the plan type, then one row for each window. */
export const LOGIN_VIEW: PluginView = {
  root: 'login',
  components: {
    login: { id: 'login', component: 'Column', children: ['plan', 'windows'] },
    plan: { id: 'plan', component: 'Text', text: { path: '/plan' } },
    windows: { id: 'windows', component: 'List', children: { path: '/windows', componentId: 'window' } },
    ...windowRow('window'),
  },
};

/** A Claude agent's view, with no data: a list over the agent's logins, each with its windows. */
export const AGENT_VIEW: PluginView = {
  root: 'logins',
  components: {
    logins: { id: 'logins', component: 'List', children: { path: '/logins', componentId: 'login' } },
    login: { id: 'login', component: 'Column', children: ['loginName', 'loginPlan', 'loginWindows'] },
    loginName: { id: 'loginName', component: 'Text', text: { path: 'name' } },
    loginPlan: { id: 'loginPlan', component: 'Text', text: { path: 'plan' } },
    loginWindows: { id: 'loginWindows', component: 'List', children: { path: 'windows', componentId: 'loginWindow' } },
    ...windowRow('loginWindow'),
  },
};
