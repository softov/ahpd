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
  /** What is used of the window, as a percentage: 100 less `left`, which the gauge draws. */
  used?: number;
  /** When the window resets, as the ISO time the plan reported. */
  reset?: string;
  /** The seconds from when this data was made to `reset`, and nought once it has passed. */
  resetInSeconds?: number;
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
  /** The account's email, masked: `som****@example.com`. */
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
 * One entry for each window a plan holds. A window with no figure draws no
 * share. Extra usage rides the window it is billed beside, as the plan's
 * snapshots carry it, and also follows it as an `Extra usage` entry.
 */
const windowsOf = (snapshots: QuotaSnapshots | undefined, now: number): WindowData[] =>
  Object.entries(snapshots ?? {}).map(([key, snapshot]) => {
    const left = snapshot.remainingPercentage;
    const reset = snapshot.resetDate;
    const resetAt = reset === undefined ? Number.NaN : Date.parse(reset);
    const used = snapshot.overage;
    const cap = snapshot.overageEntitlement;
    return {
      name: nameOf(key),
      ...(left === undefined ? {} : { left, used: 100 - left }),
      ...(reset === undefined ? {} : { reset }),
      ...(Number.isNaN(resetAt) ? {} : { resetInSeconds: Math.max(0, Math.round((resetAt - now) / 1000)) }),
      ...(snapshot.overageAllowedWithExhaustedQuota === undefined ? {} : { extra: snapshot.overageAllowedWithExhaustedQuota }),
      ...(used === undefined ? {} : { extraUsed: used }),
      ...(cap === undefined ? {} : { extraCap: cap }),
    };
  }).flatMap((window) => [window, ...extraOf(window)]);

/**
 * The extra usage a window carries, as a window of its own after it, as the
 * CLI's `/usage` shows it: what is spent of its monthly cap. Nothing when the
 * window carries no spend or no cap.
 */
const extraOf = (window: WindowData): WindowData[] =>
  window.extraUsed === undefined || window.extraCap === undefined || window.extraCap <= 0
    ? []
    : [{ name: 'Extra usage', used: Math.min(100, (window.extraUsed / window.extraCap) * 100) }];

/** The plan and the windows of a login, from the last plan answer its account gave. */
const planDataOf = (said: PlanNote | undefined, now: number): PlanData => {
  const plan = said?.account?.subscriptionType;
  return {
    ...(plan === undefined ? {} : { plan }),
    windows: windowsOf(said?.quotaSnapshots, now),
  };
};

/** The data a login's connector sends: its plan and its masked email, with each reset counted from `now`. */
export const loginDataOf = (said: PlanNote | undefined, now: number = Date.now()): LoginData => ({
  ...(said?.email === undefined ? {} : { email: said.email }),
  ...planDataOf(said, now),
});

/** The data an agent sends, from the logins its record names and their last answers. */
export const agentDataOf = (logins: readonly { id: string; said?: PlanNote }[], now: number = Date.now()): AgentData => ({
  logins: logins.map((login) => ({ name: login.id, ...planDataOf(login.said, now) })),
});

/**
 * The components one window draws, under the ids `prefix` names them.
 *
 * A window is a bar of what is used of it, labelled with its name and its
 * share, with the time it resets in the reader's own zone as its footer. Each
 * reads its own item of the list the window is repeated over, and a value the
 * window lacks draws nothing.
 */
const windowOf = (prefix: string): PluginView['components'] => ({
  [prefix]: {
    id: prefix, component: 'Progress', label: { path: 'name' }, value: { path: 'used' }, max: 100, display: 'percent', child: `${prefix}Reset`,
  },
  [`${prefix}Reset`]: { id: `${prefix}Reset`, component: 'DateTime', label: 'Resets', value: { path: 'reset' }, format: 'auto' },
});

/** One line: a label at its start, and the value at `path` at its end. */
const lineOf = (id: string, label: string, path: string): PluginView['components'] => ({
  [id]: { id, component: 'KeyValue', label, value: { path } },
});

/** A `claude-login` connector's view, with no data: the masked email, the plan type, then a gauge for each window. */
export const LOGIN_VIEW: PluginView = {
  root: 'login',
  components: {
    login: { id: 'login', component: 'Column', children: ['email', 'plan', 'windows'] },
    ...lineOf('email', 'Email', '/email'),
    ...lineOf('plan', 'Plan', '/plan'),
    windows: { id: 'windows', component: 'List', children: { path: '/windows', componentId: 'window' } },
    ...windowOf('window'),
  },
};

/** A Claude agent's view, with no data: a list over the agent's logins, each with its plan and its gauges. */
export const AGENT_VIEW: PluginView = {
  root: 'logins',
  components: {
    logins: { id: 'logins', component: 'List', children: { path: '/logins', componentId: 'login' } },
    login: { id: 'login', component: 'Column', children: ['loginName', 'loginPlan', 'loginWindows'] },
    loginName: { id: 'loginName', component: 'Text', text: { path: 'name' } },
    ...lineOf('loginPlan', 'Plan', 'plan'),
    loginWindows: { id: 'loginWindows', component: 'List', children: { path: 'windows', componentId: 'loginWindow' } },
    ...windowOf('loginWindow'),
  },
};
