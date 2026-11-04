/**
 * The three token commands, by name, for a client on a person's connection.
 *
 * | Command | Params | Answers |
 * | --- | --- | --- |
 * | `x-ahpd/tokens/mint` | `user?`, `team?`, `label?`, `grants?`, `expires?`, `scope?`, `limits?`, `meta?` | the `MintedToken`, with its `secret` |
 * | `x-ahpd/tokens/list` | `user?`, `team?` | the token records, without their hashes |
 * | `x-ahpd/tokens/revoke` | `id`, `user?`, `team?` | `{}` |
 *
 * Each needs `user:write`, and `authorize` lets in a reader without it for
 * their own tokens, as the usage commands do for a reader's own pools. A
 * `team` names a team instead of a person, and needs `user:write`: no reader
 * has a team of their own. The commands of `ahpd token` do the same work with
 * the same checks; `expires` is epoch milliseconds here, which is the unit a
 * token record keeps.
 */

import { refusalReason } from '../host.js';
import { checkMeta } from './meta.js';
import { checkKeyLimits } from './policies.js';
import { INVALID_PARAMS, RpcError } from '../rpc.js';
import type { PluginMethod } from '../types/plugin.js';
import type { PolicyLimit } from '../types/policies.js';
import type { Grant, Principal, TokenRecord, Users } from '../types/users.js';

/** What a minted token is told when it asks to manage tokens. */
const MINTED = 'A minted token cannot manage tokens; sign in as yourself.';

/** What a directory that keeps no tokens answers. */
const NO_TOKENS = 'This host keeps no tokens, so there are none to manage.';

/** A string param, absent as undefined, or a refusal naming the command and the param. */
const option = (command: string, params: Record<string, unknown>, name: string): string | undefined => {
  const value = params[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new RpcError(INVALID_PARAMS, `${command} takes ${name} as a string`);
  return value;
};

/** The grants a token is limited to, or a refusal saying the param is a list of grant strings. */
const grantsParam = (command: string, params: Record<string, unknown>): Grant[] | undefined => {
  const value = params['grants'];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((one) => typeof one !== 'string')) {
    throw new RpcError(INVALID_PARAMS, `${command} takes grants as a list of grant strings`);
  }
  return value as Grant[];
};

/** When the token stops working, as epoch milliseconds; a record keeps the same unit. */
const expiresParam = (command: string, params: Record<string, unknown>): number | undefined => {
  const value = params['expires'];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RpcError(INVALID_PARAMS, `${command} takes expires as epoch milliseconds`);
  }
  return value;
};

/**
 * The spend and call limits a key carries, or a refusal saying the param is a list.
 *
 * Each limit is checked by `checkKeyLimits`, which is the same check the mint
 * and the tokens file make, and its sentence is the one a bad one is refused
 * with: the measures are a `model` row's, the amount is never negative, and the
 * pool is always `shared` - a key has one total, so a limit that names no pool
 * is given one.
 */
const limitsParam = (command: string, params: Record<string, unknown>): PolicyLimit[] | undefined => {
  const value = params['limits'];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new RpcError(INVALID_PARAMS, `${command} takes limits as a list of amount, measure and period`);
  }
  return checkKeyLimits(value);
};

/**
 * The meta a key carries, checked by the bounds the proxy's header is.
 *
 * `checkMeta` is the same check the mint and the tokens file make, and its
 * sentence is the one a bad one is refused with: a name of 1 to 64 characters
 * of `[A-Za-z0-9_.-]`, a value of at most 256 characters with no comma and no
 * line break, and at most 32 entries.
 */
const metaParam = (command: string, params: Record<string, unknown>): Record<string, string> | undefined => {
  const value = params['meta'];
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RpcError(INVALID_PARAMS, `${command} takes meta as an object of names to values`);
  }
  return checkMeta(value);
};

export const tokenMethods = (directory: Users): Record<string, PluginMethod> => {
  /** The three calls, when the directory keeps tokens at all. */
  const keeper = () => {
    const { mintToken, tokens, revokeToken } = directory;
    if (mintToken === undefined || tokens === undefined || revokeToken === undefined) throw new RpcError(-32009, NO_TOKENS);
    return { mintToken, tokens, revokeToken };
  };

  /** The team a command names, refused beside `user` and refused as an empty string. */
  const teamParam = (command: string, params: Record<string, unknown>): string | undefined => {
    const team = option(command, params, 'team');
    if (team !== undefined && team === '') throw new RpcError(INVALID_PARAMS, `${command} takes team as a non-empty string`);
    if (team !== undefined && params['user'] !== undefined) {
      throw new RpcError(INVALID_PARAMS, `${command} takes user or team, not both`);
    }
    return team;
  };

  /**
   * Whose tokens a command is about, or the refusal that takes no body.
   *
   * A principal carrying a `token` id signed in with a minted token, so it is
   * not the person and may not manage the person's tokens. The root connection
   * has no reader and no tokens of its own, so it has to name a person or a
   * team. A team is answered as a team, and no person is defaulted beside it.
   */
  const whose = (
    command: string,
    params: Record<string, unknown>,
    reader: Principal | undefined,
  ): { user?: string; team?: string; own: string | undefined } => {
    if (reader?.token !== undefined) throw new RpcError(-32009, MINTED);
    const team = teamParam(command, params);
    if (team !== undefined) return { team, own: reader?.id };
    const named = option(command, params, 'user');
    const target = named === undefined || named === '' ? reader?.id : named;
    if (target === undefined) throw new RpcError(INVALID_PARAMS, `${command} needs user when nobody is signed in`);
    return { user: target, own: reader?.id };
  };

  /**
   * Another person's tokens need `user:write`, and are bounded by every grant they hold.
   *
   * The root connection is not held to either, as the deployment token is not
   * over `/api`. The `user:write` check repeats the method grant here because
   * `authorize` is asked only of a caller the grant refused: a body reached
   * some other way must still refuse what the gate would have.
   */
  const bound = async (reader: Principal | undefined, target: string, own: string | undefined): Promise<void> => {
    if (reader === undefined || target === own) return;
    if (!reader.can('user:write')) throw new RpcError(-32009, refusalReason(reader.id, 'user:write'));
    const held = await directory.grantsOfPerson(target);
    const missing = (held ?? []).find((grant) => !reader.can(grant));
    if (missing !== undefined) throw new RpcError(-32009, refusalReason(reader.id, missing));
  };

  /**
   * A team's key needs `user:write`, and no reader has a team of their own.
   *
   * The root connection is not held to it, as it is not for another person's
   * key. A team has no grants to be bounded by, and its key opens the proxy, so
   * a reader who mints one must hold `proxy:call` too. Listing and revoking a
   * team's keys give no new credential, and ask `user:write` alone.
   */
  const boundTeam = async (reader: Principal | undefined, minting = false): Promise<void> => {
    if (reader === undefined) return;
    for (const grant of minting ? ['user:write', 'proxy:call'] as const : ['user:write'] as const) {
      if (!reader.can(grant)) throw new RpcError(-32009, refusalReason(reader.id, grant));
    }
  };

  /**
   * A reader's own tokens need no grant; another person's or a team's do.
   *
   * Asked only of a caller the `user:write` grant refuses, so a reader who
   * holds it is never asked and reaches the body's own check. A caller that
   * names a team is refused here, because no reader has a team of their own.
   */
  const authorize: PluginMethod['authorize'] = async (params, reader) => {
    if (reader.token !== undefined) return false;
    if (params['team'] !== undefined) return false;
    const named = params['user'];
    return named === undefined || named === reader.id;
  };

  const mint = 'x-ahpd/tokens/mint';
  const list = 'x-ahpd/tokens/list';
  const revoke = 'x-ahpd/tokens/revoke';

  return {
    [mint]: {
      grant: 'user:write',
      describe: () => ({ title: 'Mint a token', description: 'A token of yours, limited to grants you hold, shown once.' }),
      authorize,
      handle: async (params, reader) => {
        const { mintToken } = keeper();
        const { user, team } = whose(mint, params, reader);
        if (team === undefined && user !== undefined) await bound(reader, user, reader?.id);
        if (team !== undefined) await boundTeam(reader, true);
        const label = option(mint, params, 'label');
        const grants = grantsParam(mint, params);
        const expires = expiresParam(mint, params);
        const scope = option(mint, params, 'scope');
        const limits = limitsParam(mint, params);
        const meta = metaParam(mint, params);
        // The directory refuses a grant the person does not hold, a scope they
        // are not in, an expiry in the past, a limit or a meta that is not one,
        // and a mint past the limit; its sentence is the answer.
        return await mintToken(user, {
          ...(team === undefined ? {} : { team }),
          ...(label === undefined ? {} : { label }),
          ...(grants === undefined ? {} : { grants }),
          ...(expires === undefined ? {} : { expires }),
          ...(scope === undefined ? {} : { scope }),
          ...(limits === undefined ? {} : { limits }),
          ...(meta === undefined ? {} : { meta }),
        }).catch((error: unknown) => {
          throw new RpcError(-32009, error instanceof Error ? error.message : String(error));
        });
      },
    },
    [list]: {
      grant: 'user:write',
      describe: () => ({ title: 'Tokens', description: 'The tokens you hold, without their hashes.' }),
      authorize,
      handle: async (params, reader) => {
        const { tokens } = keeper();
        const { user, team } = whose(list, params, reader);
        if (team !== undefined) {
          await boundTeam(reader);
          return (await tokens()).filter((one) => one.team === team);
        }
        if (user !== undefined) await bound(reader, user, reader?.id);
        return await tokens(user);
      },
    },
    [revoke]: {
      grant: 'user:write',
      describe: () => ({ title: 'Revoke a token', description: 'Take one of your tokens out; the next call with it is refused.' }),
      authorize,
      handle: async (params, reader) => {
        const { tokens, revokeToken } = keeper();
        if (reader?.token !== undefined) throw new RpcError(-32009, MINTED);
        const team = teamParam(revoke, params);
        const named = option(revoke, params, 'user');
        // The token id finds its owner, so a root connection names a person or a
        // team the way it does for the other two rather than removing any token
        // by id.
        if (team === undefined && reader === undefined && (named === undefined || named === '')) {
          throw new RpcError(INVALID_PARAMS, `${revoke} needs user when nobody is signed in`);
        }
        const id = option(revoke, params, 'id');
        if (id === undefined || id === '') throw new RpcError(INVALID_PARAMS, `${revoke} needs id, a token id`);
        const one: Omit<TokenRecord, 'token'> | undefined = (await tokens()).find((each) => each.id === id);
        if (one === undefined) throw new RpcError(-32008, `No token called ${id}.`);
        if (one.team !== undefined) {
          // A team key is another team's to a caller that named none, or one
          // that named a different team.
          if (team !== one.team) throw new RpcError(-32008, `No token called ${id}.`);
          await boundTeam(reader);
        }
        else {
          if (team !== undefined) throw new RpcError(-32008, `No token called ${id}.`);
          if (named !== undefined && named !== '' && named !== one.user) {
            throw new RpcError(-32008, `No token called ${id}.`);
          }
          // Another person's token is missing to a reader who may not manage
          // it, as the terminal's `token rm` answers, so its id is not
          // confirmed.
          if (one.user === undefined) throw new RpcError(-32008, `No token called ${id}.`);
          if (reader !== undefined && one.user !== reader.id && !reader.can('user:write')) {
            throw new RpcError(-32008, `No token called ${id}.`);
          }
          await bound(reader, one.user, reader?.id);
        }
        if (!await revokeToken(id)) throw new RpcError(-32008, `No token called ${id}.`);
        return {};
      },
    },
  };
};
