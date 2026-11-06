/**
 * The Claude logins one load of this plugin keeps open, and the ones resting.
 *
 * A login is a connector of the adapter `claude-login`, holding a token from
 * `claude setup-token`, which signs the CLI in to one Claude account as
 * `CLAUDE_CODE_OAUTH_TOKEN`.
 * https://code.claude.com/docs/en/authentication#generate-a-long-lived-token
 *
 * A turn uses them as the model proxy uses its entries, in
 * `packages/server/src/proxy/listener.ts`: a request that fails with no
 * connection, a 429 or a 5xx goes to the next one, a refused credential is
 * told and tried nowhere else, and a retry time a failure names is the one
 * thing kept between turns.
 */

import type { AgentView, Bag, CallOutcome, Connector, ConnectorAccount, ConnectorOwner, QuotaSnapshots, ViewHandle } from '@ahpd/sdk';
import { sameOwnerOrHost } from '@ahpd/sdk';
import { maskedEmail } from './session/limits.js';
import { AGENT_VIEW, agentDataOf, LOGIN_VIEW, loginDataOf } from './views.js';

/** One call of a login as its connector's health keeps it; the host stamps the time. */
export type CallNote = Omit<CallOutcome, 'at'>;

/** What a login's account said of its plan, as its connector's view shows it. */
export interface PlanNote {
  /** The windows of its plan limits, or an empty map for an account with none. */
  quotaSnapshots?: QuotaSnapshots;
  /** The plan type and the provider. */
  account?: ConnectorAccount;
  /** The account's email, masked: `so****@brbyte.com`. The full email never leaves the host. */
  email?: string;
}

/**
 * The scopes a token that reads its profile has, as the CLI is told them.
 *
 * The CLI takes a `CLAUDE_CODE_OAUTH_TOKEN` as `user:inference` alone unless
 * `CLAUDE_CODE_OAUTH_SCOPES` says more, and then reads no profile and no plan
 * limits. The sign-in asks these, and a token whose profile answers has them.
 */
export const PROFILE_SCOPES = 'user:profile user:inference';

/** What a login's profile says of its account: the email, and the plan type. */
export interface LoginProfile {
  /** The account's email, in full: masked before it reaches a view. */
  email?: string;
  /** The plan type, as the CLI names it: `max`, `pro`, `team` or `enterprise`. */
  plan?: string;
}

/** The adapter whose connectors are Claude logins. */
export const LOGIN_ADAPTER = 'claude-login';

/** One open login: whose it is, and the token the CLI signs in with. */
export interface OpenLogin {
  owner: ConnectorOwner;
  token: string;
}

/** One open agent: the view handle it shows on, and the record it shows. */
interface OpenAgent {
  view: ViewHandle;
  /** The view the engine was handed, which the channel fills again on each edit. */
  record: AgentView;
}

/**
 * The variables of a credential the CLI takes before `CLAUDE_CODE_OAUTH_TOKEN`:
 * a cloud provider's switch, a bearer token, an API key. A CLI that holds one
 * signs in with it whatever token it is handed.
 * https://code.claude.com/docs/en/authentication#authentication-precedence
 */
export const BEFORE_TOKEN = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
] as const;

/**
 * The SDK's kinds of a request that failed with a 429 or a 5xx: the failures
 * the model proxy hands to its next entry, as `docs/server/PROXY.md` says
 * under *When a provider fails*.
 *
 * Each kind is placed by its HTTP status, as the CLI 2.1.301 that the SDK runs
 * gives it and the API's errors page names it: a 429 is `rate_limit`, a 5xx
 * and a 529 are `server_error`, and so is a connection that never arrived,
 * timed out or was lost; `overloaded` is a 529 where the CLI names one. The
 * CLI sends them once its own retries on the same login are spent, each retry
 * saying the status it had, null where no answer came: a server's failure
 * with no answer may have run at the provider and moves to no other login.
 * https://docs.claude.com/en/api/errors
 */
export const FAILOVER: ReadonlySet<string> = new Set(['rate_limit', 'server_error', 'overloaded']);

/**
 * The SDK's kinds of a refused credential: a 401 or a 403, which the proxy
 * tells and sends to no other entry, because a key is the host's own
 * configuration and the answer to it is to sign in again.
 *
 * Each kind is placed by its HTTP status, as the CLI 2.1.301 that the SDK runs
 * gives it and the API's errors page names it. Any 401 or 403 of the API is
 * `authentication_failed`, as the SDK's retry frames name a 401 or a 403 too.
 * A 401 or 403 saying the organization may not use OAuth is
 * `oauth_org_not_allowed`, and a 403 asking for verification is
 * `verification_required`. A `billing_error` is a 402, and an
 * `account_on_hold` can come from a 400 of the token endpoint, or from no
 * answer at all, so each ends a turn as any other error does.
 * https://docs.claude.com/en/api/errors
 */
export const REFUSED: ReadonlySet<string> = new Set([
  'authentication_failed',
  'oauth_org_not_allowed',
  'verification_required',
]);

/**
 * The logins resting now, and until when.
 *
 * A rest is the retry time a failure named, by which a client backs off as it
 * backs off by a `retry-after` the proxy hands back, and nothing else rests a
 * login. Each failure keeps the login out until the time it named, so of two
 * that arrive together the later time holds. In memory: a restart that forgets
 * a rest costs one failure, which names the time again. The clock is a
 * parameter, so a test can move it.
 */
export class Rests {
  private readonly marks = new Map<string, number>();

  /** The clock the rests are read against, in epoch milliseconds. */
  readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Rest a login until `until`, in epoch milliseconds. */
  mark(id: string, until: number): void {
    const held = this.marks.get(id);
    if (held !== undefined && held >= until) return;
    this.marks.set(id, until);
  }

  /** When a login's rest ends, or nothing for a login that is not resting. */
  until(id: string): number | undefined {
    const held = this.marks.get(id);
    if (held === undefined) return undefined;
    if (held <= this.now()) {
      this.marks.delete(id);
      return undefined;
    }
    return held;
  }

  /** Forget a login's rest. */
  clear(id: string): void {
    this.marks.delete(id);
  }
}

/**
 * The open logins of one load of this plugin, by connector id, and the open
 * agents that draw them.
 *
 * A login is a connector of the adapter `claude-login`: one Claude account's
 * token, kept in the host's vault and handed to the adapter's `open` with the
 * secret read back. The adapter keeps it here until the connector closes, so a
 * put that replaces the token, and a remove, reach a session at its next turn.
 * The view handles of the login and of each agent are handed to their `open`
 * too, and an answer an account gives is set on every view that shows it.
 */
export class OpenLogins {
  private readonly open = new Map<string, OpenLogin>();

  /** The view handle of each open login, by connector id. Absent for a connector opened with none. */
  private readonly views = new Map<string, ViewHandle>();

  /** The last plan answer of each login, by connector id, with the token it was for, as its view and its agents show it. */
  private readonly saids = new Map<string, { token: string; said: PlanNote }>();

  /**
   * What each login's profile said, masked, by connector id, with the token it
   * was for. A token whose profile answered reads it, so its sessions are told
   * `PROFILE_SCOPES`.
   */
  private readonly profiles = new Map<string, { token: string; profile: LoginProfile }>();

  /** The view handle and the record of each open agent, by agent id. */
  private readonly agents = new Map<string, OpenAgent>();

  /**
   * The rests of the open logins, by connector id.
   *
   * One for every agent that names a login, because a login's limit is its
   * account's. A login that opens again starts with none: the time was named
   * for the token it held, and a put may have given it another account's.
   */
  readonly rests: Rests;

  /** What a failure of a login calls, with its id and the CLI's words. */
  onFailure: ((id: string, why: string) => void) | undefined;

  /** What a call of a login calls, with its id and how the call went. */
  onCall: ((id: string, outcome: CallNote) => void) | undefined;

  constructor(now: () => number = Date.now) {
    this.rests = new Rests(now);
  }

  /**
   * Keep one connector's token and view handle, as the adapter's `open` is
   * handed them, show its view, and answer the connector's stop, which forgets
   * both.
   *
   * The last plan answer is kept past a stop, with the token it was for. A
   * connector that opens again with the same token shows it again at once: a
   * session sends a plan only when it changes, so nothing else would. A new
   * token may sign in to another account, so it starts with no answer.
   */
  opened(connector: Connector, view?: ViewHandle): () => void {
    const token = connector.config['token'];
    if (typeof token !== 'string' || token === '') throw new Error(`${connector.id} holds no token`);
    this.rests.clear(connector.id);
    this.open.set(connector.id, { owner: connector.owner, token });
    if (this.saids.get(connector.id)?.token !== token) this.saids.delete(connector.id);
    if (this.profiles.get(connector.id)?.token !== token) this.profiles.delete(connector.id);
    if (view === undefined) this.views.delete(connector.id);
    else {
      this.views.set(connector.id, view);
      view.showView({ ...LOGIN_VIEW, dataModel: loginDataOf(this.noteOf(connector.id)) });
    }
    return () => {
      this.open.delete(connector.id);
      this.views.delete(connector.id);
    };
  }

  /**
   * Keep one agent's view handle and record, as the engine's `open` is handed
   * them, and show the agent's view with what the record names now.
   *
   * The record is the one the channel fills again on each edit, so the logins
   * a later answer reads are the ones the record names at that moment rather
   * than the ones it named when it opened.
   */
  agentOpened(record: AgentView, view: ViewHandle | undefined): void {
    if (view === undefined) return;
    this.agents.set(record.id, { view, record });
    view.showView({ ...AGENT_VIEW, dataModel: agentDataOf(this.agentLogins(record)) });
  }

  /** Set one open agent's logins to what its record names now. */
  private showAgent(id: string): void {
    const agent = this.agents.get(id);
    if (agent === undefined) return;
    agent.view.setViewData('/logins', agentDataOf(this.agentLogins(agent.record)).logins);
  }

  /** The logins one agent record names now, each with what its account last said. */
  private agentLogins(record: AgentView): { id: string; said?: PlanNote }[] {
    const values = record.config['logins'];
    const out: { id: string; said?: PlanNote }[] = [];
    for (const one of Array.isArray(values) ? values : []) {
      const id = typeof one === 'string' ? one : '';
      if (id === '' || this.usable(id, record.owner) === undefined) continue;
      if (out.some((login) => login.id === id)) continue;
      const said = this.noteOf(id);
      out.push({ id, ...(said === undefined ? {} : { said }) });
    }
    return out;
  }

  /** The login an open connector holds, or nothing for an id that is not open. */
  held(id: string): OpenLogin | undefined {
    return this.open.get(id);
  }

  /**
   * The token of an open login an agent of this owner may run on: the owner's
   * own, or the host's.
   *
   * The agents channel asks the same of a record when it is put, and a turn
   * asks again: a record read back at a start was never checked, and the rule
   * is the one a session's bindings and an automation's trigger are held to.
   */
  usable(id: string, owner: ConnectorOwner): string | undefined {
    const held = this.open.get(id);
    if (held === undefined) return undefined;
    return sameOwnerOrHost(held.owner, owner === 'host' ? undefined : owner) ? held.token : undefined;
  }

  /**
   * Rest an open login until `until`, for a failure of `token`.
   *
   * A failure of a token the login no longer holds was the old token's, which
   * a put replaced while the CLI still ran on it, and rests nothing.
   */
  rest(id: string, token: string, until: number): void {
    if (this.open.get(id)?.token === token) this.rests.mark(id, until);
  }

  /** Say a failure of a login, which the plugin logs and has the host check. */
  failed(id: string, why: string): void {
    this.onFailure?.(id, why);
  }

  /**
   * Say how one call of an open login went, which the plugin has the host keep
   * in the connector's health, as the model proxy keeps each call of an entry.
   *
   * A call of a token the login no longer holds was the old token's, as a rest
   * for it is, and says nothing of the login.
   */
  called(id: string, token: string, outcome: CallNote): void {
    if (this.open.get(id)?.token === token) this.onCall?.(id, outcome);
  }

  /**
   * Say what an open login's account reported of its plan, which the login's
   * connector shows, and so does each open agent that names the login.
   *
   * A note of a token the login no longer holds says nothing, as a call of it
   * does: the limits belong to the account that token signs in to.
   */
  noted(id: string, token: string, said: PlanNote): void {
    if (this.open.get(id)?.token !== token) return;
    this.saids.set(id, { token, said });
    this.shown(id);
  }

  /**
   * Say what an open login's profile answered, which its connector shows
   * before any session, and which tells its sessions the token reads it.
   *
   * The email is masked here, so the full one stays in this call. A profile of
   * a token the login no longer holds says nothing.
   */
  profiled(id: string, token: string, profile: LoginProfile): void {
    if (this.open.get(id)?.token !== token) return;
    const email = maskedEmail(profile.email);
    this.profiles.set(id, {
      token,
      profile: { ...(email === undefined ? {} : { email }), ...(profile.plan === undefined ? {} : { plan: profile.plan }) },
    });
    this.shown(id);
  }

  /** The scopes an open login's token has, when its profile answered: `PROFILE_SCOPES`. */
  scopesOf(id: string): string | undefined {
    const token = this.open.get(id)?.token;
    return token !== undefined && this.profiles.get(id)?.token === token ? PROFILE_SCOPES : undefined;
  }

  /**
   * What one login's account has said, for the token it holds now: a session's
   * last answer, with the profile's email and plan type where it named none.
   * An answer for a token the login no longer holds is another account's.
   */
  private noteOf(id: string): PlanNote | undefined {
    const token = this.open.get(id)?.token;
    const kept = this.saids.get(id);
    const said = kept !== undefined && kept.token === token ? kept.said : undefined;
    const held = this.profiles.get(id);
    const profile = held !== undefined && held.token === token ? held.profile : undefined;
    if (profile === undefined) return said;
    const plan = said?.account?.subscriptionType ?? profile.plan;
    const email = said?.email ?? profile.email;
    return {
      ...said,
      ...(plan === undefined ? {} : { account: { ...said?.account, subscriptionType: plan } }),
      ...(email === undefined ? {} : { email }),
    };
  }

  /** Set one login's data on its view, and on each open agent that names it. */
  private shown(id: string): void {
    this.views.get(id)?.setViewData('/', loginDataOf(this.noteOf(id)));
    for (const [agentId, agent] of this.agents) {
      if (!this.agentLogins(agent.record).some((login) => login.id === id)) continue;
      this.showAgent(agentId);
    }
  }
}

/** The logins of one agent, as each of its sessions reads them. */
export interface AgentLogins {
  /** The logins this plugin keeps open, by connector id. */
  open: OpenLogins;
  /** Whose agent it is, read at each turn: a login is one this owner may use. */
  owner: () => ConnectorOwner;
}

/** One login: its connector's id, the token the CLI signs in with, and its scopes when known. */
export interface Login {
  id: string;
  token: string;
  /** `PROFILE_SCOPES` when the token's profile answered; absent, the CLI takes `user:inference`. */
  scopes?: string;
}

/**
 * A record's logins, each with its connector's token.
 *
 * The record names each by the id of a `claude-login` connector, and the token
 * is the one that connector holds open. A login whose connector is not open,
 * or is neither the agent owner's nor the host's, is left out, and an id named
 * twice is the first one, so no login is tried twice.
 */
export const loginsOf = (values: Bag, logins: AgentLogins | undefined): Login[] => {
  const out: Login[] = [];
  if (logins === undefined) return out;
  for (const one of Array.isArray(values['logins']) ? values['logins'] : []) {
    const id = typeof one === 'string' ? one : '';
    const token = id === '' ? undefined : logins.open.usable(id, logins.owner());
    if (token === undefined || out.some((login) => login.id === id)) continue;
    const scopes = logins.open.scopesOf(id);
    out.push({ id, token, ...(scopes === undefined ? {} : { scopes }) });
  }
  return out;
};
