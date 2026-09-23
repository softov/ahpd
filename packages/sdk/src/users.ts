import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { same } from './listen.js';
import { issuerFrom } from './issuers.js';
import type { Grant, Issuer, Principal, UserFile, UserRecord, Users } from './types/users.js';

/**
 * The user directory, in a file.
 *
 * One record per person: an id, the roles they hold, the hash of their
 * credential and, when it is not this host that vouches for them, the issuer
 * their token comes from. The roles an install defines live in the same file,
 * so a small one writes none at all and the two built-ins answer.
 *
 * The file is read on every call rather than cached, which is what makes
 * `ahpd user rm` take the capability away on the next command instead of the
 * next connection. It is small and the host already touches the disk for a
 * session's flags.
 */

/** The roles every install has without writing one down. */
const BUILT_IN: Record<string, Grant[]> = {
  // Everything, a plugin's scheme included: naming the wildcard is the opt-in
  // a scheme-scoped grant was for.
  admin: ['*:*'],
  // Works on this machine: files, sessions, a shell. No automations.
  member: ['file:read', 'file:write', 'session:read', 'session:write', 'terminal:read', 'terminal:write'],
  // Looks and does not touch: what the sessions and the automations are, and
  // neither a file nor a shell nor a session of their own.
  guest: ['session:read', 'automation:read'],
};

/** The subjects the host itself answers to, beside any plugin's scheme. */
export const SUBJECTS = ['file', 'session', 'automation', 'terminal', 'diagnostics'] as const;

/** `<subject>:<verb>`, with `*` in either position. */
const GRANT = /^[^:\s]+:(?:read|write|\*)$/;

/** Whether a string is a grant a role may hold. */
export const isGrant = (value: string): value is Grant => GRANT.test(value);

/**
 * Whether a set of grants covers one.
 *
 * Exact, or through a wildcard in either position, which is the whole of the
 * matching rule - decision `a-grant-is-a-subject-and-a-verb`.
 */
export const holds = (held: ReadonlySet<string>, grant: Grant): boolean => {
  if (held.has(grant) || held.has('*:*')) return true;
  const at = grant.indexOf(':');
  const subject = grant.slice(0, at);
  const verb = grant.slice(at + 1);
  return held.has(`*:${verb}`) || held.has(`${subject}:*`);
};

/**
 * The record the host advertises for its own sign-in.
 *
 * It is the library's fallback, and a deployment that knows where it is
 * listening names its own through `resource`, which is what the daemon does.
 * RFC 9728 wants a resource identifier that uses the https scheme, so the one
 * here is only what a library with no address to advertise can offer, and the
 * documentation link sits in `resource_documentation` where the format
 * provides for it - decision `a-host-advertises-only-what-is-true`.
 */
export const DEFAULT_RESOURCE = {
  resource: 'ahpd://users',
  resource_name: 'ahpd users',
  resource_documentation: 'https://github.com/softov/ahpd/blob/main/docs/USERS.md',
  /*
   * True, which is also the format's default.
   *
   * The field says whether the agent works without this credential, and with a
   * directory configured it does not: every command but the handshake and
   * `authenticate` answers `-32007` until somebody signs in. `false` would tell
   * a client it may defer the prompt, and the specification says outright that
   * a client may read it to decide exactly that - so it would defer, and then
   * every call would fail.
   */
  required: true,
};

/**
 * The same record under an identifier the deployment answers to.
 *
 * The daemon builds this from the address it listens on, so what a client is
 * told is an https identifier rather than the fallback above. An issuer, when
 * one is configured, is what fills `authorization_servers`: it is a real
 * RFC 8414 identifier, which is the field's one job and the reason it stays
 * empty otherwise - decision `a-host-advertises-only-what-is-true`.
 *
 * More than one is the shape a host with a per-record issuer has: the list is
 * every provider a client may resolve for this host, and the scopes are the
 * union of what those providers want asked for.
 */
export const signInRecord = (
  resource: string,
  ...issuers: Issuer[]
): Record<string, unknown> => {
  const scopes = [...new Set(issuers.flatMap((one) => [...one.scopes]))];
  return {
    ...DEFAULT_RESOURCE,
    resource,
    ...(issuers.length === 0
      ? {}
      : {
        authorization_servers: [...new Set(issuers.map((one) => one.id))],
        ...(scopes.length === 0 ? {} : { scopes_supported: scopes }),
      }),
  };
};

/** What `fileUsers` is given. */
export interface FileUserOptions {
  /**
   * The file.
   *
   * Absent and empty both read as nobody, which is a host with no people in it
   * rather than a broken one. A file that is there and malformed also reads as
   * nobody - a broken file must fail closed - and it refuses to be written
   * over, because the hand that broke it may be the hand that meant to fix it.
   */
  path: string;
  /** The record to advertise, when a deployment needs an id of its own. */
  resource?: Record<string, unknown>;
  /**
   * The authorization server whose tokens this host accepts, for every record
   * that does not name one of its own.
   *
   * A name rather than an `Issuer`, because the file names issuers the same way
   * and both go through one resolver. `github`, or an OpenID Connect issuer URL
   * this host may reach - decision `an-issuer-answers-for-a-subject`. Asked
   * only when no local hash matched, so a deployment that mints secrets keeps
   * working exactly as it does and the issuer is the second way in.
   */
  issuer?: string;
  /**
   * How a record's own `issuer` becomes the server this host asks.
   *
   * Defaults to `issuerFrom`, which knows the `github` preset and an OpenID
   * Connect URL. A test that wants no network passes its own.
   */
  issuerFor?(name: string): Issuer | undefined;
  /**
   * Whether a person's connection token authorizes them, for every record that
   * does not say otherwise.
   *
   * False, which is the whole point: the door admits and says nobody, and
   * `authenticate` is what authorizes - decision `the-door-is-a-door`. A host
   * that trusts its connection tokens says so once here; a record overrides it
   * with its own `trustToken`.
   */
  trustToken?: boolean;
  /** One line for a role a record names and nothing defines. */
  onProblem?(message: string): void;
}

/** The stored form of a secret. Opaque and 256 bits, so a hash is enough. */
const hashOf = (token: string): string =>
  `sha256:${createHash('sha256').update(token, 'utf8').digest('hex')}`;

/** The strings in an array, whatever else found its way in there. */
const strings = (value: unknown): string[] =>
  (Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []);

export function fileUsers(options: FileUserOptions): Users {
  const told = (message: string): void => { options.onProblem?.(message); };
  /** The host's own answer to whether a connection token authorizes somebody. */
  const trustAll = options.trustToken === true;

  /**
   * Said once, however often the file is read.
   *
   * The file is read on every question, so a complaint about its contents
   * belongs in the log once rather than on every command.
   */
  const said = new Set<string>();
  const once = (message: string): void => {
    if (said.has(message)) return;
    said.add(message);
    told(message);
  };

  /**
   * What a name in the file means, built once per name.
   *
   * Discovery is cached inside an `oidcIssuer` and this keeps the adapter
   * itself, so a question per token does not build a new one every time. A
   * name that resolves to nothing is kept as nothing, and said once: a record
   * that names a typo can only ever be reached by a minted secret.
   */
  const adapters = new Map<string, Issuer | undefined>();
  const adapterFor = (name: string): Issuer | undefined => {
    if (adapters.has(name)) return adapters.get(name);
    const built = (options.issuerFor ?? issuerFrom)(name);
    if (built === undefined) {
      once(`issuer ${name} is neither github nor an issuer URL this host may reach`);
    }
    adapters.set(name, built);
    return built;
  };

  /** The server a record signs in through: its own, or the host's default. */
  const issuerNameOf = (record: UserRecord): string | undefined => record.issuer ?? options.issuer;

  /** What the file says, and whether it said nothing because it is broken. */
  const read = (): { file: UserFile; broken: boolean } => {
    let text: string;
    try {
      text = readFileSync(options.path, 'utf8');
    }
    catch {
      return { file: {}, broken: false };
    }
    if (text.trim() === '') return { file: {}, broken: false };
    try {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
      const held = parsed as UserFile;
      const roles: Record<string, Grant[]> = {};
      for (const [name, grants] of Object.entries(held.roles ?? {})) {
        if (!Array.isArray(grants)) continue;
        const kept: Grant[] = [];
        for (const one of strings(grants)) {
          // A grant that is not `<subject>:<verb>` matches nothing, so it is
          // reported and dropped rather than left looking like a permission.
          if (isGrant(one)) kept.push(one);
          else once(`${options.path}: role ${name} names ${one}, which is not <subject>:read, <subject>:write or a *`);
        }
        roles[name] = kept;
      }
      return {
        file: {
          roles,
          users: (Array.isArray(held.users) ? held.users : [])
            .filter((one): one is UserRecord => typeof one === 'object' && one !== null && typeof (one as UserRecord).id === 'string')
            .map((one) => ({
              id: one.id,
              roles: strings(one.roles),
              token: typeof one.token === 'string' ? one.token : '',
              // Both flags are kept rather than dropped, or a file would lose
              // them the next time anything wrote to it.
              ...(typeof one.issuer === 'string' && one.issuer !== '' ? { issuer: one.issuer } : {}),
              ...(typeof one.trustToken === 'boolean' ? { trustToken: one.trustToken } : {}),
            })),
        },
        broken: false,
      };
    }
    catch (error) {
      told(`${options.path} is not a user file (${error instanceof Error ? error.message : String(error)}); nobody can sign in`);
      return { file: {}, broken: true };
    }
  };

  /**
   * Every issuer this directory knows: the host's default and each record's own.
   *
   * The default is included even when no record names it, because the
   * configuration named it and a client may resolve a provider for it. A name
   * that resolves to nothing is left out, having been reported by `adapterFor`.
   */
  const knownIssuers = (): Issuer[] => {
    const { file } = read();
    const names = new Set<string>();
    if (options.issuer !== undefined) names.add(options.issuer);
    for (const record of file.users ?? []) {
      const name = issuerNameOf(record);
      if (name !== undefined) names.add(name);
    }
    const built: Issuer[] = [];
    for (const name of names) {
      const issuer = adapterFor(name);
      if (issuer !== undefined) built.push(issuer);
    }
    return built;
  };

  /**
   * The advertised record, with every provider a client may resolve for it.
   *
   * Asked on every read rather than built once, because the file is where a
   * per-record issuer is written and the file is re-read - the same reason a
   * role is resolved on every command.
   */
  const advertised = (): Record<string, unknown> => {
    const base = options.resource ?? signInRecord(String(DEFAULT_RESOURCE.resource));
    const issuers = knownIssuers();
    if (issuers.length === 0) return base;
    // The base's own fields win, so a deployment's `resource_name` survives;
    // its issuer fields are dropped rather than left to go stale.
    const { authorization_servers: _servers, scopes_supported: _scopes, ...rest } = base;
    return { ...signInRecord(String(base.resource), ...issuers), ...rest };
  };

  /** Replace the file, atomically, refusing to clobber one that will not parse. */
  const write = (file: UserFile): void => {
    if (read().broken) throw new Error(`${options.path} is not a user file; fix it before changing who is in it`);
    mkdirSync(dirname(options.path), { recursive: true });
    const loose = `${options.path}.tmp`;
    // 0600: the file holds hashes rather than secrets, and who may read it is
    // still nobody but the account the daemon runs as.
    writeFileSync(loose, `${JSON.stringify({ roles: file.roles ?? {}, users: file.users ?? [] }, null, 2)}\n`, { mode: 0o600 });
    renameSync(loose, options.path);
  };

  /** The grants one record holds, saying so when a role answered nothing. */
  const grantsOf = (record: UserRecord, file: UserFile, complain = true): Set<string> => {
    const held = new Set<string>();
    for (const role of record.roles) {
      const defined = file.roles?.[role];
      if (defined !== undefined) {
        for (const one of defined) held.add(one);
        continue;
      }
      const built = BUILT_IN[role];
      if (built !== undefined) {
        for (const one of built) held.add(one);
        continue;
      }
      // Said once per record as it is added or read, and not again on every
      // command, which is why the live resolution below passes `false`.
      if (complain) once(`user ${record.id} names role ${role}, which the file does not define and no built-in has`);
    }
    return held;
  };

  /**
   * The person, answered from the file every time the gate asks.
   *
   * The directory re-reads its file on every question, and this keeps that
   * promise past the moment of sign-in: `standing` says whether the record is
   * still there, and `can` resolves the roles it holds *now*. So `ahpd user rm`
   * is refused on the next command rather than the next connection, and a role
   * change is in force at the same point - decision
   * `a-role-is-read-on-every-command`.
   */
  const principalOf = (record: UserRecord): Principal => {
    // Said once, as the record is verified, so a role that nothing defines is
    // in the log even though every command resolves the roles again below -
    // and said only here, because a complaint per command is a log nobody
    // reads.
    grantsOf(record, read().file);
    return {
      id: record.id,
      roles: [...record.roles],
      // The record's own answer, or the host's default. Stamped once, because
      // the door asks once per connection, and the person's answer does not
      // change while their socket is open.
      trusted: record.trustToken ?? trustAll,
      standing: () => (read().file.users ?? []).some((one) => one.id === record.id),
      can: (grant: Grant) => {
        const { file } = read();
        const now = (file.users ?? []).find((one) => one.id === record.id);
        return now === undefined ? false : holds(grantsOf(now, file, false), grant);
      },
    };
  };

  return {
    // A getter rather than a value: the file names the per-record issuers, and
    // an operator who edits it should not have to restart to be believed.
    get resource(): Record<string, unknown> { return advertised(); },

    verify: async (token) => {
      if (token === '') return undefined;
      const { file } = read();
      const hash = hashOf(token);
      // Every record is compared, and the answer is kept rather than returned:
      // which record matched is then not something the clock tells.
      let found: UserRecord | undefined;
      for (const record of file.users ?? []) {
        if (record.token !== '' && same(record.token, hash)) found = record;
      }
      if (found !== undefined) return principalOf(found);
      /*
       * The issuers, only when nothing local matched.
       *
       * A deployment that mints secrets keeps working because this branch is
       * never reached for one, and a record with no hash can only be reached
       * here: the subject an issuer answers with is that record's id, so the
       * file still says who may do what - decision
       * `an-issuer-answers-for-a-subject`.
       *
       * The host's default is asked first, then each issuer a record names, in
       * the order the file lists them, and the first subject that names a
       * record wins. Which provider minted a token is not something the token
       * says, so a host with several issuers shows it to more than one; the
       * order is the whole of what decides which.
       */
      const peopleAt = (name: string): UserRecord[] =>
        (file.users ?? []).filter((one) => issuerNameOf(one) === name);
      const names = [
        ...(options.issuer === undefined ? [] : [options.issuer]),
        ...(file.users ?? []).flatMap((one) => (one.issuer === undefined ? [] : [one.issuer])),
      ];
      for (const name of new Set(names)) {
        const people = peopleAt(name);
        if (people.length === 0) continue;
        const issuer = adapterFor(name);
        if (issuer === undefined) continue;
        const subject = await issuer.subject(token);
        if (subject === undefined || subject === '') continue;
        found = people.find((one) => one.id === subject);
        if (found !== undefined) break;
      }
      return found === undefined ? undefined : principalOf(found);
    },

    list: async () => {
      const { file } = read();
      return (file.users ?? []).map((one) => {
        const issuer = issuerNameOf(one);
        return {
          id: one.id,
          roles: [...one.roles],
          grants: [...grantsOf(one, file, false)] as Grant[],
          // What the record resolved to, so `ahpd user list` can say who the
          // door identifies, who still has to sign in, and where their
          // credential comes from.
          trusted: one.trustToken ?? trustAll,
          ...(issuer === undefined ? {} : { issuer }),
        };
      });
    },

    add: async (id, roles) => {
      const { file, broken } = read();
      /*
       * A role name that resolves to nothing is refused here.
       *
       * A typo used to be accepted and to grant nothing, which looks the same
       * as a person who has no permissions and is only discovered when
       * something is refused. A broken file skips this and is refused by the
       * write below, which is the more useful thing to say about it.
       */
      if (!broken) {
        const unknown = roles.find((role) => file.roles?.[role] === undefined && BUILT_IN[role] === undefined);
        if (unknown !== undefined) {
          const known = [...new Set([...Object.keys(file.roles ?? {}), ...Object.keys(BUILT_IN)])].sort();
          throw new Error(`no role called ${unknown}; this host has ${known.join(', ')}`);
        }
      }
      const users = file.users ?? [];
      const held = users.find((one) => one.id === id);
      if (held === undefined) users.push({ id, roles: [...roles], token: '' });
      else held.roles = [...roles];
      write({ ...file, users });
    },

    remove: async (id) => {
      const { file } = read();
      const users = file.users ?? [];
      const left = users.filter((one) => one.id !== id);
      if (left.length === users.length) return false;
      write({ ...file, users: left });
      return true;
    },

    mint: async (id) => {
      const { file } = read();
      const users = file.users ?? [];
      const held = users.find((one) => one.id === id);
      if (held === undefined) throw new Error(`no user called ${id}`);
      const secret = randomBytes(32).toString('base64url');
      held.token = hashOf(secret);
      write({ ...file, users });
      return secret;
    },
  };
}
