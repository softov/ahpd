import { namesOf, scopeFor } from '../usage/scopes.js';
import { chargeFor, countCall } from '../usage/charge.js';
import { decide } from '../access/decide.js';
import { idOf } from '../sessions/catalog.js';
import { zoneOf } from '../usage/periods.js';
import { ownerOfPrincipal } from '../utils/values.js';
import type { Scope, ScopeAnswer } from '../usage/scopes.js';
import type { Asked } from '../access/decide.js';
import type { PolicyKind } from '../types/policies.js';
import type { Principal } from '../types/users.js';
import type { Owner } from '../types/usage.js';
import type { Connection } from '../types/host.js';
import type { Bag } from '../types/common.js';
import type { HostContext } from './context.js';

/**
 * What a check answered: the refusal it gave, or the keys the work is charged
 * under.
 *
 * A caller that did not ask to be charged gets neither, which is the ordinary
 * case for a host with the check off or no store to read.
 */
export interface Checked {
  /** Why the work is refused, when it is. */
  refusal?: string;
  /** The policy keys the work's records carry, when the check charged it. */
  pools?: string[];
}

/** Whose work a session is, what it is charged to, and who may run it. */
export interface Owners {
  charged: Map<string, ScopeAnswer | undefined>;
  ownerFor(connection: Connection): Owner | undefined;
  principals: Map<string, Principal>;
  principalFor(owner: Owner | undefined): Principal | undefined;
  forWhom(owner: Owner | undefined, principal?: Principal): { owner: Owner; principal?: Principal } | undefined;
  senders: Map<string, Owner>;
  senderOf(turn: string): Owner | undefined;
  sentBy: Map<string, Connection>;
  forgetSender(id: string): void;
  forgetSendersIn(chat: Bag): void;
  charge(uri: string, principal: Principal | undefined, named?: string): void;
  checked(
    principal: Principal | undefined,
    scope: Scope | undefined,
    what: { kind: PolicyKind; asked: Asked }[],
    charge?: PolicyKind,
  ): Promise<Checked>;
  keysOf(turn: string): string[] | undefined;
  keepKeys(turn: string, keys: readonly string[]): void;
  forgetKeys(turn: string): void;
  scoping(principal: Principal | undefined): { properties: Bag; defaults: Record<string, string> };
  resolveCreatedSessionConfig(uri: string, where: string | undefined, config: Record<string, unknown>, principal?: Principal): Promise<void>;
}

export function createOwners(ctx: HostContext): Owners {
  const { options, kept, log } = ctx;

  /** The zone the charge walk cuts its periods in, which is the store's own. */
  const zone = zoneOf(options.usageTimezone, log);

  /** What each session's work is charged to, refusal included, by session uri. */
  const charged = new Map<string, ScopeAnswer | undefined>();

  ctx.rootOwner = options.rootOwner ?? 'host';
  /**
   * Whose work a session started on this connection is.
   *
   * A typed reference, the spelling the usage rules use. A person who has signed in owns what
   * they start, a plugin owns what it starts as `plugin:<name>`, and a root
   * connection's is the host itself under the daemon's `rootOwner` `host`, or
   * no one's under `none`, VS Code's. A host with no users directory has nobody
   * to name at all, so a session there records no owner.
   */
  const ownerFor = (connection: Connection): Owner | undefined => {
    if (options.users === undefined) return undefined;
    if (connection.principal !== undefined) return ownerOfPrincipal(connection.principal);
    return connection.root === true && ctx.rootOwner === 'host' ? `root:${options.hostName ?? 'host'}` : undefined;
  };

  /**
   * The principal behind each owner, for as long as this process runs.
   *
   * The owner says whose the work is and outlives a restart; what a scope is
   * resolved against is the memberships behind that name, and the directory
   * answers those afresh every time - so a session whose owner has since moved
   * teams is charged under what they hold now. Keyed by the owner rather than
   * by the session, so one person opening twenty sessions is one entry.
   */
  const principals = new Map<string, Principal>();

  /** The person an owner names, or nothing where this process never met them. */
  const principalFor = (owner: Owner | undefined): Principal | undefined =>
    owner === undefined ? undefined : principals.get(owner);

  /**
   * What a session opened on behalf of an owner is told, and nothing where
   * nobody owns it.
   *
   * The person rides along whenever this host knows them - whoever asked now,
   * or whoever it met before - because that is what a scope change before the
   * first turn is resolved against.
   */
  const forWhom = (owner: Owner | undefined, principal?: Principal): { owner: Owner; principal?: Principal } | undefined => {
    if (owner === undefined) return undefined;
    const person = principal ?? principalFor(owner);
    return { owner, ...(person === undefined ? {} : { principal: person }) };
  };

  /**
   * Who sent each running turn, by the id the host handed it.
   *
   * The same typed reference a session's owner is, and the same connection:
   * a person who asks a question sends the turn, and a turn an automation
   * started is the automation's owner's rather than anybody's (task 03).
   *
   * By turn rather than by session because two people can be talking in one
   * session and only the turn says which of them it was, and it lasts as long
   * as the turn does: a turn that has ended is let go of, and what a session's
   * history needs afterwards is the store's, not this.
   */
  const senders = new Map<string, Owner>();

  /** Who sent this turn, or nobody where this host did not start it. */
  const senderOf = (turn: string): Owner | undefined => senders.get(turn);

  /**
   * The connection each running turn arrived on, by the same turn id.
   *
   * The owner beside it says whose the work is; this says which window asked,
   * and only a window can be asked something back - a folder to trust is asked
   * of the window that sent the turn.
   *
   * Kept and let go of exactly as `senders` is, because it answers the same
   * question about the same span: a turn nobody's window sent - an automation's,
   * a host tool's - has an entry here for nobody, which is the answer and not
   * an absence.
   */
  const sentBy = new Map<string, Connection>();

  /**
   * The policy keys each running turn is charged under, by the turn's id.
   *
   * The check chooses them before the turn's first record is written and is
   * not asked again while it runs, because the cost is not split across rows
   * during a turn. They are kept here rather than with the sender because the
   * meter asks for them when it writes, and let go of when the turn ends.
   */
  const turnKeys = new Map<string, string[]>();

  /** The keys this turn's records carry, or nothing where its check chose none. */
  const keysOf = (turn: string): string[] | undefined => turnKeys.get(turn);

  /** Keep what a turn's check chose, before any of its records is written. */
  const keepKeys = (turn: string, keys: readonly string[]): void => { turnKeys.set(turn, [...keys]); };

  /** Let go of a turn's keys, when it ends or is refused after its check. */
  const forgetKeys = (turn: string): void => { turnKeys.delete(turn); };

  /** Let go of who sent a turn, out of both maps, by its id. */
  const forgetSender = (id: string): void => {
    senders.delete(id);
    sentBy.delete(id);
  };

  /**
   * Let go of the sender of a chat's running turn, for a chat closed with
   * nothing left to end it, because a closed backend sends no turn end. The
   * senders of its pending messages are the queue drain's, let go with the
   * chat's state.
   */
  const forgetSendersIn = (chat: Bag): void => {
    const active = chat.activeTurn as Bag | undefined;
    if (typeof active?.id === 'string') {
      forgetSender(active.id);
      forgetKeys(active.id);
    }
  };

  /**
   * Resolve what a session is charged to and write the answer down.
   *
   * Stored as `null` when a host with people runs it for nobody (a root
   * connection, an automation), so a resumed session is not charged to
   * whoever sends its next turn.
   */
  const charge = (uri: string, principal: Principal | undefined, named?: string): void => {
    const answer = scopeFor(principal, named);
    charged.set(uri, answer);
    const nobody = answer === undefined && principal === undefined && options.users !== undefined;
    kept.setScope(idOf(uri), answer?.scope ?? (nobody ? null : undefined));
  };

  /**
   * The refusal this work would be given, or the keys its records are charged
   * under.
   *
   * Three ways there is nothing, and all three are the ordinary case: the
   * switch is off, there is no store to read, or there is no person behind the
   * work. That last one is what leaves a host with no users directory, a root
   * connection and an automation inert here.
   *
   * The kinds are the caller's because they are not the same twice: a session is
   * checked for its harness and for the machine it asked for, a turn for the
   * harness, the machine and the model it named. Each one is checked in turn and
   * the first refusal is the answer, so what comes back names what refused it.
   *
   * `charge` names the kind whose allowed decision is then walked for room: a
   * turn asks for `agent` and keeps the keys for its records; a session asks
   * for none, so nothing is limited at its creation. The turn's keys are
   * counted in the meter once, after the walk, so a turn is one turn. With no
   * usage store there is nothing to read the walk's totals from, so no key is
   * chosen and nothing is refused on a limit.
   *
   * A store that cannot be read refuses the work rather than letting it through,
   * because a check that failed open is not a check.
   */
  const checked = async (
    principal: Principal | undefined,
    scope: Scope | undefined,
    what: { kind: PolicyKind; asked: Asked }[],
    charge?: PolicyKind,
  ): Promise<Checked> => {
    const store = options.policies;
    if (options.policiesCheck !== true || store === undefined || principal === undefined) return {};
    const usage = options.usage;
    let pools: string[] | undefined;
    for (const one of what) {
      try {
        const decision = await decide(store, principal, scope, one.kind, one.asked);
        if (!decision.allowed) return { refusal: decision.refusal.message };
        if (charge !== one.kind || usage === undefined) continue;
        const walked = await chargeFor(decision, one.kind, principal, scope, usage, {
          zone,
          ...(options.policiesPayOrder === undefined ? {} : { payOrder: options.policiesPayOrder }),
          ...(options.meter === undefined ? {} : { meter: options.meter }),
        });
        if (!walked.allowed) return { refusal: walked.refusal.message };
        pools = [...(pools ?? []), ...walked.pools];
      }
      catch (error) {
        return { refusal: `no policy could be read, so ${one.kind} is refused: ${error instanceof Error ? error.message : String(error)}` };
      }
    }
    if (pools !== undefined) countCall(pools, options.meter);
    return pools === undefined ? {} : { pools };
  };

  /**
   * The `scope` picker, and what it starts on.
   *
   * The choices are the asking person's own memberships, and the default is
   * what naming nothing resolves to. Nothing at all when there is nobody to ask.
   */
  const scoping = (principal: Principal | undefined): { properties: Bag; defaults: Record<string, string> } => {
    const names = principal === undefined ? [] : namesOf(principal);
    const scope = scopeFor(principal)?.scope;
    const spelled = scope === undefined
      ? undefined
      : scope.project === undefined ? scope.team : `${scope.team}:${scope.project}`;
    return {
      properties: names.length === 0
        ? {}
        : {
          scope: {
            type: 'string',
            title: 'Team and project',
            description: 'Which team and project this session charges its work to',
            enum: names,
            enumLabels: names,
            ...(spelled === undefined ? {} : { default: spelled }),
            sessionMutable: false,
          },
        },
      defaults: spelled === undefined ? {} : { scope: spelled },
    };
  };

  /**
   * A new session's config resolved before it exists, as this host's half of
   * it, as VS Code's host resolves a created session's.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L10973
   *
   * The offer is made against the directory that was asked for - the
   * repository, not a worktree's own, which has one branch and is not where
   * the choice is made. The values are the host's defaults under what the
   * client chose: a session created with `{}` still reads back `isolation`
   * and `branch`, the way one does on the reference host, whose
   * `createSession` resolves the whole config rather than echoing the keys
   * it was sent. A window draws its isolation and branch chips from the
   * session's schema once a provisional session exists, and it sends
   * `{ isolation: 'folder' }` or nothing at all.
   */
  const resolveCreatedSessionConfig = async (
    uri: string,
    where: string | undefined,
    config: Record<string, unknown>,
    principal?: Principal,
  ): Promise<void> => {
    const mine = await ctx.isolating(where, typeof config.isolation === 'string' ? config.isolation : undefined);
    const scoped = scoping(principal);
    const properties = (typeof mine.schema.properties === 'object' && mine.schema.properties !== null
      ? mine.schema.properties
      : {}) as Bag;
    ctx.offered.set(uri, { ...mine.schema, properties: { ...properties, ...scoped.properties } });
    const mine_ = { ...mine.defaults, ...scoped.defaults, ...ctx.hostOwnedSessionConfig(config, { ...properties, ...scoped.properties }) };
    ctx.decided.set(uri, mine_);
    charge(uri, principal, typeof mine_.scope === 'string' ? mine_.scope : undefined);
    /*
     * The folder's project, read before the session is first described: it is
     * in the summary the session is announced with, as VS Code's host builds a
     * new session's summary with the project its creation resolved. The rest
     * of the folder's facts are read when a turn ends.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L10662-L10714
     */
    const facts = ctx.options.directories;
    if (where !== undefined && facts?.refreshProject !== undefined && await facts.refreshProject(where).catch(() => false)) ctx.metaChanged(where);
  };

  return {
    charged, ownerFor, principals, principalFor, forWhom, senders, senderOf, sentBy,
    forgetSender, forgetSendersIn, charge, checked, scoping, resolveCreatedSessionConfig,
    keysOf, keepKeys, forgetKeys,
  };
}