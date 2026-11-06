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
  /** Whether extra usage continues once the window is exhausted. Absent when the account has none. */
  extra?: boolean;
  /** The extra usage spent, in credits. */
  extraUsed?: number;
  /** The monthly cap on extra usage, in credits. */
  extraCap?: number;
};

/** What a login's plan draws: the plan type, and one row for each window. */
export type PlanData = {
  /** The plan type the account named. Absent when it named none: the provider is not a plan. */
  plan?: string;
  /** One row for each window the account reported. */
  windows: WindowData[];
};

/** What a login's connector draws: its plan, and the account's email, masked. */
export type LoginData = PlanData & {
  /** The account's email, masked: `so****@brbyte.com`. */
  email?: string;
};

/**
 * One login of an agent, as the agent draws it.
 *
 * Its plan and its name, and no email: the email is on the login's own view,
 * which its connector's readers see.
 */
export type AgentLoginData = PlanData & {
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

/**
 * One row for each window a plan holds. A window with no figure draws no row
 * cell. Extra usage rides the window it is billed beside, as the plan's
 * snapshots carry it.
 */
const windowsOf = (snapshots: QuotaSnapshots | undefined): WindowData[] =>
  Object.entries(snapshots ?? {}).map(([key, snapshot]) => ({
    name: nameOf(key),
    ...(snapshot.remainingPercentage === undefined ? {} : { left: snapshot.remainingPercentage }),
    ...(snapshot.resetDate === undefined ? {} : { reset: snapshot.resetDate }),
    ...(snapshot.overageAllowedWithExhaustedQuota === undefined ? {} : { extra: snapshot.overageAllowedWithExhaustedQuota }),
    ...(snapshot.overage === undefined ? {} : { extraUsed: snapshot.overage }),
    ...(snapshot.overageEntitlement === undefined ? {} : { extraCap: snapshot.overageEntitlement }),
  }));

/** The plan and the windows of a login, from the last plan answer its account gave. */
const planDataOf = (said: PlanNote | undefined): PlanData => {
  const plan = said?.account?.subscriptionType;
  return {
    ...(plan === undefined ? {} : { plan }),
    windows: windowsOf(said?.quotaSnapshots),
  };
};

/** The data a login's connector sends: its plan and its masked email. */
export const loginDataOf = (said: PlanNote | undefined): LoginData => ({
  ...(said?.email === undefined ? {} : { email: said.email }),
  ...planDataOf(said),
});

/** The data an agent sends, from the logins its record names and their last answers. */
export const agentDataOf = (logins: readonly { id: string; said?: PlanNote }[]): AgentData => ({
  logins: logins.map((login) => ({ name: login.id, ...planDataOf(login.said) })),
});

/**
 * The components one window row draws, under the ids `prefix` names them.
 *
 * A row is the window's name, what is left of it, when it resets, and the
 * extra usage spent and its cap; each cell reads its own item of the list the
 * row is repeated over, and a cell whose value the window lacks draws nothing.
 */
const windowRow = (prefix: string): PluginView['components'] => ({
  [prefix]: {
    id: prefix,
    component: 'Row',
    children: [`${prefix}Name`, `${prefix}Left`, `${prefix}Reset`, `${prefix}ExtraUsed`, `${prefix}ExtraCap`],
  },
  [`${prefix}Name`]: { id: `${prefix}Name`, component: 'Text', text: { path: 'name' } },
  [`${prefix}Left`]: { id: `${prefix}Left`, component: 'Text', text: { path: 'left' } },
  [`${prefix}Reset`]: { id: `${prefix}Reset`, component: 'Text', text: { path: 'reset' } },
  [`${prefix}ExtraUsed`]: { id: `${prefix}ExtraUsed`, component: 'Text', text: { path: 'extraUsed' } },
  [`${prefix}ExtraCap`]: { id: `${prefix}ExtraCap`, component: 'Text', text: { path: 'extraCap' } },
});

/** A `claude-login` connector's view, with no data: the masked email, the plan type, then one row for each window. */
export const LOGIN_VIEW: PluginView = {
  root: 'login',
  components: {
    login: { id: 'login', component: 'Column', children: ['email', 'plan', 'windows'] },
    email: { id: 'email', component: 'Text', text: { path: '/email' } },
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
