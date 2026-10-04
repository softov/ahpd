import { namesOf, scopeFor } from '../scopes.js';
import { decide } from '../decide.js';
import { idOf } from '../catalog.js';
import type { Scope, ScopeAnswer } from '../scopes.js';
import type { Asked } from '../decide.js';
import type { PolicyKind } from '../types/policies.js';
import type { Principal } from '../types/users.js';
import type { Owner } from '../types/usage.js';
import type { Connection } from '../types/host.js';
import type { Bag } from '../types/common.js';
import type { HostContext } from './context.js';

/** Whose work a session is, what it is charged to, and who may run it. */
export interface Owners {
  charged: Map<string, ScopeAnswer | undefined>;
  ownerFor(connection: Connection): Owner | undefined;
  principals: Map<string, Principal>;
  principalFor(owner: Owner | undefined): Principal | undefined;
  forWhom(owner: Owner | undefined, principal?: Principal): { owner: Owner; principal?: Principal } | undefined;
  senders: Map<string, Owner>;
  senderOf(turn: string): Owner | undefined;
  charge(uri: string, principal: Principal | undefined, named?: string): void;
  checked(
    principal: Principal | undefined,
    scope: Scope | undefined,
    what: { kind: PolicyKind; asked: Asked }[],
  ): Promise<string | undefined>;
  scoping(principal: Principal | undefined): { properties: Bag; defaults: Record<string, string> };
  settle(uri: string, where: string | undefined, config: Record<string, unknown>, principal?: Principal): Promise<void>;
}

export function createOwners(ctx: HostContext): Owners {
  const { options, kept } = ctx;

  /** What each session's work is charged to, refusal included, by session uri. */
  const charged = new Map<string, ScopeAnswer | undefined>();

  /**
   * Whose work a session started on this connection is.
   *
   * A typed reference, the spelling the usage rules use - decision
   * `work-is-owned-by-a-typed-reference`. A person who has signed in owns what
   * they start, and a root connection is the host itself rather than somebody.
   * A host with no users directory has nobody to name at all, so a session
   * there records no owner rather than one that says nothing.
   */
  const ownerFor = (connection: Connection): Owner | undefined => {
    if (options.users === undefined) return undefined;
    if (connection.principal !== undefined) return `user:${connection.principal.id}`;
    return connection.root === true ? `root:${options.hostName ?? 'host'}` : undefined;
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
   * The refusal this work would be given, or nothing when there is none to give.
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
   * A store that cannot be read refuses the work rather than letting it through,
   * because a check that failed open is not a check.
   */
  const checked = async (
    principal: Principal | undefined,
    scope: Scope | undefined,
    what: { kind: PolicyKind; asked: Asked }[],
  ): Promise<string | undefined> => {
    const store = options.policies;
    if (options.policiesCheck !== true || store === undefined || principal === undefined) return undefined;
    for (const one of what) {
      try {
        const decision = await decide(store, principal, scope, one.kind, one.asked);
        if (!decision.allowed) return decision.refusal.message;
      }
      catch (error) {
        return `no policy could be read, so ${one.kind} is refused: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    return undefined;
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
   * What a new session settled on, as this host's half of its config.
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
  const settle = async (
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
    const mine_ = { ...mine.defaults, ...scoped.defaults, ...ctx.mineOf(config) };
    ctx.decided.set(uri, mine_);
    charge(uri, principal, typeof mine_.scope === 'string' ? mine_.scope : undefined);
  };

  return {
    charged, ownerFor, principals, principalFor, forWhom, senders, senderOf,
    charge, checked, scoping, settle,
  };
}