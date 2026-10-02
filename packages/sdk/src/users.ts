import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { same } from './listen.js';
import { issuerFrom } from './issuers.js';
import { covers, membership } from './scopes.js';
import type { Grant, Issuer, Named, Principal, UserFile, UserRecord, Users } from './types/users.js';

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

/** A role by name from a table of roles, reading only the table's own keys, so `constructor` names no role. */
const roleIn = (table: Record<string, Grant[]> | undefined, name: string): Grant[] | undefined =>
  table !== undefined && Object.hasOwn(table, name) ? table[name] : undefined;

/** The subjects the host itself answers to, beside any plugin's scheme. */
export const SUBJECTS = ['file', 'session', 'automation', 'terminal', 'diagnostics', 'container', 'config', 'users'] as const;

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

  /** Whether a name is one this directory can resolve, saying nothing. */
  const knows = (name: string): boolean => (options.issuerFor ?? issuerFrom)(name) !== undefined;

  /**
   * One of the file's `teams` or `projects`, kept as it was written.
   *
   * Nothing is dropped from an entry, because the file is written back from
   * what was read and this install's own file is the only one that will ever
   * carry fields this version does not know.
   */
  const entries = (value: unknown): Named[] => (Array.isArray(value) ? value : [])
    .filter((one): one is Named => typeof one === 'object' && one !== null
      && typeof (one as Named).id === 'string' && (one as Named).id !== '');

  /** What an entry list spells, which is what a membership is checked against. */
  const names = (list: Named[]): Set<string> => new Set(list.map((one) => one.id));

  /** What the file's two lists spell, which is what a membership names. */
  const spellingOf = (file: UserFile): { teams: Set<string>; projects: Set<string> } => ({
    teams: names(entries(file.teams)),
    projects: names(entries(file.projects)),
  });

  /**
   * Why a membership names nothing this file holds, and nothing when it does.
   *
   * A team or a project this file does not define is what a check of an
   * existing record reports and a check of a new one refuses - the same
   * reading as a role nothing defines.
   */
  const problemWith = (entry: string, teams: Set<string>, projects: Set<string>): string | undefined => {
    const parsed = membership(entry);
    if (parsed === undefined) return 'is not team, team:* or team:project';
    if (!teams.has(parsed.team)) return `names no team called ${parsed.team}`;
    if (parsed.project !== undefined && parsed.project !== '*' && !projects.has(parsed.project)) {
      return `names no project called ${parsed.project}`;
    }
    return undefined;
  };

  /**
   * The memberships a record holds that mean something, saying why not for each.
   *
   * An entry that names nothing is dropped rather than kept looking like one
   * somebody belongs to, which is the reading a role nothing defines gets.
   */
  const membershipsOf = (record: UserRecord, teams: Set<string>, projects: Set<string>): string[] => {
    const kept: string[] = [];
    for (const entry of strings(record.memberships)) {
      const why = problemWith(entry, teams, projects);
      if (why === undefined) kept.push(entry);
      else once(`${options.path}: user ${record.id} has membership ${entry}, ${why}`);
    }
    return kept;
  };

  /**
   * The membership work that names no scope of its own is charged to.
   *
   * One of their own memberships, covered by the rule `scopeFor` resolves a
   * named scope with, and checked as a place as a membership is: a wildcard is
   * not a place and a project this file does not name is not one anybody works
   * in - decision `a-request-naming-no-scope-uses-the-persons-primary`.
   */
  const primaryOf = (
    record: UserRecord,
    memberships: readonly string[],
    teams: Set<string>,
    projects: Set<string>,
  ): string | undefined => {
    const wanted = record.primary;
    if (typeof wanted !== 'string' || wanted === '') return undefined;
    const why = membership(wanted)?.project === '*' || !covers(memberships, wanted)
      ? 'which is not team or team:project of their own memberships'
      : problemWith(wanted, teams, projects);
    if (why !== undefined) {
      once(`${options.path}: user ${record.id} has primary ${wanted}, ${why}`);
      return undefined;
    }
    return wanted;
  };

  /**
   * What a record holds and where its work lands, said once for each that
   * names nothing.
   *
   * What a person is answered with; the file keeps what it says either way.
   */
  const settledOf = (record: UserRecord, teams: Set<string>, projects: Set<string>): { memberships: string[]; primary?: string } => {
    const memberships = membershipsOf(record, teams, projects);
    const primary = primaryOf(record, memberships, teams, projects);
    return { memberships, ...(primary === undefined ? {} : { primary }) };
  };

  /**
   * One entry with an id, in the order the file lists the others.
   *
   * Naming one that is already there sets its title when one is given, and moves nothing.
   */
  const withEntry = (list: Named[], id: string, title?: string): Named[] => {
    if (!/^[^\s:*]+$/u.test(id)) throw new Error(`${id} cannot name a team or a project: it may not hold a space, a colon or a star`);
    const at = list.findIndex((one) => one.id === id);
    if (at === -1) return [...list, { id, ...(title === undefined ? {} : { title }) }];
    return list.map((one, index) => (index === at && title !== undefined ? { ...one, title } : one));
  };

  /**
   * Who names a team or a project that is being taken out, by membership or by
   * primary, read as written rather than as they resolve.
   *
   * A name the file no longer holds still counts: taking it out would move
   * them on a word said in a log and nowhere else.
   */
  const holders = (file: UserFile, id: string, what: 'team' | 'project'): string[] =>
    (file.users ?? [])
      .filter((one) => [...strings(one.memberships), ...(one.primary === undefined ? [] : [one.primary])].some((held) => {
        const parsed = membership(held);
        return parsed !== undefined && (what === 'team' ? parsed.team === id : parsed.project === id);
      }))
      .map((one) => one.id);

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
      // No prototype, so a role the file names `__proto__` is an own key: on a
      // plain object that assignment would set the table's prototype and the
      // role would resolve to nothing.
      const roles: Record<string, Grant[]> = Object.create(null) as Record<string, Grant[]>;
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
      /*
       * The teams and projects, and what the memberships beside them may name.
       *
       * Read before the records, because a membership naming a team this file
       * does not define is checked against what the file holds. A file with
       * neither key holds no teams and no projects, so every membership in it
       * is reported and none of them is held - which is what a file written
       * before teams existed should say rather than quietly mean something else.
       */
      const teams = entries(held.teams);
      const projects = entries(held.projects);
      const { teams: teamNames, projects: projectNames } = spellingOf(held);
      return {
        file: {
          roles,
          ...(teams.length === 0 ? {} : { teams }),
          ...(projects.length === 0 ? {} : { projects }),
          users: (Array.isArray(held.users) ? held.users : [])
            .filter((one): one is UserRecord => typeof one === 'object' && one !== null && typeof (one as UserRecord).id === 'string')
            .map((one) => {
              const record: UserRecord = {
                id: one.id,
                roles: strings(one.roles),
                token: typeof one.token === 'string' ? one.token : '',
                // Both flags are kept rather than dropped, or a file would lose
                // them the next time anything wrote to it.
                ...(typeof one.issuer === 'string' && one.issuer !== '' ? { issuer: one.issuer } : {}),
                ...(typeof one.rolesFrom === 'string' && one.rolesFrom !== '' ? { rolesFrom: one.rolesFrom } : {}),
                ...(typeof one.trustToken === 'boolean' ? { trustToken: one.trustToken } : {}),
                // And these two, as the file spelled them. Checked below and
                // held as written, because the file is written back from what
                // was read: dropping an entry here would lose a membership
                // naming a team the next `team add` is about to name.
                ...(one.memberships === undefined ? {} : { memberships: strings(one.memberships) }),
                ...(typeof one.primary === 'string' && one.primary !== '' ? { primary: one.primary } : {}),
              };
              settledOf(record, teamNames, projectNames);
              return record;
            }),
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
    writeFileSync(loose, `${JSON.stringify({
      roles: file.roles ?? {},
      // The teams and the projects, as they were read: the file is the whole of
      // the state, and dropping either would lose every membership naming one.
      ...(file.teams === undefined ? {} : { teams: file.teams }),
      ...(file.projects === undefined ? {} : { projects: file.projects }),
      users: file.users ?? [],
    }, null, 2)}\n`, { mode: 0o600 });
    renameSync(loose, options.path);
  };

  /** What a set of role names holds, saying so once per name that answered nothing. */
  const grantsOf = (roles: readonly string[], file: UserFile, complainFor?: string): Set<string> => {
    const held = new Set<string>();
    for (const role of roles) {
      const defined = roleIn(file.roles, role);
      if (defined !== undefined) {
        for (const one of defined) held.add(one);
        continue;
      }
      const built = roleIn(BUILT_IN, role);
      if (built !== undefined) {
        for (const one of built) held.add(one);
        continue;
      }
      // Said once per record as it is added or read, and not again on every
      // command, which is why the live resolution below passes no id.
      if (complainFor !== undefined) once(`user ${complainFor} names role ${role}, which the file does not define and no built-in has`);
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
  const principalOf = (record: UserRecord, fromIssuer: string[] = []): Principal => {
    // Said once, as the record is verified, so a role that nothing defines is
    // in the log even though every command resolves the roles again below -
    // and said only here, because a complaint per command is a log nobody
    // reads.
    grantsOf(record.roles, read().file, record.id);
    /*
     * The claim's roles, resolved once.
     *
     * The token that would ask the issuer again is not kept, so what a claim
     * said is stamped here and the file is what is re-read below: a change at
     * the issuer lands on the next sign-in, and a change in this file lands on
     * the next command.
     */
    const stamped = grantsOf(fromIssuer, read().file);
    /**
     * Their record as it stands now, and what it holds.
     *
     * Empty for somebody who is no longer in the file, which is what
     * `standing` answers separately.
     */
    const holding = (): { memberships: string[]; primary?: string } => {
      const { file } = read();
      const one = (file.users ?? []).find((now) => now.id === record.id);
      if (one === undefined) return { memberships: [] };
      const { teams, projects } = spellingOf(file);
      return settledOf(one, teams, projects);
    };
    return {
      id: record.id,
      roles: [...record.roles, ...fromIssuer],
      // The record's own answer, or the host's default. Stamped once, because
      // the door asks once per connection, and the person's answer does not
      // change while their socket is open.
      trusted: record.trustToken ?? trustAll,
      /*
       * The memberships and the primary, re-read rather than stamped.
       *
       * Not a permission, so nothing here decides whether a command is
       * allowed - but the file is read on every question all the same, and a
       * membership somebody was added to while their socket is open is one
       * their next picker offers.
       */
      get memberships(): readonly string[] { return holding().memberships; },
      get primary(): string | undefined { return holding().primary; },
      // The projects their `team:*` memberships are a choice among, and the
      // teams they are written out of.
      get projects(): readonly Named[] { return read().file.projects ?? []; },
      get teams(): readonly Named[] { return read().file.teams ?? []; },
      standing: () => (read().file.users ?? []).some((one) => one.id === record.id),
      can: (grant: Grant) => {
        const { file } = read();
        const now = (file.users ?? []).find((one) => one.id === record.id);
        if (now === undefined) return false;
        return holds(grantsOf(now.roles, file), grant) || holds(stamped, grant);
      },
    };
  };

  /**
   * The roles an issuer's answer carries in the claim a record names.
   *
   * A value is a role name this file defines or a built-in; one that names
   * nothing is reported once and dropped, the way a role on a record is. An
   * absent claim contributes nothing rather than failing the sign-in, because
   * an issuer that omits a group is answering, not refusing.
   */
  const rolesFromClaim = (record: UserRecord, claims: Record<string, unknown> | undefined): string[] => {
    const claim = record.rolesFrom;
    if (claim === undefined) return [];
    const held = claims?.[claim];
    const values = typeof held === 'string' ? [held] : strings(held);
    if (values.length === 0) return [];
    const { file } = read();
    const defined = new Set([...Object.keys(file.roles ?? {}), ...Object.keys(BUILT_IN)]);
    return values.filter((one) => {
      if (defined.has(one)) return true;
      once(`user ${record.id} has ${claim} ${one}, which names no role this host defines`);
      return false;
    });
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
        const answer = await issuer.who(token);
        if (answer === undefined) continue;
        found = people.find((one) => one.id === answer.subject);
        if (found !== undefined) {
          // The claim is read from the same answer, so a sign-in is one
          // question to the issuer and not two.
          return principalOf(found, rolesFromClaim(found, answer.claims));
        }
      }
      return undefined;
    },

    list: async () => {
      const { file } = read();
      return (file.users ?? []).map((one) => {
        const issuer = issuerNameOf(one);
        return {
          id: one.id,
          roles: [...one.roles],
          grants: [...grantsOf(one.roles, file)] as Grant[],
          // What the record resolved to, so `ahpd user list` can say who the
          // door identifies, who still has to sign in, and where their
          // credential comes from.
          trusted: one.trustToken ?? trustAll,
          ...(issuer === undefined ? {} : { issuer }),
          ...(one.rolesFrom === undefined ? {} : { rolesFrom: one.rolesFrom }),
          // Who their work may be charged to, which is not a permission and is
          // asked beside one rather than through `can`.
          ...(one.memberships === undefined ? {} : { memberships: [...one.memberships] }),
          ...(one.primary === undefined ? {} : { primary: one.primary }),
        };
      });
    },

    grantsOfRoles: async (roles) => {
      const { file } = read();
      return [...grantsOf(roles, file)] as Grant[];
    },

    grantsOfPerson: async (id) => {
      const { file } = read();
      const held = (file.users ?? []).find((one) => one.id === id);
      return held === undefined ? undefined : [...grantsOf(held.roles, file)] as Grant[];
    },

    add: async (id, roles, options) => {
      const issuer = options?.issuer;
      const memberships = options?.memberships;
      const primary = options?.primary;
      const { file, broken } = read();
      const users = file.users ?? [];
      const held = users.find((one) => one.id === id);
      /*
       * A role name that resolves to nothing is refused here.
       *
       * A typo used to be accepted and to grant nothing, which looks the same
       * as a person who has no permissions and is only discovered when
       * something is refused. A role the record already holds is not one this
       * call is giving, so it is not the one refused: a role taken out of the
       * file stays on the records that have it, and refusing everything else
       * would lock them out of the file entirely. A broken file skips this and
       * is refused by the write below, which is the more useful thing to say
       * about it.
       */
      if (!broken) {
        const was = new Set(held?.roles ?? []);
        const unknown = roles.find((role) => !was.has(role)
          && roleIn(file.roles, role) === undefined && roleIn(BUILT_IN, role) === undefined);
        if (unknown !== undefined) {
          const has = [...new Set([...Object.keys(file.roles ?? {}), ...Object.keys(BUILT_IN)])].sort();
          throw new Error(`no role called ${unknown}; this host has ${has.join(', ')}`);
        }
        // A provider nothing can resolve is refused here for the same reason:
        // a record that names one can only ever be reached by a minted secret,
        // which looks like a sign-in that never arrives.
        if (issuer !== undefined && !knows(issuer)) {
          throw new Error(`no issuer called ${issuer}; this host takes github or an issuer URL it may reach`);
        }
        // What the record will hold, so a primary is checked against what it
        // is being set beside. Only what this call names is checked: a
        // membership the file already holds is not being given here, and a
        // team it names that nobody has named yet is the operator's next
        // `team add` rather than a mistake in this verb.
        const { teams: teamNames, projects: projectNames } = spellingOf(file);
        for (const entry of memberships ?? []) {
          const why = problemWith(entry, teamNames, projectNames);
          if (why !== undefined) throw new Error(`membership ${entry} ${why}`);
        }
        if (typeof primary === 'string') {
          // A place before a membership: the read drops a primary naming a team
          // or a project this file does not hold, and a write must not leave
          // the file holding one the next read would drop.
          const why = problemWith(primary, teamNames, projectNames);
          if (why !== undefined) throw new Error(`primary ${primary} ${why}`);
          const wanted = memberships ?? held?.memberships ?? [];
          if (membership(primary)?.project === '*' || !covers(wanted, primary)) {
            throw new Error(`primary ${primary} is not team or team:project of ${id}'s memberships`);
          }
        }
      }
      // Each left alone when the verb names none, the way `issuer` is: setting a
      // role must not quietly move somebody off their team.
      const membershipFields = memberships === undefined ? {} : { memberships: [...memberships] };
      const primaryField = typeof primary === 'string' ? { primary } : {};
      if (held === undefined) users.push({ id, roles: [...roles], token: '', ...(issuer === undefined ? {} : { issuer }), ...membershipFields, ...primaryField });
      else {
        held.roles = [...roles];
        if (issuer !== undefined) held.issuer = issuer;
        Object.assign(held, membershipFields);
        Object.assign(held, primaryField);
        // `null` is how a primary is taken away, which leaving a team is not:
        // that goes with the memberships below.
        if (primary === null) delete held.primary;
        /*
         * A primary the memberships no longer cover goes with them.
         *
         * Left in the file it would be an entry every read drops, and the file
         * would say something nothing reads - so the write that took the
         * membership away takes the primary with it.
         */
        if (memberships !== undefined && held.primary !== undefined && !covers(memberships, held.primary)) {
          delete held.primary;
        }
      }
      write({ ...file, users });
    },

    teams: async () => [...entries(read().file.teams)],

    projects: async () => [...entries(read().file.projects)],

    addTeam: async (id, title) => {
      const { file } = read();
      write({ ...file, teams: withEntry(entries(file.teams), id, title) });
    },

    addProject: async (id, title) => {
      const { file } = read();
      write({ ...file, projects: withEntry(entries(file.projects), id, title) });
    },

    removeTeam: async (id) => {
      const { file } = read();
      const list = entries(file.teams);
      if (!list.some((one) => one.id === id)) return false;
      const who = holders(file, id, 'team');
      if (who.length > 0) throw new Error(`${id} is still a team of ${who.join(', ')}; take them out of it first`);
      write({ ...file, teams: list.filter((one) => one.id !== id) });
      return true;
    },

    removeProject: async (id) => {
      const { file } = read();
      const list = entries(file.projects);
      if (!list.some((one) => one.id === id)) return false;
      const who = holders(file, id, 'project');
      if (who.length > 0) throw new Error(`${id} is still a project of ${who.join(', ')}; take them out of it first`);
      write({ ...file, projects: list.filter((one) => one.id !== id) });
      return true;
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
