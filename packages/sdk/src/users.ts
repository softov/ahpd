import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { same } from './listen.js';
import type { Grant, Issuer, Principal, UserFile, UserRecord, Users } from './types/users.js';

/**
 * The user directory, in a file.
 *
 * One record per person: an id, the roles they hold and the hash of their
 * credential. The roles an install defines live in the same file, so a small
 * one writes none at all and the two built-ins answer.
 *
 * The file is read on every call rather than cached, which is what makes
 * `ahpd user rm` take the capability away on the next command instead of the
 * next connection. It is small and the host already touches the disk for a
 * session's flags.
 */

/** The roles every install has without writing one down. */
const BUILT_IN: Record<string, Grant[]> = {
  admin: ['read', 'write', 'session', 'terminal', 'automation', 'diagnostics'],
  member: ['read', 'write', 'session', 'terminal'],
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
 */
export const signInRecord = (
  resource: string,
  issuer?: Pick<Issuer, 'id' | 'scopes'>,
): Record<string, unknown> => ({
  ...DEFAULT_RESOURCE,
  resource,
  ...(issuer === undefined
    ? {}
    : {
      authorization_servers: [issuer.id],
      ...(issuer.scopes.length === 0 ? {} : { scopes_supported: [...issuer.scopes] }),
    }),
});

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
   * An authorization server whose tokens this host also accepts.
   *
   * Asked only when no local hash matched, so a deployment that mints secrets
   * keeps working exactly as it does and the issuer is the second way in. Its
   * subject is matched against a record's `id` - decision
   * `an-issuer-answers-for-a-subject`.
   */
  issuer?: Issuer;
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
        if (Array.isArray(grants)) roles[name] = strings(grants) as Grant[];
      }
      return {
        file: {
          roles,
          users: (Array.isArray(held.users) ? held.users : [])
            .filter((one): one is UserRecord => typeof one === 'object' && one !== null && typeof (one as UserRecord).id === 'string')
            .map((one) => ({ id: one.id, roles: strings(one.roles), token: typeof one.token === 'string' ? one.token : '' })),
        },
        broken: false,
      };
    }
    catch (error) {
      told(`${options.path} is not a user file (${error instanceof Error ? error.message : String(error)}); nobody can sign in`);
      return { file: {}, broken: true };
    }
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
  const grantsOf = (record: UserRecord, file: UserFile): Set<string> => {
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
      told(`user ${record.id} names role ${role}, which the file does not define and no built-in has`);
    }
    return held;
  };

  const principalOf = (record: UserRecord, file: UserFile): Principal => {
    const held = grantsOf(record, file);
    return { id: record.id, roles: [...record.roles], can: (grant: Grant) => held.has(grant) };
  };

  return {
    resource: options.resource ?? signInRecord(String(DEFAULT_RESOURCE.resource), options.issuer),

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
      /*
       * The issuer, only when nothing local matched.
       *
       * A deployment that mints secrets keeps working because this branch is
       * never reached for one, and a record with no hash can only be reached
       * here: the subject an issuer answers with is that record's id, so the
       * file still says who may do what - decision
       * `an-issuer-answers-for-a-subject`.
       */
      if (found === undefined && options.issuer !== undefined) {
        const subject = await options.issuer.subject(token);
        if (subject !== undefined && subject !== '') {
          found = (file.users ?? []).find((one) => one.id === subject);
        }
      }
      return found === undefined ? undefined : principalOf(found, file);
    },

    list: async () => (read().file.users ?? []).map((one) => ({ id: one.id, roles: [...one.roles] })),

    add: async (id, roles) => {
      const { file } = read();
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
