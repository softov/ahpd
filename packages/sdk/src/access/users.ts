import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, watch as watchPath } from 'node:fs';
import { basename, dirname } from 'node:path';
import { readJson, writeJsonAtomic } from '../utils/jsonfile.js';
import { same } from '../listen.js';
import { issuerFrom, jwtIssuer, sameIssuer } from './issuers.js';
import { checkKeyLimits } from './policies.js';
import { checkMeta } from './meta.js';
import { covers, membership, scopeFor } from '../usage/scopes.js';
import type { PolicyLimit } from '../types/policies.js';
import type { Grant, Issuer, IssuerVerify, MintedToken, Named, Principal, TokenRecord, UserFile, UserRecord, Users } from '../types/users.js';
import { strings } from '../utils/values.js';

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
  // Works on this machine: files, sessions, a shell, the models the proxy
  // serves, and the trust a window answers a folder with. No automations.
  member: ['file:read', 'file:write', 'session:read', 'session:write', 'terminal:read', 'terminal:write', 'proxy:read', 'proxy:write', 'mcp:call', 'trust:write'],
  // Looks and does not touch: what the sessions and the automations are, and
  // neither a file nor a shell nor a session of their own, nor the tools at
  // `/mcp`.
  guest: ['session:read', 'automation:read'],
};

/**
 * How a token is checked, as a configuration or a record spells it.
 *
 * The rule is here because both halves of it are: a record's own `issuerVerify`
 * is read by this directory, and the daemon's `issuerVerify` key is the same
 * three words. Anything else answers nothing, so a caller refuses the start -
 * or, for a record, says so and checks it the way the host says.
 */
export const issuerVerifyOf = (value: unknown): IssuerVerify | undefined =>
  value === 'userinfo' || value === 'jwt' || value === 'auto' ? value : undefined;

/** A role by name from a table of roles, reading only the table's own keys, so `constructor` names no role. */
const roleIn = (table: Record<string, Grant[]> | undefined, name: string): Grant[] | undefined =>
  table !== undefined && Object.hasOwn(table, name) ? table[name] : undefined;

/** The subjects the host itself answers to, beside any plugin's scheme. */
export const SUBJECTS = [
  'session', 'chat', 'file', 'automation', 'terminal', 'diagnostics', 'container', 'config',
  // People, teams, projects and roles, one subject each, so somebody may be let
  // see a team's names without being let see who is on it.
  'user', 'team', 'project', 'role',
  // The hosts that joined this one, which a person may list, add and take away
  // without being let touch the people here.
  'node',
  // What a pool has been charged and the records charged to it, which is a
  // question about cost and is nobody else's by default.
  'usage',
  // Who may use which agent, model and computer, which is a question about what
  // a host allows rather than what it may be told.
  'policy',
  // Calling a model through the proxy (write) and listing the names it serves
  // (read), which spends the host's provider keys.
  'proxy',
  // Running the host's tools from a person's MCP client at `/mcp`, which the
  // gate asks for as `mcp:call`; the write group covers it.
  'mcp',
  // Pushing the host's answer about the folders sessions load their projects
  // from, which a window sends. The gate asks for `trust:push`, and the write
  // group covers it.
  'trust',
  // The account each agent bills to, which the host publishes as a root config
  // value and which the operator's own email is in. Nothing to change: the
  // gate asks for `account:status`, and the read group covers it. Decision
  // `an-agent-account-is-shown-to-account-readers`.
  'account',
] as const;

/** What one subject is, what may be done to it, and which group each act is in. */
export interface SubjectOperations {
  /** What a client shows for the subject. */
  title: string;
  /** What the subject covers, in the advertisement a client draws a role editor from. */
  description: string;
  /** Every operation the subject has, read before write. */
  operations: readonly string[];
  /** The two groups, which name the operations they hold. */
  groups: { read: readonly string[]; write: readonly string[] };
}

/**
 * The operations every resource subject has, which is `file`'s own.
 *
 * A plugin's scheme and the people schemes are all resources, and the same
 * methods carry them, so they share one list rather than each naming its own -
 * `get` is a `resourceRead`, `put` is a `resourceWrite`, and a role that may
 * save a file may not, by that alone, make a computer.
 */
const RESOURCE: SubjectOperations = {
  title: 'Files and resources',
  description: 'Files and other resources on this host.',
  operations: ['get', 'list', 'resolve', 'watch', 'put', 'delete', 'mkdir', 'move', 'copy', 'request'],
  groups: {
    read: ['get', 'list', 'resolve', 'watch'],
    write: ['put', 'delete', 'mkdir', 'move', 'copy', 'request'],
  },
};

/**
 * Every built-in subject, with what may be done to it.
 *
 * A grant names one of these operations, one of the two groups, or `*`. Every
 * operation is in exactly one group, and no subject has an operation called
 * `read` or `write`: those two words are only ever the groups, so `user:read`
 * is the whole of what a role may read and `user:get` is one record.
 *
 * The one act the table does not decide is `computer:write`, which is asked
 * beside `session:create` rather than in place of it: a session naming a source
 * is asking for a machine to be made for it.
 * `computer` is not in the table and reads the resource operations, as every
 * other scheme does.
 */
export const OPERATIONS: Record<string, SubjectOperations> = {
  session: {
    title: 'Sessions',
    description: 'Agent sessions: seeing them, starting them and changing them.',
    operations: [
      'list', 'state',
      'create', 'dispose', 'rename', 'configure', 'folders', 'attach', 'mark', 'review', 'changes', 'worktree', 'artifacts', 'trust',
    ],
    groups: {
      read: ['list', 'state'],
      write: ['create', 'dispose', 'rename', 'configure', 'folders', 'attach', 'mark', 'review', 'changes', 'worktree', 'artifacts', 'trust'],
    },
  },
  chat: {
    title: 'Chats',
    description: 'The conversations inside a session.',
    operations: [
      'turns',
      'create', 'fork', 'dispose', 'move', 'send', 'cancel', 'answer', 'tool', 'draft', 'folders', 'mark', 'truncate',
    ],
    groups: {
      read: ['turns'],
      write: ['create', 'fork', 'dispose', 'move', 'send', 'cancel', 'answer', 'tool', 'draft', 'folders', 'mark', 'truncate'],
    },
  },
  terminal: {
    title: 'Terminals',
    description: 'Shells on this machine.',
    operations: ['output', 'create', 'dispose', 'input', 'resize', 'claim', 'rename', 'clear'],
    groups: {
      read: ['output'],
      write: ['create', 'dispose', 'input', 'resize', 'claim', 'rename', 'clear'],
    },
  },
  automation: {
    title: 'Automations',
    description: 'Agent runs that start on a schedule or a trigger.',
    operations: ['list', 'create', 'update', 'remove', 'run', 'cancel'],
    groups: {
      read: ['list'],
      write: ['create', 'update', 'remove', 'run', 'cancel'],
    },
  },
  file: RESOURCE,
  config: {
    title: 'Host settings',
    description: 'This host\'s settings.',
    operations: ['settings', 'change'],
    groups: { read: ['settings'], write: ['change'] },
  },
  plugin: {
    title: 'Plugins',
    description: 'The plugins the configuration names: listing them, installing, removing and writing them, turning them on and off, and editing their options.',
    /*
     * `install` is an operation of its own and not in either group, so
     * `plugin:write` does not hold it. Installing or removing a plugin runs
     * code with the daemon's permissions, and only a grant that names this
     * operation, `plugin:*` or admin's `*:*` may do it.
     */
    operations: ['list', 'enable', 'disable', 'options', 'install', 'apply', 'reload'],
    groups: { read: ['list'], write: ['enable', 'disable', 'options', 'apply', 'reload'] },
  },
  connector: {
    title: 'Connectors',
    description: 'The adapters plugins register, and the connectors made from them.',
    operations: ['list', 'all', 'put', 'remove', 'host'],
    groups: { read: ['list', 'all'], write: ['put', 'remove', 'host'] },
  },
  agent: {
    title: 'Agents',
    description: 'The engines plugins register, and the agents made from records of them.',
    operations: ['list', 'all', 'put', 'remove', 'host'],
    groups: { read: ['list', 'all'], write: ['put', 'remove', 'host'] },
  },
  diagnostics: {
    title: 'Diagnostics',
    description: 'Logs and network details for troubleshooting.',
    operations: ['logs', 'network', 'fetch'],
    groups: { read: ['logs', 'network', 'fetch'], write: [] },
  },
  container: {
    title: 'Dev containers',
    description: 'Connecting to dev containers.',
    operations: ['connect', 'disconnect', 'relay', 'stop', 'remove'],
    groups: { read: [], write: ['connect', 'disconnect', 'relay', 'stop', 'remove'] },
  },
  node: {
    title: 'Joined hosts',
    description: 'The hosts that joined this one: listing them, adding one and taking one away.',
    operations: ['list', 'add', 'remove'],
    groups: { read: ['list'], write: ['add', 'remove'] },
  },
  // The three subjects the gate asks about through no method: a `workspaceTrust`
  // push on the root config, a model call or a model list on the proxy's
  // `/v1`, and the account the root config carries. None has a scheme of its
  // own, so a client drawing a role editor reads them here or not at all.
  trust: {
    title: 'Workspace trust',
    description: 'The host\'s answer about the folders sessions load project files from, which a window pushes.',
    operations: ['push'],
    groups: { read: [], write: ['push'] },
  },
  proxy: {
    title: 'Model proxy',
    description: 'Calling a model through this host\'s proxy, and listing the names it serves.',
    operations: ['models', 'call'],
    groups: { read: ['models'], write: ['call'] },
  },
  mcp: {
    title: 'MCP gateway',
    description: 'Running the host\'s tools, which need no session, from a person\'s MCP client at /mcp.',
    operations: ['call'],
    groups: { read: [], write: ['call'] },
  },
  // The third of those, and the only one with nothing to write: what the
  // harness says about who it is signed in as, which only the harness can know.
  //
  // Its one operation is `status` rather than `read`, because `read` is the
  // group: a subject with an operation by that name would make `account:read`
  // mean one act and the whole of what a role may read at once.
  account: {
    title: 'Agent accounts',
    description: 'The account each agent\'s harness is signed in as, which this host publishes on the root config.',
    operations: ['status'],
    groups: { read: ['status'], write: [] },
  },
};

/** The two group names, which are operations nowhere and grants everywhere. */
export const GROUPS = ['read', 'write'] as const;

/** What a subject may be done with, which is its own entry or the resource one. */
export const operationsOf = (subject: string): SubjectOperations => OPERATIONS[subject] ?? RESOURCE;

/**
 * Which group an operation is in, or nothing when it is no operation.
 *
 * Nothing for `read` and `write` themselves, which are the groups and not
 * operations, and for any word a subject does not have - a scheme that was not
 * loaded may still be named, and a grant holding one asks for exactly itself.
 */
export const groupOf = (subject: string, operation: string): 'read' | 'write' | undefined => {
  if (operation === 'read' || operation === 'write') return undefined;
  const groups = operationsOf(subject).groups;
  return groups.read.includes(operation) ? 'read' : groups.write.includes(operation) ? 'write' : undefined;
};

/** An operation word on a scheme the table does not decide, which is taken as it is written. */
const SPELLED = /^[a-z][a-zA-Z]*$/;

/**
 * Whether a word is an operation the table does not decide may be named.
 *
 * The word half of `grantProblem`'s rule and not its subject half: a
 * registration names a subject's operations, and whether the subject's own
 * entry has one is the fold's to report, so this says only that the word is
 * spelled like an operation.
 */
export const isOperationWord = (value: unknown): value is string => typeof value === 'string' && SPELLED.test(value);

/**
 * Why a string is not a grant a role may hold, and nothing when it is one.
 *
 * On a subject the table decides, only one of its own operations, one of the
 * two groups or `*` is taken: a role naming anything else would hold a grant
 * that matches nothing and look on every later read like a permission. On any
 * other subject - a plugin's scheme, which may not be loaded when the role is
 * written - any operation word is taken, because the scheme's own list is not
 * here to ask.
 *
 * A refusal names the operations the subject does have, which is the one way a
 * person writing a role learns what they may write instead.
 */
export const grantProblem = (value: string): string | undefined => {
  const at = value.indexOf(':');
  const subject = value.slice(0, at);
  if (at <= 0 || at === value.length - 1 || value.indexOf(':', at + 1) !== -1 || /\s/u.test(subject)) {
    return `${value} is not <subject>:<operation>`;
  }
  const operation = value.slice(at + 1);
  if (operation === '*') return undefined;
  const groups = GROUPS.join(' or ');
  const mine = OPERATIONS[subject];
  if (mine === undefined) {
    return SPELLED.test(operation) || GROUPS.includes(operation as 'read' | 'write')
      ? undefined
      : `${value} is not <subject>:<operation>, ${groups} or a *`;
  }
  if (GROUPS.includes(operation as 'read' | 'write') || mine.operations.includes(operation)) return undefined;
  return `${value} is not one of ${subject}'s operations (${mine.operations.join(', ')}), ${groups} or a *`;
};

/** Whether a string is a grant a role may hold. */
export const isGrant = (value: string): value is Grant => grantProblem(value) === undefined;

/**
 * What a grant written before the split is read as.
 *
 * One `users` subject used to cover people, teams, projects and roles
 * together, and a file saying `users:write` means it said so before the split -
 * so it reads as `user:write` and nothing more, rather than widening to three
 * subjects it never named.
 */
const LEGACY: Record<string, Grant> = { 'users:read': 'user:read', 'users:write': 'user:write' };

/**
 * Whether a set of grants covers one.
 *
 * Exact, or through a wildcard in either position, which is the whole of the
 * matching rule. Beyond that, an operation is held by its group and a chat's
 * groups are the session's.
 *
 * A grant naming a *group* is answered only by that group, a wildcard, or the
 * session's group of the same name for a chat - never by holding each
 * operation in it: `chat:send` does not hold `chat:write`, and the answer
 * cannot widen by being spelled the long way.
 */
export const holds = (held: ReadonlySet<string>, grant: Grant): boolean => {
  if (held.has(grant) || held.has('*:*')) return true;
  const at = grant.indexOf(':');
  const subject = grant.slice(0, at);
  const operation = grant.slice(at + 1);
  /*
   * The group the grant names, whether it spelled an operation in it or the
   * group itself.
   *
   * `groupOf` answers nothing for `read` and `write`, which are the groups
   * rather than operations of any subject - so a grant naming one asks for
   * exactly itself below, and for the session's when the subject is a chat.
   */
  const group = groupOf(subject, operation)
    ?? (GROUPS.includes(operation as 'read' | 'write') ? operation as 'read' | 'write' : undefined);
  if (group !== undefined) {
    if (held.has(`${subject}:${group}`) || held.has(`*:${group}`)) return true;
    // A chat lives in a session, which is what its own groups were before it
    // had a subject: `session:write` is everything `chat:write` is.
    if (subject === 'chat' && held.has(`session:${group}`)) return true;
  }
  return held.has(`*:${operation}`) || held.has(`${subject}:*`);
};

/**
 * The record the host advertises for its own sign-in.
 *
 * It is the library's fallback, and a deployment that knows where it is
 * listening names its own through `resource`, which is what the daemon does.
 * RFC 9728 wants a resource identifier that uses the https scheme, so the one
 * here is only what a library with no address to advertise can offer, and the
 * documentation link sits in `resource_documentation` where the format
 * provides for it.
 */
export const DEFAULT_RESOURCE = {
  resource: 'ahpd://users',
  resource_name: 'ahpd users',
  resource_documentation: 'https://github.com/softov/ahpd/blob/main/docs/sdk/USERS.md',
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
 * empty otherwise.
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
   * this host may reach. Asked
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
   * How a token from an issuer is checked, for every issuer a record does not
   * give a setting of its own.
   *
   * `userinfo` by default, which is what this host has always done and the only
   * way an opaque token can be read. `jwt` and `auto` reach for the key set the
   * issuer publishes, and are what an operator turns on when their provider
   * issues tokens this host can check itself.
   */
  issuerVerify?: IssuerVerify;
  /**
   * The identifier a JWT has to have been issued for, when it is not the one
   * the sign-in record names.
   *
   * A token checked here is refused unless its `aud` holds this, which is what
   * keeps a token minted for another resource - an ID token for a dashboard,
   * a token for a different host - from being a credential here. It defaults to
   * the `resource` of the record this directory advertises, which is the
   * identifier a client was told to get its token for.
   */
  audience?: string;
  /**
   * Whether only a token from a record's issuer signs them in, for every record
   * that does not say otherwise.
   *
   * False, so a record's own token or one they minted names them at the door -
   * decision `a-persons-token-names-them-unless-the-issuer-is-required`. A host
   * whose people must sign in through its company provider says so once here;
   * a record overrides it with its own `requireIssuer`.
   */
  requireIssuer?: boolean;
  /**
   * How many tokens one person may mint for themselves.
   *
   * Ten unless a host says otherwise. A token that has expired does not count,
   * so an old one does not hold a place. Zero lets nobody mint one.
   */
  tokensPerPerson?: number;
  /**
   * The file the tokens are kept in.
   *
   * The users file with `.json` taken off and `.tokens.json` put on it, in the
   * same folder: `users.json` beside `users.tokens.json`. The people and their
   * tokens are separate files so a mint does not rewrite the users file and a
   * change to who somebody is lands without touching their tokens.
   */
  tokensPath?: string;
  /** One line for a role a record names and nothing defines. */
  onProblem?(message: string): void;
}

/**
 * The stored form of a secret.
 *
 * SHA-256, with no salt and no stretching, because a token is a long random
 * string rather than a word a person chose: there is nothing to guess, so a
 * password hash buys nothing here. A token this host mints is 256 opaque bits,
 * and only its hash is kept.
 */
const hashOf = (token: string): string =>
  `sha256:${createHash('sha256').update(token, 'utf8').digest('hex')}`;

export function fileUsers(options: FileUserOptions): Users {
  const told = (message: string): void => { options.onProblem?.(message); };
  /** The host's own answer to whether a local token only opens the socket. */
  const hostRequiresIssuer = options.requireIssuer === true;

  /** Where the tokens live: the users file with its extension changed. */
  const tokensFile = options.tokensPath
    ?? `${options.path.endsWith('.json') ? options.path.slice(0, -'.json'.length) : options.path}.tokens.json`;

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

  /**
   * Whether only a token from the record's issuer signs them in.
   *
   * The record's own answer over the host's, and off when neither names one.
   */
  const requiresIssuer = (record: UserRecord): boolean => record.requireIssuer ?? hostRequiresIssuer;

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
   * in.
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
   * A name a record or a membership could be written with.
   *
   * No space, no colon and no star: a membership is spelled around a colon, so
   * a name holding one cannot be told from the grammar beside it.
   */
  const SPELLABLE = /^[^\s:*]+$/u;

  /**
   * One entry with an id, in the order the file lists the others.
   *
   * Naming one that is already there sets its title when one is given, and moves nothing.
   */
  const withEntry = (list: Named[], id: string, title?: string): Named[] => {
    if (!SPELLABLE.test(id)) throw new Error(`${id} cannot name a team or a project: it may not hold a space, a colon or a star`);
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
    const outcome = readJson(options.path);
    /*
     * Not there, or there and unopenable, is nobody: a host that has never been
     * set up, and a path the directory's own account cannot open. Neither is a
     * broken file, which is what says a change may still be written over it.
     */
    if (!outcome.ok && outcome.kind !== 'not-json') return { file: {}, broken: false };
    if (!outcome.ok) {
      /*
       * An empty file is a user file nobody has written to yet, and the reader
       * answers it as it answers one that will not parse - `JSON.parse` refuses
       * both the same way, and emptiness is not one of its outcomes. So the
       * file itself is looked at here before the refusal below.
       */
      let text = '';
      try { text = readFileSync(options.path, 'utf8'); }
      catch { /* it went between the two reads, which leaves nobody */ }
      if (text.trim() === '') return { file: {}, broken: false };
      told(`${options.path} is not a user file (${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}); nobody can sign in`);
      return { file: {}, broken: true };
    }
    try {
      const parsed = outcome.value;
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
          /*
           * A grant written before the split, read as the one subject it did
           * name, and said once per role: a role that edited teams through
           * `users:write` loses that here, and an operator who never reads the
           * log would have a daemon that quietly answers `-32009` instead.
           */
          const legacy = LEGACY[one];
          if (legacy !== undefined) {
            kept.push(legacy);
            once(`${options.path}: role ${name} holds ${one}, which this host reads as ${legacy}; teams, projects and roles need a grant of their own`);
            continue;
          }
          // A grant that is not `<subject>:<operation>` matches nothing, so it
          // is reported and dropped rather than left looking like a permission.
          const why = grantProblem(one);
          if (why === undefined) kept.push(one as Grant);
          else once(`${options.path}: role ${name} ${why}`);
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
              /*
               * The record's own way of checking its issuer, read the way the
               * read reads everything: a value this host does not have is said
               * once and dropped rather than taken for the default, because an
               * operator whose `jwt` was misspelled would otherwise be told
               * nothing while every token of theirs went to the endpoint.
               */
              const verify = issuerVerifyOf(one.issuerVerify);
              if (one.issuerVerify !== undefined && verify === undefined) {
                once(`${options.path}: user ${one.id} names issuerVerify ${JSON.stringify(one.issuerVerify)}, which this host does not have; it is checked the default way`);
              }
              /*
               * The company sign-in, read as a switch. A value that is not one
               * is said once and dropped rather than taken for the answer
               * beside it, the way `issuerVerify` is.
               */
              if (one.requireIssuer !== undefined && typeof one.requireIssuer !== 'boolean') {
                once(`${options.path}: user ${one.id} names requireIssuer ${JSON.stringify(one.requireIssuer)}, which is not true or false; the host's answer applies`);
              }
              const legacyTrust = (one as { trustToken?: unknown }).trustToken;
              if (legacyTrust !== undefined) {
                once(`${options.path}: user ${one.id} sets trustToken, which this host no longer reads; a local token names them at the door`);
              }
              const record: UserRecord = {
                id: one.id,
                roles: strings(one.roles),
                token: typeof one.token === 'string' ? one.token : '',
                // These are kept rather than dropped, or a file would lose
                // them the next time anything wrote to it.
                ...(typeof one.issuer === 'string' && one.issuer !== '' ? { issuer: one.issuer } : {}),
                ...(typeof one.rolesFrom === 'string' && one.rolesFrom !== '' ? { rolesFrom: one.rolesFrom } : {}),
                ...(verify === undefined ? {} : { issuerVerify: verify }),
                ...(typeof one.requireIssuer === 'boolean' ? { requireIssuer: one.requireIssuer } : {}),
                // And these two, as the file spelled them. Checked below and
                // held as written, because the file is written back from what
                // was read: dropping an entry here would lose a membership
                // naming a team the next `team add` is about to name.
                ...(one.memberships === undefined ? {} : { memberships: strings(one.memberships) }),
                ...(typeof one.primary === 'string' && one.primary !== '' ? { primary: one.primary } : {}),
              };
              settledOf(record, teamNames, projectNames);
              /*
               * Nobody can sign in, and the log says why.
               *
               * The record asks for the issuer and neither it nor the host
               * names one, so the local token opens the socket and names
               * nobody, and `authenticate` refuses it too.
               */
              if (requiresIssuer(record) && issuerNameOf(record) === undefined) {
                once(`${options.path}: user ${one.id} requires the issuer and no issuer is named, so nothing can sign them in`);
              }
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

  /**
   * The identifier a token checked here has to have been issued for.
   *
   * The `resource` of the record this directory advertises, which is the
   * identifier a client was told to acquire its token for: a token the same
   * issuer minted for another resource is a token for that resource and not a
   * credential here.
   */
  const audience = (): string =>
    options.audience ?? String((options.resource ?? DEFAULT_RESOURCE)['resource'] ?? DEFAULT_RESOURCE.resource);

  /**
   * One call to `onChange` for each open `watch`, held back until the changes
   * stop for `SETTLE` milliseconds.
   *
   * A write is a temporary file and a rename, and an editor saves in steps of
   * its own, so one change is several file events.
   */
  const SETTLE = 100;
  const pokes = new Set<() => void>();

  /** Replace the file, atomically, refusing to clobber one that will not parse. */
  const write = (file: UserFile): void => {
    if (read().broken) throw new Error(`${options.path} is not a user file; fix it before changing who is in it`);
    // Owner-only: the file holds hashes rather than secrets, and who may read
    // it is still nobody but the account the daemon runs as.
    writeJsonAtomic(options.path, {
      roles: file.roles ?? {},
      // The teams and the projects, as they were read: the file is the whole of
      // the state, and dropping either would lose every membership naming one.
      ...(file.teams === undefined ? {} : { teams: file.teams }),
      ...(file.projects === undefined ? {} : { projects: file.projects }),
      users: file.users ?? [],
    });
    // A watcher may miss its own folder's events, or have none at all, so
    // a write this directory made is a change it says itself.
    for (const poke of pokes) poke();
  };

  /**
   * What the tokens file says, and whether it said nothing because it is broken.
   *
   * A file that is not there is a host where nobody has minted a token yet.
   * Anything else that will not parse is no tokens at all - fail closed - said
   * once, and refused a write so the hand that broke it may fix it. Empty is
   * not a broken file: like an empty users file, it is one nothing has been
   * written to, and a write may fill it.
   */
  const readTokens = (): { tokens: TokenRecord[]; broken: boolean } => {
    const outcome = readJson(tokensFile);
    if (!outcome.ok && outcome.kind !== 'not-json') return { tokens: [], broken: false };
    if (!outcome.ok) {
      let text = '';
      try { text = readFileSync(tokensFile, 'utf8'); }
      catch { /* it went between the two reads, which leaves no tokens */ }
      if (text.trim() === '') return { tokens: [], broken: false };
      once(`${tokensFile} is not a tokens file (${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}); no token can sign in`);
      return { tokens: [], broken: true };
    }
    try {
      const parsed = outcome.value;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
      const held = (parsed as { tokens?: unknown }).tokens;
      // A file holding no `tokens` key is one with nothing in it yet, which is
      // where a host starts rather than a file to refuse.
      if (held === undefined) return { tokens: [], broken: false };
      if (!Array.isArray(held)) throw new Error('tokens is not a list');
      const tokens = held.map((one): TokenRecord => {
        if (typeof one !== 'object' || one === null || Array.isArray(one)) throw new Error('a token is not an object');
        const entry = one as Partial<TokenRecord>;
        if (typeof entry.id !== 'string' || entry.id === '') throw new Error('a token has no id');
        // Exactly one of the two: a person's key names the person, and a team's
        // key names the team. Two answers or none are a file to fix, not one to
        // read with the wrong half dropped.
        if ((entry.user === undefined) === (entry.team === undefined)) {
          throw new Error(`token ${entry.id} names ${entry.user === undefined ? 'no user and no team' : 'both a user and a team'}`);
        }
        if (entry.user !== undefined && (typeof entry.user !== 'string' || entry.user === '')) {
          throw new Error(`token ${entry.id} names no user`);
        }
        if (entry.team !== undefined && (typeof entry.team !== 'string' || entry.team === '')) {
          throw new Error(`token ${entry.id} names no team`);
        }
        if (typeof entry.token !== 'string' || entry.token === '') throw new Error(`token ${entry.id} holds no hash`);
        if (typeof entry.created !== 'number' || !Number.isFinite(entry.created)) throw new Error(`token ${entry.id} has no created time`);
        if (entry.label !== undefined && typeof entry.label !== 'string') throw new Error(`token ${entry.id} has a label that is not a string`);
        if (entry.expires !== undefined && (typeof entry.expires !== 'number' || !Number.isFinite(entry.expires))) {
          throw new Error(`token ${entry.id} has an expires that is not a time`);
        }
        if (entry.grants !== undefined) {
          if (!Array.isArray(entry.grants)
            || entry.grants.some((grant) => typeof grant !== 'string' || grantProblem(grant as Grant) !== undefined)) {
            throw new Error(`token ${entry.id} holds a grant that is not one`);
          }
        }
        // A scope is a place to charge, not a membership: `team:*` says any of
        // that team's projects and is never a scope a call resolves to.
        if (entry.scope !== undefined) {
          const parsed = typeof entry.scope === 'string' ? membership(entry.scope) : undefined;
          if (parsed === undefined || parsed.project === '*') {
            throw new Error(`token ${entry.id} has a scope that is not team or team:project`);
          }
        }
        /*
         * The limits, read the way the mint checks them.
         *
         * A file holding a limit no key may have - a measure a model row does
         * not count, a pool of `each`, a negative amount - is a file this host
         * will not sign anybody in from, and it is reported as broken rather
         * than read with the limit dropped.
         */
        let limits: PolicyLimit[] | undefined;
        if (entry.limits !== undefined) {
          try { limits = checkKeyLimits(entry.limits); }
          catch (error) {
            throw new Error(`token ${entry.id} holds limits that are not ones: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        /*
         * The meta, read by the check the mint and the proxy header make.
         *
         * A file holding a name or a value no key may hold is one this host
         * will not sign anybody in from, and it is reported as broken rather
         * than read with the entry dropped.
         */
        let meta: Record<string, string> | undefined;
        if (entry.meta !== undefined) {
          try { meta = checkMeta(entry.meta); }
          catch (error) {
            throw new Error(`token ${entry.id} holds a meta that is not one: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        return {
          id: entry.id,
          ...(entry.user === undefined ? {} : { user: entry.user }),
          ...(entry.team === undefined ? {} : { team: entry.team }),
          ...(entry.label === undefined ? {} : { label: entry.label }),
          ...(entry.grants === undefined ? {} : { grants: [...entry.grants] as Grant[] }),
          ...(entry.scope === undefined ? {} : { scope: entry.scope }),
          ...(limits === undefined ? {} : { limits }),
          ...(meta === undefined ? {} : { meta }),
          created: entry.created,
          ...(entry.expires === undefined ? {} : { expires: entry.expires }),
          token: entry.token,
        };
      });
      return { tokens, broken: false };
    }
    catch (error) {
      once(`${tokensFile} is not a tokens file (${error instanceof Error ? error.message : String(error)}); no token can sign in`);
      return { tokens: [], broken: true };
    }
  };

  /** Replace the tokens file, atomically, refusing to clobber one that will not parse. */
  const writeTokens = (tokens: TokenRecord[]): void => {
    if (readTokens().broken) throw new Error(`${tokensFile} is not a tokens file; fix it before changing anybody's tokens`);
    // Owner-only, by the default of `writeJsonAtomic`: the file holds the
    // hashes of secrets that sign in as somebody.
    writeJsonAtomic(tokensFile, { tokens });
    // A watcher that hears a users-file write should hear this one too.
    for (const poke of pokes) poke();
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
   * change is in force at the same point.
   */
  const principalOf = (
    record: UserRecord,
    fromIssuer: string[] = [],
    expiresAt?: number,
    minted?: TokenRecord,
    local = false,
  ): Principal => {
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
    /*
     * Frozen, and every one of them.
     *
     * A principal reaches a resource provider, an `authorize` hook and a
     * home-made scheme's own methods, and a provider that replaced `can`, `id`
     * or a getter would be deciding what the gate asks next - so the literal is
     * frozen where it is built and the getters go on re-reading the file, which
     * freezing an accessor does not stop.
     */
    return Object.freeze({
      id: record.id,
      /*
       * The token they signed in with, when it was one of their own.
       *
       * Stamped rather than re-read: it is what this connection presented, and
       * the id is what `can` and `standing` look the token up by.
       */
      ...(minted === undefined ? {} : { token: minted.id }),
      // Frozen with the literal, because the roles are the grants the gate
      // reads: a provider handed this principal could otherwise add a role to
      // the person it was signed in as. See the comment above.
      roles: Object.freeze([...record.roles, ...fromIssuer]),
      // The claim's own share of `roles`, frozen for the same reason.
      ...(fromIssuer.length === 0 ? {} : { rolesFromSignIn: Object.freeze([...fromIssuer]) }),
      /*
       * Whether the token they arrived with signs them in as well.
       *
       * A local token does unless the record, or the host, requires the
       * issuer; a token from an issuer always does. Stamped once, because the
       * door asks once per connection and the person's answer does not change
       * while their socket is open.
       */
      trusted: !(local && requiresIssuer(record)),
      // Stamped like `trusted`, and for the same reason: it is what the token
      // said at the moment it was checked, and the token is not kept.
      ...(expiresAt === undefined ? {} : { expiresAt }),
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
      /*
       * The team and project the key signed in with is charged to.
       *
       * Re-read on every question as `can` is: a record that was revoked or
       * that names no `scope` answers nothing here, and the call falls back to
       * the person's primary as it did before a key could carry one.
       */
      get keyScope(): string | undefined {
        if (minted === undefined) return undefined;
        const live = readTokens().tokens.find((one) => one.id === minted.id);
        return live === undefined || live.user !== record.id ? undefined : live.scope;
      },
      /*
       * What the key they signed in with says about itself.
       *
       * Re-read as `keyScope` is, and for the same reason: a revoked record
       * answers nothing, so a meta the file no longer holds is gone at the next
       * call rather than at the next connection.
       */
      get keyMeta(): Record<string, string> | undefined {
        if (minted === undefined) return undefined;
        const live = readTokens().tokens.find((one) => one.id === minted.id);
        return live === undefined || live.user !== record.id ? undefined : live.meta;
      },
      /*
       * The limits of the key they signed in with, re-read as `standing` reads
       * the record.
       *
       * A key's limits are on its record and nowhere else, so a revoked or
       * expired key answers none and the person's own secret answers none. What
       * comes back is what the walk builds a `cap` row from, and it never allows
       * anything on its own.
       */
      get keyLimits(): readonly PolicyLimit[] | undefined {
        if (minted === undefined) return undefined;
        const live = readTokens().tokens.find((one) => one.id === minted.id);
        if (live === undefined || live.user !== record.id) return undefined;
        if (live.expires !== undefined && live.expires <= Date.now()) return undefined;
        return live.limits;
      },
      /*
       * The person, and a minted token's own life beside theirs.
       *
       * A token is looked up again on every question, as the person is: a
       * revoke or an expiry is in force at the next command rather than at the
       * next sign-in, and a tokens file that will not parse reads as no tokens
       * and answers false.
       */
      standing: () => {
        const { file } = read();
        if (!(file.users ?? []).some((one) => one.id === record.id)) return false;
        if (minted === undefined) return true;
        const live = readTokens().tokens.find((one) => one.id === minted.id);
        return live !== undefined
          && live.user === record.id
          && (live.expires === undefined || live.expires > Date.now());
      },
      can: (grant: Grant) => {
        const { file } = read();
        const now = (file.users ?? []).find((one) => one.id === record.id);
        if (now === undefined) return false;
        const person = grantsOf(now.roles, file);
        if (minted === undefined) return holds(person, grant) || holds(stamped, grant);
        /*
         * Both halves have to hold it now.
         *
         * The person's side is what makes a role taken away take the token's
         * reach with it; the token's side is what keeps the token to the list
         * it was minted for. No `grants` on the record is every grant of the
         * person, read here rather than copied at the mint.
         */
        const live = readTokens().tokens.find((one) => one.id === minted.id);
        if (live === undefined) return false;
        if (live.expires !== undefined && live.expires <= Date.now()) return false;
        const allowed = live.grants === undefined ? person : new Set(live.grants);
        return holds(person, grant) && holds(allowed, grant);
      },
    });
  };

  /**
   * The principal a team key answers for, re-read from both files at each question.
   *
   * The team is the principal, and no person is: its id is `team:<team>`, it
   * holds no role, and it may hold `proxy:call` and `proxy:models` alone. Its
   * memberships are its team and the key's own scope, so `scopeFor` resolves a
   * call to the team or to one of that team's projects and refuses any other.
   */
  const teamPrincipalOf = (team: string, minted: TokenRecord): Principal => {
    /**
     * The key's record as it stands now, when the team is still named.
     *
     * Nothing for a team taken out of the users file, a key that is gone, and a
     * key whose time is up: the same three answers `standing` refuses on.
     */
    const live = (): TokenRecord | undefined => {
      if (!(read().file.teams ?? []).some((one) => one.id === team)) return undefined;
      const one = readTokens().tokens.find((each) => each.id === minted.id);
      if (one === undefined || one.team !== team) return undefined;
      return one.expires !== undefined && one.expires <= Date.now() ? undefined : one;
    };
    const scopes = (one: TokenRecord | undefined): readonly string[] => {
      const scope = one?.scope ?? team;
      return scope === team ? [team] : [team, scope];
    };
    return Object.freeze({
      id: `team:${team}`,
      team,
      // No role is a team's: what it may do is the two grants on its key.
      roles: Object.freeze([]),
      token: minted.id,
      get memberships(): readonly string[] { return scopes(live()); },
      get primary(): string | undefined { return team; },
      get projects(): readonly Named[] { return read().file.projects ?? []; },
      get teams(): readonly Named[] { return read().file.teams ?? []; },
      get keyScope(): string | undefined { return live()?.scope; },
      get keyMeta(): Record<string, string> | undefined { return live()?.meta; },
      get keyLimits(): readonly PolicyLimit[] | undefined { return live()?.limits; },
      standing: () => live() !== undefined,
      can: (grant: Grant) => {
        if (grant !== 'proxy:call' && grant !== 'proxy:models') return false;
        const one = live();
        return one !== undefined && (one.grants ?? []).some((held) => held === grant);
      },
    });
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
      // The tokens file is read beside the users file, and once: this is the
      // one question that has to see both as they are at the same moment.
      const { tokens } = readTokens();
      const hash = hashOf(token);
      // Every hash is compared, the records' and the minted tokens', and the
      // answer is kept rather than returned: which entry matched is then not
      // something the clock tells. A record with no token is compared too, and
      // can never match, so the count does not say which records have one.
      let found: UserRecord | undefined;
      let minted: TokenRecord | undefined;
      for (const record of file.users ?? []) {
        if (same(record.token, hash)) found = record;
      }
      for (const one of tokens) {
        if (same(one.token, hash)) minted = one;
      }
      /*
       * The checks that follow the pass, never inside it.
       *
       * A matched token whose person is gone, or whose time is up, is nobody.
       * An issuer is asked for nothing: a secret this host minted is a local
       * credential, and a record that matched here is the one that says who.
       */
      if (minted !== undefined) {
        // A team key belongs to no person, so this door answers nothing for it.
        // `verifyTeamKey` is the one that does, and only the proxy asks it.
        if (minted.team !== undefined) return undefined;
        const person = (file.users ?? []).find((one) => one.id === minted.user);
        if (person === undefined) return undefined;
        if (minted.expires !== undefined && minted.expires <= Date.now()) return undefined;
        return principalOf(person, [], minted.expires, minted, true);
      }
      if (found !== undefined) return principalOf(found, [], undefined, undefined, true);
      /*
       * The issuers, only when nothing local matched.
       *
       * A deployment that mints secrets keeps working because this branch is
       * never reached for one, and a record with no hash can only be reached
       * here: the subject an issuer answers with is that record's id, so the
       * file still says who may do what.
       *
       * The host's default is asked first, then each issuer a record names, in
       * the order the file lists them, and the first subject that names a
       * record wins. An opaque token does not say which provider minted it, so
       * a host with several issuers shows it to more than one; the order is the
       * whole of what decides which. A token that is a JWT does say, and takes
       * the branch below instead.
       */
      const peopleAt = (name: string): UserRecord[] =>
        (file.users ?? []).filter((one) => issuerNameOf(one) === name);
      // The host's default first, then each name the file writes, in its order.
      // A name nobody signs in through is left out rather than reported: it is
      // an entry to fix, and not a question this token asked.
      const names = [...new Set([
        ...(options.issuer === undefined ? [] : [options.issuer]),
        ...(file.users ?? []).flatMap((one) => (one.issuer === undefined ? [] : [one.issuer])),
      ])].filter((name) => peopleAt(name).length > 0);

      /**
       * How a token from one issuer is checked here.
       *
       * The setting of the record that names that issuer, when it carries one,
       * and the host's otherwise: which is what makes turning this on once a
       * decision for the deployment, and one record the exception.
       */
      const modeOf = (name: string): IssuerVerify =>
        (file.users ?? []).find((one) => one.issuer === name && one.issuerVerify !== undefined)?.issuerVerify
          ?? options.issuerVerify
          ?? 'userinfo';

      /**
       * The person a token belongs to, checked here by the issuer that signed
       * it, or nothing.
       *
       * Nothing is the answer for a token that does not check out and for an
       * issuer that cannot check one at all - one with no key set to check it
       * against - because the question this asked was whether the token is
       * good, and a refusal to answer is not a yes.
       */
      const checked = async (name: string, held: string): Promise<Principal | undefined> => {
        const answer = await adapterFor(name)?.verify?.(held, audience());
        if (answer === undefined) return undefined;
        const record = peopleAt(name).find((one) => one.id === answer.subject);
        if (record === undefined) return undefined;
        // The claim is read from the same answer, so a sign-in checked here is
        // one request for a key set and none for the person.
        return principalOf(record, rolesFromClaim(record, answer.claims), answer.expiresAt);
      };

      /*
       * A token that is a JWT says which issuer signed it, and that is the one
       * asked. `iss` is read here before any of it is verified, and is not
       * believed: it picks a name out of the ones this host already knows.
       *
       * A token naming an issuer that is not here is nobody's token here, and
       * is answered with no request at all: the issuers that are would each be
       * shown a token another issuer minted, and none of them could say who it
       * belongs to. That is the answer under every setting, `userinfo`
       * included, because no setting makes an unrelated issuer an authority on
       * a token.
       */
      const claimed = jwtIssuer(token);
      const at = claimed === undefined
        ? undefined
        : names.find((name) => {
          const issuer = adapterFor(name);
          // Compared as the issuer spells itself, so a name configured without
          // the trailing slash its metadata uses is still one issuer.
          return issuer !== undefined && sameIssuer(issuer.id, claimed);
        });
      if (claimed !== undefined && at === undefined) return undefined;
      if (at !== undefined) {
        const mode = modeOf(at);
        if (mode !== 'userinfo') {
          const who = await checked(at, token);
          if (who !== undefined) return who;
          // `jwt` is the whole of what such a token may be checked with: an
          // operator who asked for it asked for the endpoint not to be asked,
          // which is the request the setting is there to remove.
          if (mode === 'jwt') return undefined;
          // `auto` carries on, which is what an issuer publishing no key set -
          // and one whose key set cannot be reached - falls through to.
        }
      }
      for (const name of names) {
        // An issuer checked here is never asked over `userinfo`, whatever the
        // token is: the mode is what an operator set to stop that request, and
        // a token this host cannot check is one it does not accept. So a host
        // that checks every issuer here asks nobody, and an opaque token is
        // then nobody's rather than shown around.
        if (modeOf(name) === 'jwt') continue;
        const issuer = adapterFor(name);
        if (issuer === undefined) continue;
        const answer = await issuer.who(token);
        if (answer === undefined) continue;
        found = peopleAt(name).find((one) => one.id === answer.subject);
        if (found !== undefined) {
          // The claim is read from the same answer, so a sign-in is one
          // question to the issuer and not two.
          return principalOf(found, rolesFromClaim(found, answer.claims));
        }
      }
      return undefined;
    },

    /*
     * A team key, checked the same way and answered only when it is one.
     *
     * Every hash is compared, as `verify` compares them, and a key that names a
     * person is no team key: the two doors are disjoint, so a secret that
     * reaches one is refused by the other.
     */
    verifyTeamKey: async (token) => {
      if (token === '') return undefined;
      const hash = hashOf(token);
      let minted: TokenRecord | undefined;
      for (const one of readTokens().tokens) {
        if (same(one.token, hash) && one.team !== undefined) minted = one;
      }
      if (minted === undefined || minted.team === undefined) return undefined;
      const { file } = read();
      if (!(file.teams ?? []).some((one) => one.id === minted.team)) return undefined;
      if (minted.expires !== undefined && minted.expires <= Date.now()) return undefined;
      return teamPrincipalOf(minted.team, minted);
    },

    list: async () => {
      const { file } = read();
      return (file.users ?? []).map((one) => {
        const issuer = issuerNameOf(one);
        return {
          id: one.id,
          roles: [...one.roles],
          grants: [...grantsOf(one.roles, file)] as Grant[],
          // What the record resolved to, so `ahpd user list` can say whether
          // their local token signs them in, who still has to sign in, and
          // where their credential comes from.
          trusted: !requiresIssuer(one),
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
      const rolesFrom = options?.rolesFrom;
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
        if (typeof issuer === 'string' && !knows(issuer)) {
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
      // Each left alone when the verb names none: setting a role must not
      // quietly move somebody off their team.
      const membershipFields = memberships === undefined ? {} : { memberships: [...memberships] };
      const primaryField = typeof primary === 'string' ? { primary } : {};
      const issuerFields = {
        ...(typeof issuer === 'string' ? { issuer } : {}),
        ...(typeof rolesFrom === 'string' ? { rolesFrom } : {}),
      };
      if (held === undefined) users.push({ id, roles: [...roles], token: '', ...issuerFields, ...membershipFields, ...primaryField });
      else {
        held.roles = [...roles];
        Object.assign(held, issuerFields);
        Object.assign(held, membershipFields);
        Object.assign(held, primaryField);
        // `null` is how an issuer, a roles-from and a primary are taken away,
        // which leaving a team is not: that goes with the memberships below.
        if (issuer === null) delete held.issuer;
        if (rolesFrom === null) delete held.rolesFrom;
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

    roles: async () => Object.entries(read().file.roles ?? {}).map(([id, grants]) => ({ id, grants: [...grants] })),

    addRole: async (id, grants) => {
      if (!SPELLABLE.test(id)) throw new Error(`${id} cannot name a role: it may not hold a space, a colon or a star`);
      /*
       * A grant that is not `<subject>:<operation>` is refused rather than dropped.
       *
       * The read reports one and drops it, which is what a file edited by hand
       * needs; a write is somebody asking for the role, and a role holding a
       * grant that matches nothing looks on every later read like a permission
       * the host has and does not.
       */
      const kept: Grant[] = [];
      for (const one of grants) {
        const why = grantProblem(one);
        if (why !== undefined) throw new Error(why);
        kept.push(one);
      }
      const { file } = read();
      // No prototype, for the reason the read has one: a role named `__proto__`
      // is an own key, or that assignment would set the table's prototype.
      const roles: Record<string, Grant[]> = Object.create(null) as Record<string, Grant[]>;
      for (const [name, held] of Object.entries(file.roles ?? {})) roles[name] = [...held];
      roles[id] = kept;
      write({ ...file, roles });
    },

    removeRole: async (id) => {
      const { file } = read();
      const roles = file.roles ?? {};
      if (!Object.hasOwn(roles, id)) return false;
      const who = (file.users ?? []).filter((one) => strings(one.roles).includes(id)).map((one) => one.id);
      if (who.length > 0) throw new Error(`${id} is still a role of ${who.join(', ')}; take them out of it first`);
      const left: Record<string, Grant[]> = { ...roles };
      delete left[id];
      write({ ...file, roles: left });
      return true;
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
      // Their tokens go with them, so adding the id back does not bring the
      // old credentials with it. A broken tokens file reads as no tokens and
      // is left for its owner to fix rather than written over.
      const tokens = readTokens();
      if (!tokens.broken) {
        const kept = tokens.tokens.filter((one) => one.user !== id);
        if (kept.length !== tokens.tokens.length) writeTokens(kept);
      }
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

    mintToken: async (user, given = {}) => {
      const { tokens, broken } = readTokens();
      if (broken) throw new Error(`${tokensFile} is not a tokens file; fix it before minting a token`);
      const { file } = read();
      const now = Date.now();
      if (given.expires !== undefined) {
        if (typeof given.expires !== 'number' || !Number.isFinite(given.expires)) {
          throw new Error('expires is not a date');
        }
        if (given.expires <= now) {
          throw new Error(`expires ${new Date(given.expires).toISOString()} is not in the future`);
        }
      }
      /*
       * The limits are checked as a `model` row's, and a key's pool is always
       * `shared`. A missing pool is filled rather than refused, so a client may
       * name an amount, a measure and a period alone.
       */
      const limits = given.limits === undefined ? undefined : checkKeyLimits(given.limits);
      // The same bounds the reader and the proxy's header use, so a key can
      // never hold a meta a call could not carry.
      const meta = given.meta === undefined ? undefined : checkMeta(given.meta);
      // Only the tokens still live hold a place: an expired one is a credential
      // that no longer works, and it should not keep its owner from minting.
      const limit = options.tokensPerPerson ?? 10;
      /*
       * An id that starts with `-` reads at a terminal as an option, so
       * `token rm -abc` would be an unknown flag rather than a revoke. Base64url
       * spells that one character in 64, so a mint makes another id for it.
       */
      let id = randomBytes(6).toString('base64url');
      while (id.startsWith('-') || tokens.some((one) => one.id === id)) id = randomBytes(6).toString('base64url');
      const secret = randomBytes(32).toString('base64url');

      /*
       * A team key: the team instead of a person, and the proxy's two grants.
       *
       * The team is named and the person is not, so a mint that carries both is
       * a caller that did not say which it meant. A team has no roles, so there
       * is no grant list to copy: what it may do is `proxy:call` and
       * `proxy:models`, and those are the only two a key may carry.
       */
      if (given.team !== undefined) {
        const team = given.team;
        if (user !== undefined) throw new Error('a token names a user or a team, not both');
        if (!(file.teams ?? []).some((one) => one.id === team)) throw new Error(`no team called ${team}`);
        if (given.grants === undefined || given.grants.length === 0) {
          throw new Error('a team key holds proxy:call or proxy:models, and names none');
        }
        for (const grant of given.grants) {
          if (grant !== 'proxy:call' && grant !== 'proxy:models') {
            throw new Error(`${grant} is not a grant a team key may hold; a team key holds proxy:call and proxy:models`);
          }
        }
        /*
         * The scope is the team, or a project the file names under it.
         *
         * A wide `team:*` is no place to charge a call, and another team is
         * where calls made with this key would land without the key saying so.
         */
        let scope = team;
        if (given.scope !== undefined) {
          const parsed = typeof given.scope === 'string' ? membership(given.scope) : undefined;
          if (parsed === undefined || parsed.project === '*') {
            throw new Error(`${String(given.scope)} is not a scope: a scope is team or team:project`);
          }
          if (parsed.team !== team) {
            throw new Error(`a team key is charged to ${team} or a project of it, and ${given.scope} names another team`);
          }
          if (parsed.project !== undefined && !(file.projects ?? []).some((one) => one.id === parsed.project)) {
            throw new Error(`${given.scope} is not a project this host names`);
          }
          scope = parsed.written;
        }
        const live = tokens.filter((one) => one.team === team && (one.expires === undefined || one.expires > now));
        if (live.length >= limit) {
          throw new Error(`team ${team} may hold ${limit} tokens at most; revoke one before minting another`);
        }
        const record: TokenRecord = {
          id,
          team,
          ...(given.label === undefined ? {} : { label: given.label }),
          grants: [...given.grants],
          scope,
          ...(limits === undefined ? {} : { limits }),
          ...(meta === undefined ? {} : { meta }),
          created: now,
          ...(given.expires === undefined ? {} : { expires: given.expires }),
          // The secret is written here and nowhere, and only as its hash.
          token: hashOf(secret),
        };
        writeTokens([...tokens, record]);
        const { token: _hash, ...shown } = record;
        return { ...shown, secret };
      }

      if (user === undefined) throw new Error('a token is minted for a user or a team');
      const held = (file.users ?? []).find((one) => one.id === user);
      if (held === undefined) throw new Error(`no user called ${user}`);
      /*
       * Every grant named is one the person holds now.
       *
       * The check is at the mint and again at every use: this one keeps a token
       * from being made holding more than its person does, and `can` keeps a
       * token from keeping a grant the person later loses.
       */
      if (given.grants !== undefined) {
        const person = grantsOf(held.roles, file);
        for (const grant of given.grants) {
          if (!holds(person, grant)) {
            throw new Error(`user ${user} does not hold ${grant}; a token may not hold what its person does not`);
          }
        }
      }
      /*
       * The scope is a place the person is in now, and never a wildcard.
       *
       * `scopeFor` is what every call asks, so a key naming a team or project
       * the person has since been taken out of is one they could no longer be
       * charged for. Its sentence is the refusal here, as its answer is at the
       * call.
       */
      if (given.scope !== undefined) {
        const written = given.scope;
        const parsed = typeof written === 'string' ? membership(written) : undefined;
        if (parsed === undefined || parsed.project === '*') {
          throw new Error(`${String(written)} is not a scope: a scope is team or team:project`);
        }
        const answer = scopeFor(principalOf(held), written);
        if (answer === undefined) throw new Error('this host names no team, so a key has no scope to carry');
        if (answer.refusal !== undefined) throw new Error(answer.refusal);
      }
      const live = tokens.filter((one) => one.user === user && (one.expires === undefined || one.expires > now));
      if (live.length >= limit) {
        throw new Error(`user ${user} may hold ${limit} tokens at most; revoke one before minting another`);
      }
      const record: TokenRecord = {
        id,
        user,
        ...(given.label === undefined ? {} : { label: given.label }),
        ...(given.grants === undefined ? {} : { grants: [...given.grants] }),
        ...(given.scope === undefined ? {} : { scope: given.scope }),
        ...(limits === undefined ? {} : { limits }),
        ...(meta === undefined ? {} : { meta }),
        created: now,
        ...(given.expires === undefined ? {} : { expires: given.expires }),
        // The secret is written here and nowhere, and only as its hash.
        token: hashOf(secret),
      };
      writeTokens([...tokens, record]);
      const { token: _hash, ...shown } = record;
      return { ...shown, secret };
    },

    tokens: async (user) => {
      const all = readTokens().tokens;
      return all
        .filter((one) => user === undefined || one.user === user)
        .sort((one, other) => one.created - other.created)
        .map((one) => {
          // The hash stays here. A listing is what a person can revoke, and a
          // hash is not one of those.
          const { token: _hash, ...shown } = one;
          return shown;
        });
    },

    revokeToken: async (id) => {
      const { tokens } = readTokens();
      if (!tokens.some((one) => one.id === id)) return false;
      writeTokens(tokens.filter((one) => one.id !== id));
      return true;
    },

    /*
     * The folder rather than the file: a write replaces the file by a rename,
     * and a watch on the file itself follows the old one away.
     */
    watch: (onChange) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const poke = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => { timer = undefined; onChange(); }, SETTLE);
      };
      const name = basename(options.path);
      let watcher: ReturnType<typeof watchPath> | undefined;
      try {
        watcher = watchPath(dirname(options.path), (_event, changed) => {
          if (changed === null || String(changed) === name) poke();
        });
        watcher.on('error', (error) => { once(`users file watch stopped: ${error.message}`); });
        // The host's listener is what keeps a daemon running, not this.
        watcher.unref?.();
      }
      catch (error) {
        // A folder that cannot be watched still hears this directory's own writes.
        once(`users file cannot be watched: ${(error as Error).message}`);
      }
      pokes.add(poke);
      return {
        close: () => {
          pokes.delete(poke);
          if (timer !== undefined) clearTimeout(timer);
          timer = undefined;
          watcher?.close();
        },
      };
    },
  };
}
