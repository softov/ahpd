/**
 * Checking what a plugin registered before the host is allowed to see it.
 *
 * TypeScript does not survive to runtime and a plugin may be JavaScript, so a
 * type signature is what an author reads and not what the daemon can rely on.
 * A value written by `apply` is the one thing in `HostOptions` the daemon did
 * not write itself, and this is the boundary where it is checked: the required
 * members the contract names have to be there and be the right kind of thing,
 * and a member that is present must be too.
 *
 * The check is hand-written, a `typeof` test per member, because ahpd has no
 * runtime dependency and the contracts are TypeScript interfaces rather than
 * schemas. A failure throws one message naming the plugin, the method and the
 * member, which the loader's `try` around `apply` reports and discards, so a
 * bad registration never reaches `createHost`. Nothing optional is checked
 * away: a port with its write half left off, a read-only `resources` and an
 * `Agent` with no `probe` are all valid.
 */

import type { PortKey } from './types/plugin.js';

/**
 * The one message shape every check reports through.
 *
 * One shape, because a reader of the daemon log has to tell a plugin's mistake
 * from the host's: it names the plugin, the method it called, the member that
 * failed and what was expected there.
 */
export const miss = (by: string, method: string, member: string, expected: string): string =>
  `plugin ${by}: ${method} needs ${member} to be ${expected}`;

/** What a member is expected to be, in the few kinds a contract names. */
type Kind = 'function' | 'object' | 'string' | 'boolean' | 'array';

/** Whether a value is that kind. Arrays are not objects and `null` is neither. */
const right = (value: unknown, expected: Kind): boolean => {
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
  return typeof value === expected;
};

/** Say the member is a non-empty string, or where it was not. */
const stringy = (object: Record<string, unknown>, member: string, by: string, method: string): void => {
  if (typeof object[member] !== 'string' || (object[member] as string).trim() === '') {
    throw new Error(miss(by, method, member, 'a non-empty string'));
  }
};

/** The value as a keyed object, or where it was not one. */
const asObject = (value: unknown, by: string, method: string, member: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(miss(by, method, member, 'an object'));
  }
  return value as Record<string, unknown>;
};

/*
 * The optional members of `Agent`, by the kind each one is declared with.
 *
 * Every optional member present is checked, because "optional" says a plugin
 * may leave it out and not that it may put anything there. `description` is a
 * string and `chats` an object, so "each optional member is a function" was
 * never the rule; the interface is.
 */
const AGENT_OPTIONAL: Record<string, Kind> = {
  description: 'string',
  chats: 'object',
  multipleDirectories: 'boolean',
  protectedResources: 'array',
  probe: 'function',
  directories: 'function',
  list: 'function',
  stateFile: 'function',
  endpoints: 'function',
  transcript: 'function',
};

/** Check one `registerAgent` value against `Agent`. */
export const checkAgent = (value: unknown, by: string): void => {
  const object = asObject(value, by, 'registerAgent', 'agent');
  stringy(object, 'provider', by, 'registerAgent');
  stringy(object, 'displayName', by, 'registerAgent');
  for (const member of ['schema', 'defaults', 'create']) {
    if (typeof object[member] !== 'function') throw new Error(miss(by, 'registerAgent', member, 'a function'));
  }
  for (const [member, expected] of Object.entries(AGENT_OPTIONAL)) {
    if (object[member] === undefined) continue;
    if (!right(object[member], expected)) throw new Error(miss(by, 'registerAgent', member, expected));
  }
};

/*
 * The optional members of `HostTool`. `definition` is checked for the one
 * thing the host reads off it, its `name`; the rest of the tool definition is
 * the protocol's shape and is checked where a session is offered it.
 */
const TOOL_OPTIONAL: Record<string, Kind> = {
  instruction: 'string',
  compact: 'object',
  forSession: 'function',
  deferLoading: 'boolean',
};

/** Check one `registerTool` value against `HostTool`. */
export const checkTool = (value: unknown, by: string): void => {
  const object = asObject(value, by, 'registerTool', 'tool');
  const definition = asObject(object.definition, by, 'registerTool', 'definition');
  stringy(definition, 'name', by, 'registerTool');
  if (typeof object.run !== 'function') throw new Error(miss(by, 'registerTool', 'run', 'a function'));
  for (const [member, expected] of Object.entries(TOOL_OPTIONAL)) {
    if (object[member] === undefined) continue;
    if (!right(object[member], expected)) throw new Error(miss(by, 'registerTool', member, expected));
  }
};

/**
 * The required members of each port, by kind.
 *
 * Keyed by `PortKey`, so a port added to the union and not to this table is a
 * compile error rather than a registration that goes unchecked. Only the
 * members the interface declares without a `?` are here; everything else is
 * optional and an implementation is free to leave it off.
 */
const PORT_MEMBERS: Record<PortKey, Record<string, Kind>> = {
  resources: { list: 'function', read: 'function', resolve: 'function', complete: 'function' },
  terminals: { create: 'function' },
  changes: { scopes: 'function', state: 'function', summary: 'function' },
  directories: { meta: 'function' },
  worktrees: { repository: 'function', branches: 'function', create: 'function', dirty: 'function', remove: 'function' },
  // `resource` is a value rather than a call, which is why the check is by
  // kind and not "every required member is a function".
  github: { resource: 'object', forBranch: 'function', create: 'function' },
  automations: {
    list: 'function', get: 'function', triggers: 'function', create: 'function', update: 'function',
    remove: 'function', run: 'function', runOf: 'function', runs: 'function',
  },
  sessions: {
    flags: 'function', setFlags: 'function', config: 'function', setConfig: 'function',
    artifacts: 'function', setArtifacts: 'function', pullRequests: 'function', setPullRequests: 'function',
    chatTitle: 'function', setChatTitle: 'function', forget: 'function',
  },
  // Every member of `Diagnostics` is optional, so any object is a diagnostics
  // and there is nothing to demand of one.
  diagnostics: {},
};

/** The method each port is reached through, for a message that names what was called. */
export const PORT_METHOD: Record<PortKey, string> = {
  resources: 'registerResources',
  terminals: 'registerTerminals',
  changes: 'registerChanges',
  directories: 'registerDirectories',
  worktrees: 'registerWorktrees',
  github: 'registerGithub',
  automations: 'registerAutomations',
  sessions: 'registerSessions',
  diagnostics: 'registerDiagnostics',
};

/** Check one port registration against the contract its key names. */
export const checkPort = (key: PortKey, value: unknown, by: string): void => {
  const method = PORT_METHOD[key];
  const object = asObject(value, by, method, key);
  for (const [member, expected] of Object.entries(PORT_MEMBERS[key])) {
    if (!right(object[member], expected)) throw new Error(miss(by, method, member, expected));
  }
};

/*
 * The optional members of `ResourceProvider`, by kind. `read` is the one
 * required member and is checked on its own.
 */
const PROVIDER_OPTIONAL: Record<string, Kind> = {
  list: 'function',
  resolve: 'function',
  watch: 'function',
  write: 'function',
  remove: 'function',
  mkdir: 'function',
  move: 'function',
  copy: 'function',
};

/**
 * A scheme, as a URI names one.
 *
 * The shape is the one `why` matches when it reads a scheme out of a URI, and
 * it is checked because the scheme is the key a URI is routed by: a registered
 * scheme no URI can name is a provider nothing can reach.
 */
export const checkScheme = (scheme: unknown, by: string): string => {
  if (typeof scheme !== 'string' || !/^[a-zA-Z][\w+.-]*$/.test(scheme)) {
    throw new Error(miss(by, 'registerResourceProvider', 'scheme', 'a URI scheme like computer'));
  }
  return scheme;
};

/** Check one `registerResourceProvider` value against `ResourceProvider`. */
export const checkResourceProvider = (scheme: string, value: unknown, by: string): void => {
  const object = asObject(value, by, 'registerResourceProvider', scheme);
  if (typeof object.read !== 'function') {
    throw new Error(miss(by, 'registerResourceProvider', 'read', 'a function'));
  }
  for (const [member, expected] of Object.entries(PROVIDER_OPTIONAL)) {
    if (object[member] === undefined) continue;
    if (!right(object[member], expected)) throw new Error(miss(by, 'registerResourceProvider', member, expected));
  }
};
