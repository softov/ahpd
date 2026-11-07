/**
 * `ahpd token`: the tokens a person mints for themselves.
 *
 * A person's full sign-in mints a token limited to what they hold, lists theirs
 * and revokes one by id. Over `/api` the caller is the person the request signed
 * in as; at a terminal the process owner acts for somebody and names them with
 * `--user`. An operator with `user:write` does the same for another person,
 * bounded by that person's grants as `user token` is.
 *
 * `--team` names a team instead of a person. A team key opens the proxy and no
 * other door, so root and a caller who holds `user:write` are the only ones who
 * mint, list or revoke one.
 *
 * A minted token may not mint, list or revoke: it is a credential for one
 * computer, and managing tokens is the full sign-in's business. Every verb here
 * therefore asks the caller's principal, and the one carrying a `token` id is
 * refused with a sentence that says to sign in as yourself.
 */

import { hostname } from 'node:os';
import { output } from '@cofold/commands';
import type { Command, CommandContext, Field, Registry } from '@cofold/commands';
import { HttpError } from '@cofold/remote';
import { checkMeta } from '@ahpd/sdk';
import type { Grant, Measure, Period, PolicyLimit, Principal, Users } from '@ahpd/sdk';
import { personalUrl } from '../config.js';
import { isRoot } from './authorize.js';
import { conflict, serverFields, stop, userAt } from './options.js';
import type { ServedFacts } from './served.js';
import { bounded, idOf, people } from './user.js';

/** What a minted token is told when it asks to manage tokens. */
const MINTED = 'A minted token cannot manage tokens; sign in as yourself.';

/** What a directory that keeps no tokens answers. */
const NO_TOKENS = 'This host keeps no tokens, so there are none to manage.';

/**
 * The three calls, when this directory keeps tokens at all.
 *
 * The port leaves them optional because a directory that is not a file may keep
 * no tokens; this one does, and a host whose directory is not that kind says so
 * rather than failing on a missing method.
 */
const keeping = (directory: Users) => {
  const { mintToken, tokens, revokeToken } = directory;
  if (mintToken === undefined || tokens === undefined || revokeToken === undefined) stop(NO_TOKENS);
  return { mintToken, tokens, revokeToken };
};

/** Who is asking, and whose tokens they are asking about. */
interface Caller {
  /** The principal the request signed in as, when it is served. */
  actor?: Principal;
  /** The person named with `--user`, when one was. */
  named?: string;
  /** The team named with `--team`, when one was. */
  team?: string;
  /** The caller's own id, when the caller is a person rather than the deployment token or a terminal. */
  own?: string;
}

/**
 * The caller, and the first refusal that has nothing to do with a body.
 *
 * A principal carrying a `token` id signed in with a minted token, so it is not
 * the person and may not manage the person's tokens. The deployment token and a
 * terminal have no id of their own, which is why the verbs that need a person
 * ask for `--user` when `own` is absent.
 */
const callerOf = (context: Pick<CommandContext, 'request' | 'optional'>, command: string): Caller => {
  const actor = context.request?.actor as Principal | undefined;
  if (actor?.token !== undefined) throw new HttpError(403, MINTED);
  const named = context.optional<string>('user');
  const team = context.optional<string>('team');
  if (team !== undefined && team !== '' && named !== undefined && named !== '') {
    stop(`token ${command} takes --user or --team, not both.`);
  }
  const own = actor === undefined || isRoot(actor) ? undefined : actor.id;
  return {
    ...(actor === undefined ? {} : { actor }),
    ...(named === undefined || named === '' ? {} : { named }),
    ...(team === undefined || team === '' ? {} : { team }),
    ...(own === undefined ? {} : { own }),
  };
};

/** Whether this caller may act for somebody else: at a terminal, root, or `user:write`. */
const mayManageOthers = (context: Pick<CommandContext, 'surface'>, actor: Principal | undefined): boolean =>
  context.surface === 'cli' || isRoot(actor) || (actor !== undefined && actor.can('user:write'));

/**
 * The refusal for a verb that has to name whose tokens it is about.
 *
 * The return type is on the variable rather than the arrow, as `stop`'s is:
 * with it, a check like `if (target === undefined) needsUser(...)` narrows
 * `target` for every line after.
 */
const needsUser: (command: string) => never = (command) =>
  stop(`token ${command} needs --user <id>: nobody is signed in here for these to be their own.`);

/**
 * The limits a `--limit` wrote, as the objects a token record holds.
 *
 * One value is `<amount>:<measure>:<period>`, split at its two colons. The
 * amount is read here, because a flag has no type; the measure and the period
 * are the record's to check, and a key has one total, so every limit is
 * `shared`. A value that is not three parts, or whose first part is not a
 * number, is refused as one sentence rather than read as a limit.
 */
const limitsOf = (values: readonly string[]): PolicyLimit[] => values.map((text) => {
  const parts = text.split(':');
  const [amount, measure, period] = parts;
  const at = amount === undefined ? Number.NaN : Number(amount);
  if (parts.length !== 3 || amount === undefined || amount === '' || !Number.isFinite(at)
    || measure === undefined || period === undefined) {
    stop(`${text} is not a limit; write one as <amount>:<measure>:<period>, such as 5:usd:day.`);
  }
  return { amount: at, measure: measure as Measure, period: period as Period, pool: 'shared' };
});

/**
 * The meta the `--meta` flags wrote, as one map.
 *
 * Each flag is one entry, `name=value`, cut at its first `=`, so a value may
 * hold anything else; the bounds are `checkMeta`'s, the ones a call's meta is
 * held to. A name written twice is refused rather than kept.
 */
const metaOf = (values: readonly string[]): Record<string, string> => {
  const held = new Map<string, string>();
  for (const text of values) {
    const cut = text.indexOf('=');
    if (cut === -1) stop(`${text} is not a meta entry; write one as name=value.`);
    const name = text.slice(0, cut).trim();
    if (held.has(name)) stop(`${name} is named twice in --meta.`);
    held.set(name, text.slice(cut + 1).trim());
  }
  try {
    return checkMeta(Object.fromEntries(held));
  }
  catch (error) {
    return stop(error instanceof Error ? error.message : String(error));
  }
};

/**
 * Hold a caller changing somebody else's tokens to what `user token` holds them to.
 *
 * `user:write` says a caller manages people; the grants of the person written
 * for are the second bound, or a caller with one grant hands out a person's
 * whole reach under another name. One's own tokens need neither.
 */
const boundFor = async (
  context: Pick<CommandContext, 'request' | 'surface'>,
  directory: Users,
  target: string,
  own: string | undefined,
): Promise<void> => {
  if (target === own) return;
  bounded(context, ['user:write']);
  const held = await directory.grantsOfPerson(target);
  if (held !== undefined) bounded(context, held);
};

/** What `token mint` takes besides the directory: what the token is and what it may do. */
const mintFields = {
  label: {
    type: 'string',
    description: 'What to call it, so a listing can tell one token from another.',
    cli: { value: 'TEXT' },
  },
  grants: {
    type: 'array',
    items: { type: 'string' },
    description: 'A grant to limit it to. Repeatable; without one it holds every grant its person does.',
    cli: { flag: '--grant', value: 'GRANT' },
  },
  expires: {
    type: 'string',
    description: 'When it stops working, as a date such as 2026-12-31 or an ISO timestamp. Without it the token does not expire.',
    cli: { value: 'DATE' },
  },
  scope: {
    type: 'string',
    description: 'The team and project its calls are charged to, written team or team:project, and one the person is in now. A call made with it may name that scope and no other.',
    cli: { value: 'TEAM[:PROJECT]' },
  },
  limits: {
    type: 'array',
    items: { type: 'string' },
    description: 'A spend or call limit, written amount:measure:period such as 5:usd:day. Repeatable; without one the key has no limit of its own.',
    cli: { flag: '--limit', value: 'AMOUNT:MEASURE:PERIOD' },
  },
  meta: {
    type: 'array',
    items: { type: 'string' },
    description: 'A name=value pair the key keeps about itself, such as env=prod. Repeatable; a call made with the key adds its own entries, and the key\'s value wins for the same name.',
    cli: { flag: '--meta', value: 'NAME=VALUE' },
  },
} satisfies Record<string, Field>;

/** Whose tokens a verb is about, when it is not the caller's own. */
const userField = {
  type: 'string',
  description: 'Whose tokens to manage, when it is not your own. Needs user:write, and only grants they hold.',
  cli: { value: 'ID' },
} satisfies Field;

/** The team that holds a key, when it is a team's rather than a person's. */
const teamField = {
  type: 'string',
  description: 'The team that holds the key, instead of a person. Needs user:write, and the key opens the proxy alone.',
  cli: { value: 'TEAM' },
} satisfies Field;

/** The whole URL a client can be given, rather than the bare secret. */
const urlField = {
  type: 'boolean',
  description: 'Print the whole ws:// URL a client can be given.',
} satisfies Field;

export const declareToken = (registry: Registry<object>, served?: ServedFacts): Command[] => {
  /*
   * Where a token is managed. At a terminal the users file is the one the
   * `user` verbs read, and the address is `--host` and `--port` for a URL the
   * daemon was not configured with; served, both are the daemon's own and no
   * field could name another.
   */
  const at = served === undefined ? { ...userAt, host: serverFields.host, port: serverFields.port } : {};

  const mint = registry.action({
    id: 'token.mint',
    summary: 'Mint a token of your own',
    description: 'Limited to grants you hold now, and shown once. --grant once per grant; without one it holds every grant its person does. --limit takes an amount:measure:period such as 5:usd:day, once per limit. --meta takes a name=value pair such as env=prod, once per entry. --expires takes a date such as 2026-12-31. --scope names the team and project its calls are charged to, and a call made with it may name no other. --team mints a team key instead, which needs user:write and opens the proxy alone. --url prints the whole ws:// URL a client can be given.',
    surfaces: { cli: { pattern: ['token', 'mint'] }, http: { method: 'POST', path: '/token/mint' } },
    // A create: the token does not exist yet, so this names no row.
    effect: 'add',
    resource: { kind: 'token' },
    input: { ...at, user: userField, team: teamField, ...mintFields, url: urlField },
    /*
     * No grant of its own: whether this is the caller's own token or another
     * person's is a question about the body, and one's own needs no grant at
     * all. The body asks `user:write` and the person's grants for another's.
     */
    scopes: [],
    run: async (context) => {
      const { where, directory } = people(context, served);
      const { mintToken } = keeping(directory);
      const caller = callerOf(context, 'mint');
      const target = caller.team === undefined ? caller.named ?? caller.own : undefined;
      if (caller.team !== undefined) {
        // A team key opens the proxy alone, so root, or a caller with
        // `user:write` that may call the proxy itself, is the only one that
        // reaches this.
        bounded(context, ['user:write', 'proxy:call']);
      }
      else {
        if (target === undefined) needsUser('mint');
        await boundFor(context, directory, target, caller.own);
      }
      // A team key's URL is the proxy's, and `--url` names a websocket a person
      // signs in on: printing one for a key that door refuses is a lie.
      if (caller.team !== undefined && context.flag('url')) {
        stop('token mint --url names a websocket a person signs in on; a team key opens the proxy alone.');
      }
      const label = context.optional<string>('label');
      const grants = context.list<string>('grants');
      const scope = context.optional<string>('scope');
      const limits = limitsOf(context.list<string>('limits'));
      const meta = metaOf(context.list<string>('meta'));
      const specified = context.optional<string>('expires');
      let expires: number | undefined;
      if (specified !== undefined) {
        const read = Date.parse(specified);
        if (!Number.isFinite(read)) stop(`${specified} is not a date.`);
        expires = read;
      }
      // The directory refuses a grant the person does not hold, a scope they
      // are not in, an expiry in the past, a limit or a meta that is not one,
      // and a mint past the limit; said here
      // so it reads as the verb's own refusal rather than a stack trace.
      const minted = await mintToken(target, {
        ...(caller.team === undefined ? {} : { team: caller.team }),
        ...(label === undefined ? {} : { label }),
        ...(grants.length === 0 ? {} : { grants: grants as Grant[] }),
        ...(expires === undefined ? {} : { expires }),
        ...(scope === undefined ? {} : { scope }),
        ...(limits.length === 0 ? {} : { limits }),
        ...(Object.keys(meta).length === 0 ? {} : { meta }),
      }).catch((error: unknown) => {
        stop(error instanceof Error ? error.message : String(error));
      });
      // The bare secret by default, so it can be piped, and the whole URL when
      // asked for. The warning goes to stderr either way, so stdout stays the
      // credential alone.
      const asUrl = context.flag('url');
      const shown = asUrl ? personalUrl(minted.secret, where.host, where.port, hostname()) : minted.secret;
      context.error(`Shown once. This host keeps only its hash. Revoke it with: ahpd token rm ${minted.id}`);
      return output(minted, `${shown}\n`);
    },
  });

  const list = registry.action({
    id: 'token.list',
    summary: 'The tokens a person holds',
    description: 'Each token\'s id, label, grants, scope, limits, meta, when it was made and when it expires. --team lists a team\'s keys, which needs user:write. A hash and a secret are never answered.',
    surfaces: { cli: { pattern: ['token', 'list'] }, http: { method: 'GET', path: '/token/list' } },
    // No key: this is the listing, and each row carries the `id` `token rm`
    // takes.
    effect: 'read',
    resource: { kind: 'token' },
    input: { ...at, user: userField, team: teamField },
    // No grant of its own: a person reads their own, and another's needs
    // `user:write` and is bounded by what that person holds.
    scopes: [],
    run: async (context) => {
      const { directory } = people(context, served);
      const { tokens } = keeping(directory);
      const caller = callerOf(context, 'list');
      const target = caller.named ?? caller.own;
      let rows;
      if (caller.team !== undefined) {
        bounded(context, ['user:write']);
        rows = (await tokens()).filter((one) => one.team === caller.team);
      }
      else {
        if (caller.named !== undefined) await boundFor(context, directory, caller.named, caller.own);
        /*
         * At a terminal with no --user this lists everybody, because the process
         * owner already reads the file. Served there is no "everybody": the
         * deployment token has no tokens of its own and has to name a person.
         */
        if (target === undefined && served !== undefined) needsUser('list');
        rows = await tokens(target);
      }
      const nothing = caller.team !== undefined
        ? `no tokens for team ${caller.team}\n`
        : target === undefined ? 'no tokens\n' : `no tokens for ${target}\n`;
      const text = rows.length === 0
        ? nothing
        : rows.map((one) => {
          // A team key names its team where a person's line names its person,
          // and its grants are its own rather than its person's.
          const owner = one.team === undefined ? one.user : `team ${one.team}`;
          const team = one.team === undefined ? '' : `  team ${one.team}`;
          const grants = one.grants === undefined
            ? `every grant of ${owner}`
            : one.grants.length === 0 ? 'no grants' : one.grants.join(' ');
          const expiry = one.expires === undefined ? 'no expiry' : `expires ${new Date(one.expires).toISOString()}`;
          const scope = one.scope === undefined ? '' : `  scope ${one.scope}`;
          const meta = one.meta === undefined
            ? ''
            : `  meta ${Object.entries(one.meta).map(([name, value]) => `${name}=${value}`).join(',')}`;
          const limits = (one.limits ?? []).map((limit) => `limit ${limit.amount} ${limit.measure}/${limit.period}`);
          return `${one.id}  ${one.label ?? '(no label)'}${team}  ${grants}${scope}${meta}  created ${new Date(one.created).toISOString()}  ${expiry}${limits.length === 0 ? '' : `  ${limits.join('  ')}`}\n`;
        }).join('');
      return output(rows, text);
    },
  });

  const rm = registry.action({
    id: 'token.rm',
    summary: 'Revoke a token',
    description: 'The token id is what `token list` shows. A token of another person needs --user and user:write, and is bounded by what that person holds. --team removes a team key, which needs user:write.',
    surfaces: { cli: { pattern: ['token', 'rm', ':id'] }, http: { method: 'POST', path: '/token/rm/{id}' } },
    // The token id is what names the row, so the confirm a removal asks for can
    // say which token it is about to take away.
    effect: 'remove',
    resource: { kind: 'token', key: 'id' },
    input: { ...at, user: userField, team: teamField, id: { type: 'string', description: 'The token to revoke, as `token list` answers it.' } },
    // No grant of its own: the token's person decides whether this is the
    // caller's own or another's, and the body asks what the second needs.
    scopes: [],
    run: async (context) => {
      const { directory } = people(context, served);
      const { tokens, revokeToken } = keeping(directory);
      const caller = callerOf(context, 'rm');
      if (caller.team === undefined && caller.named === undefined && caller.own === undefined) needsUser('rm');
      const id = idOf(context, 'token rm');
      const one = (await tokens()).find((each) => each.id === id);
      /*
       * A token of somebody else is "no such token" to a caller who may not
       * manage them, and one an operator named another person or team for is
       * not that owner's either: the answer does not say a token exists that
       * this caller was not asking about.
       */
      if (one === undefined) conflict(`No token called ${id}.`);
      if (one.team !== undefined) {
        if (caller.team !== one.team) conflict(`No token called ${id}.`);
        bounded(context, ['user:write']);
        if (!await revokeToken(id)) conflict(`No token called ${id}.`);
        return output({ id, team: one.team }, `Revoked ${id}, a key of team ${one.team}.\n`);
      }
      // A record names one owner or the other, so a person's key names its
      // person here; the type says otherwise because it cannot see the file.
      if (one.user === undefined) conflict(`No token called ${id}.`);
      if (caller.team !== undefined || (caller.named !== undefined && caller.named !== one.user)) {
        conflict(`No token called ${id}.`);
      }
      if (one.user !== caller.own) {
        if (!mayManageOthers(context, caller.actor)) conflict(`No token called ${id}.`);
        const held = await directory.grantsOfPerson(one.user);
        if (held !== undefined) bounded(context, held);
      }
      if (!await revokeToken(id)) conflict(`No token called ${id}.`);
      return output({ id, user: one.user }, `Revoked ${id}, a token of ${one.user}.\n`);
    },
  });

  return [mint, list, rm];
};
