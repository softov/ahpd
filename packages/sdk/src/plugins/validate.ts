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

import type { StartSession } from '../types/automations.js';
import type { ChatRequest, PluginContracts, PortKey } from '../types/plugin.js';
import type { Owner } from '../types/usage.js';
import { SUBJECTS, isGrant } from '../access/users.js';
import { isSecret, secretFields } from '../channels/owners.js';
import { RECORD_SLUG, isRecordSlug } from '../resources/records.js';
import { schemaGaps, type SchemaGap } from './schemagaps.js';

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

/**
 * One schema a registration gave, and the gaps the walk found in it.
 *
 * A check answers these beside its own result rather than writing them out:
 * the schema's gaps are a problem line and never a refusal, and only the
 * caller knows where the line goes. `where` names the schema the way the line
 * reads, such as `engine claude` or `adapter slack capability send input`.
 */
export interface CheckedSchema {
  where: string;
  gaps: SchemaGap[];
}

/**
 * The gaps in one schema, or none when asking for it throws.
 *
 * A backend's `schema()` is asked here because the form it answers is one a
 * client draws. A schema that throws while being built is that backend's
 * problem to report when it is used, not a reason to refuse the load.
 */
const gapsOf = (read: () => unknown): SchemaGap[] => {
  try {
    return schemaProblems(read());
  }
  catch {
    return [];
  }
};

/** The reason a vault field marked `writeOnly` gives at load. */
const WRITEOUT_IN_VAULT = 'writeOnly kept in the vault; mark it secret';

/** One path below another, with a dot only when there is a parent. */
const under = (base: string, tail: string): string => (base === '' ? tail : `${base}.${tail}`);

/**
 * Every node of a schema that says `writeOnly` and nothing about `secret`.
 *
 * A vault field says `secret: true`, and the host keeps reading `writeOnly` as
 * one so a plugin written before the keyword keeps its secrets out of the
 * record. The line here is what tells such a plugin to mark the field; it never
 * refuses the load. The walk follows `properties`, `additionalProperties` and
 * `items` as `secretPaths` does, and names a map's key and a list's item by the
 * schema rather than by a value, so one line names every such field a form
 * draws. A node that says `secret: false` is not one: the plugin has said the
 * value stays in the record.
 */
const writeOnlyGaps = (schema: unknown): SchemaGap[] => {
  const gaps: SchemaGap[] = [];
  // A schema built in code may hold itself, so a node is not walked again inside itself.
  const walking = new Set<object>();
  const walk = (node: unknown, path: string): void => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return;
    if (walking.has(node)) return;
    walking.add(node);
    const held = node as Record<string, unknown>;
    if (held['writeOnly'] === true && held['secret'] === undefined) {
      gaps.push({ path, reason: WRITEOUT_IN_VAULT });
    }
    const properties = held['properties'];
    if (typeof properties === 'object' && properties !== null && !Array.isArray(properties)) {
      for (const [key, one] of Object.entries(properties)) walk(one, under(path, key));
    }
    walk(held['additionalProperties'], under(path, '*'));
    walk(held['items'], under(path, 'items'));
    walking.delete(node);
  };
  walk(schema, '');
  return gaps;
};

/** The gaps one schema gives: the values it leaves unnamed, and the vault fields it marks `writeOnly`. */
const schemaProblems = (schema: unknown): SchemaGap[] => [...schemaGaps(schema), ...writeOnlyGaps(schema)];

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
  runsNested: 'boolean',
  variant: 'boolean',
  protectedResources: 'array',
  probe: 'function',
  machine: 'function',
  directories: 'function',
  list: 'function',
  find: 'function',
  delete: 'function',
  stateFile: 'function',
  endpoints: 'function',
  transcript: 'function',
};

/** Check one `registerAgent` value against `Agent`, and answer its schema's gaps. */
export const checkAgent = (value: unknown, by: string): CheckedSchema[] => {
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
  return [{ where: `agent ${object.provider as string}`, gaps: gapsOf(object.schema as () => unknown) }];
};

/*
 * The optional members of `HostTool`. `definition` is checked for the one
 * thing the host reads off it, its `name`; the rest of the tool definition is
 * the protocol's shape and is checked where a session is offered it.
 */
const TOOL_OPTIONAL: Record<string, Kind> = {
  instruction: 'string',
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
    chatTitle: 'function', setChatTitle: 'function', chats: 'function', setChats: 'function',
    chatFlags: 'function', setChatFlags: 'function',
    sessions: 'function', forget: 'function',
  },
  // Every member of `Diagnostics` is optional, so any object is a diagnostics
  // and there is nothing to demand of one.
  diagnostics: {},
  computers: { how: 'function' },
  containers: { docker: 'function', available: 'function', connect: 'function', send: 'function', disconnect: 'function' },
  usage: { record: 'function', total: 'function' },
  policies: { list: 'function', get: 'function', put: 'function', remove: 'function' },
  vault: { get: 'function', set: 'function', delete: 'function', list: 'function' },
  records: { collection: 'function' },
  // The value is the parser itself rather than an object with members, so the
  // kind is said in `PORT_ITSELF` below and there is nothing to list here.
  commandParser: {},
};

/**
 * The ports whose value is itself the thing, rather than an object with
 * members.
 *
 * A function has no members to read, so a port holding one is tested whole.
 */
const PORT_ITSELF: Partial<Record<PortKey, Kind>> = {
  commandParser: 'function',
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
  computers: 'registerComputers',
  containers: 'registerContainers',
  usage: 'registerUsage',
  policies: 'registerPolicies',
  vault: 'registerVault',
  records: 'registerRecords',
  commandParser: 'registerCommandParser',
};

/** Check one port registration against the contract its key names. */
export const checkPort = (key: PortKey, value: unknown, by: string): void => {
  const method = PORT_METHOD[key];
  const itself = PORT_ITSELF[key];
  if (itself !== undefined) {
    if (!right(value, itself)) throw new Error(miss(by, method, key, itself));
    return;
  }
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
  describe: 'function',
};

/**
 * A scheme, as a URI names one.
 *
 * The shape is the one `why` matches when it reads a scheme out of a URI, and
 * it is checked because the scheme is the key a URI is routed by: a registered
 * scheme no URI can name is a provider nothing can reach.
 */
export const checkScheme = (scheme: unknown, by: string, method = 'registerResourceProvider'): string => {
  if (typeof scheme !== 'string' || !/^[a-zA-Z][\w+.-]*$/.test(scheme)) {
    throw new Error(miss(by, method, 'scheme', 'a URI scheme like computer'));
  }
  return scheme;
};

/**
 * Refuse a registration the plugin's contracts do not list.
 *
 * `contracts` is what the manifest declares under the plural of each kind, and
 * a plugin that declares none is not checked at all, so a plugin written
 * before contracts existed keeps loading. One that declares a list may
 * register only what is in it, and the refusal names the plugin, the kind and
 * the name so the author sees which registration was not written down.
 *
 * The kinds with no name of their own - a plan, a chat preamble, a route, a
 * closer - are held to their key and one entry, because what they register is
 * the entry rather than a name another registration could collide with.
 *
 * An entry may end in `*`, such as `claude-*`, or be `*` alone, for a plugin
 * that takes a name from its options: the first matches any name with that
 * prefix, and the second any name at all.
 */
export const declared = (by: string, contracts: PluginContracts | undefined, kind: string, name?: string): void => {
  if (contracts === undefined) return;
  const listed = contracts[kind];
  if (listed === undefined) {
    throw new Error(miss(by, kind, 'the registration', `a key its contracts declare, contracts.${kind}`));
  }
  if (name === undefined) {
    if (listed.length === 0) throw new Error(miss(by, kind, 'the registration', `one entry in contracts.${kind}`));
    return;
  }
  if (!listed.some((entry) => names(entry, name))) {
    throw new Error(miss(by, kind, name, `a name in contracts.${kind}`));
  }
};

/** Whether one contract entry names `name`, exactly, by a prefix or by `*`. */
const names = (entry: string, name: string): boolean => {
  if (entry === '*') return true;
  if (!entry.endsWith('*')) return entry === name;
  return name.startsWith(entry.slice(0, -1));
};

/** Prefixes no plugin scheme or harness may start with, and why. */
const RESERVED_PREFIXES: readonly (readonly [string, string])[] = [
  ['ahp-', 'ahp- names the protocol\'s own channels'],
  ['ahpd-', 'ahpd- names this host\'s own channels'],
  ['x-', 'x- names a protocol extension'],
];

/** Names a URI or a grant already means on this host. */
const RESERVED_NAMES = new Map<string, string>([
  ...SUBJECTS.map((subject): [string, string] => [subject, `${subject} is a subject the host grants`]),
  ...['http', 'https', 'ws', 'wss', 'data', 'mailto'].map((scheme): [string, string] => [scheme, `${scheme} is a scheme a client opens itself`]),
  ['file', 'file is the host\'s own store'],
  ['automations', 'automations is the host\'s own channel'],
]);

/**
 * Why a resource scheme or an agent harness may not take this name, or
 * `undefined` when it may.
 *
 * A harness names its session channels, `<provider>:/<id>`, and a scheme names
 * its URIs, so both share one space with the host's own channels and grants.
 * A plugin given one of these would be answered by something else, or would
 * answer for it. Compared in lowercase, because a URI scheme is.
 */
export const reservedName = (name: string): string | undefined => {
  const lower = name.toLowerCase();
  for (const [prefix, why] of RESERVED_PREFIXES) if (lower.startsWith(prefix)) return why;
  return RESERVED_NAMES.get(lower);
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

/*
 * The optional members of `PluginChannel`, by kind. `grant` and `snapshot` are
 * the required ones and are checked on their own.
 */
const CHANNEL_OPTIONAL: Record<string, Kind> = {
  authorize: 'function',
  left: 'function',
  describe: 'function',
};

/** Check one `registerChannel` value against `PluginChannel`. */
export const checkChannel = (scheme: string, value: unknown, by: string): void => {
  const object = asObject(value, by, 'registerChannel', scheme);
  if (typeof object.grant !== 'string' || !isGrant(object.grant)) {
    throw new Error(miss(by, 'registerChannel', 'grant', 'a grant like bot:read'));
  }
  if (typeof object.snapshot !== 'function') {
    throw new Error(miss(by, 'registerChannel', 'snapshot', 'a function'));
  }
  for (const [member, expected] of Object.entries(CHANNEL_OPTIONAL)) {
    if (object[member] === undefined) continue;
    if (!right(object[member], expected)) throw new Error(miss(by, 'registerChannel', member, expected));
  }
};

/*
 * The optional members of `PluginMethod`, by kind. `grant` and `handle` are
 * the required ones and are checked on their own.
 */
const METHOD_OPTIONAL: Record<string, Kind> = {
  authorize: 'function',
  describe: 'function',
};

/** Check one `registerMethod` name and value against `PluginMethod`. */
export const checkMethod = (name: unknown, value: unknown, by: string): string => {
  if (typeof name !== 'string' || !/^x-\S+$/.test(name)) {
    throw new Error(miss(by, 'registerMethod', 'the name', 'a command name that starts with x-, the protocol\'s extension prefix'));
  }
  const object = asObject(value, by, 'registerMethod', name);
  if (typeof object.grant !== 'string' || !isGrant(object.grant)) {
    throw new Error(miss(by, 'registerMethod', 'grant', 'a grant like bot:read'));
  }
  if (typeof object.handle !== 'function') {
    throw new Error(miss(by, 'registerMethod', 'handle', 'a function'));
  }
  for (const [member, expected] of Object.entries(METHOD_OPTIONAL)) {
    if (object[member] === undefined) continue;
    if (!right(object[member], expected)) throw new Error(miss(by, 'registerMethod', member, expected));
  }
  return name;
};

/**
 * An owner, as the five kinds the usage rules spell.
 *
 * Written here rather than imported: the shape is what a *grant* is checked
 * against at this boundary, and a plugin's string is the one thing in the host
 * that has not been through a type. `plugin:<name>` is one of the five because
 * a plugin is not a person and its own work is nobody's but its own - a chat it
 * keeps with a bot is started for it and not for anybody at a keyboard - which
 * is what the sessions store has read back since plugin/20 named the kind.
 */
const OWNER = /^(?:user|team|project|root|plugin):.+$/;

/**
 * Check one `startSession` request, and answer it in the host's own shape.
 *
 * Checked here rather than where the session is started, because this is the
 * boundary a plugin's value crosses: a JavaScript plugin's request reaches
 * `createHost` as an object nothing has looked at, and the refusal has to name
 * the plugin and the member the way every other one here does. What comes back
 * is a `StartSession`, so nothing downstream has to know there are two shapes.
 *
 * A request may carry no `prompt`, which asks for a session that opens with
 * nobody speaking: a bot with no instructions is talked to rather than told
 * anything, and that is an ask a plugin is allowed to make. A `prompt` that is
 * there and is whitespace is the other thing - nothing said, written out - and
 * is refused, the same way a name made of spaces is not a name.
 */
export const checkSessionRequest = (value: unknown, by: string): StartSession => {
  const object = asObject(value, by, 'startSession', 'a session request');
  const said = object.prompt;
  if (said !== undefined && (typeof said !== 'string' || said.trim() === '')) {
    throw new Error(miss(by, 'startSession', 'prompt', 'the first message, as a line of text, or nothing for a session that opens silent'));
  }
  const prompt = typeof said === 'string' ? said.trim() : '';
  const owner = object.owner;
  if (typeof owner !== 'string' || !OWNER.test(owner)) {
    throw new Error(miss(by, 'startSession', String(owner), 'an owner: user:, team:, project:, root: or plugin:'));
  }
  const provider = object.provider;
  if (provider !== undefined && !right(provider, 'string')) {
    throw new Error(miss(by, 'startSession', 'provider', 'a string, or nothing for the host default'));
  }
  const workingDirectory = object.workingDirectory;
  if (workingDirectory !== undefined && !right(workingDirectory, 'string')) {
    throw new Error(miss(by, 'startSession', 'workingDirectory', 'a string, or nothing'));
  }
  // Whether the folder is trusted is a yes or a no, and nothing else: a plugin
  // that writes it as a string asks for something the host would have to guess
  // at, and a grant is not a thing to guess at.
  const trusted = object.trusted;
  if (trusted !== undefined && !right(trusted, 'boolean')) {
    throw new Error(miss(by, 'startSession', 'trusted', 'true or false, or nothing'));
  }
  // The same yes or no, and for the same reason: whether a session loads the
  // person's own settings is a thing a plugin decides, not a string the host
  // would have to read a meaning into.
  const userSettings = object.userSettings;
  if (userSettings !== undefined && !right(userSettings, 'boolean')) {
    throw new Error(miss(by, 'startSession', 'userSettings', 'true or false, or nothing'));
  }
  const config = object.config;
  if (config !== undefined && !right(config, 'object')) {
    throw new Error(miss(by, 'startSession', 'config', 'an object of session config, or nothing'));
  }
  // The protocol's own `ModelSelection`, reached by the same road a client's
  // `createSession` sends one: checked for being an object and read no further
  // here, since what a model id must be is the backend's to say.
  const model = object.model;
  if (model !== undefined && !right(model, 'object')) {
    throw new Error(miss(by, 'startSession', 'model', "the protocol's ModelSelection, or nothing for the backend's own"));
  }
  const title = object.title;
  if (title !== undefined && !right(title, 'string')) {
    throw new Error(miss(by, 'startSession', 'title', 'a string, or nothing'));
  }
  /*
   * The two lists a request carries: what the model is told beside the host's
   * own prompt, and the opt-in tools the session asks for. Both are read as
   * lists of strings and nothing else - a single string where a list belongs is
   * the mistake a plugin makes, and one this check is the only place to catch.
   */
  const listOf = (member: string): string[] | undefined => {
    const value = object[member];
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.some((one) => typeof one !== 'string')) {
      throw new Error(miss(by, 'startSession', member, 'an array of strings, or nothing'));
    }
    return [...value] as string[];
  };
  const instructions = listOf('instructions');
  const tools = listOf('tools');
  return {
    text: prompt,
    owner: owner as Owner,
    ...(provider === undefined ? {} : { provider: provider as string }),
    ...(workingDirectory === undefined ? {} : { workingDirectory: workingDirectory as string }),
    ...(trusted === undefined ? {} : { trusted: trusted as boolean }),
    ...(userSettings === undefined ? {} : { userSettings: userSettings as boolean }),
    ...(config === undefined ? {} : { config: config as Record<string, unknown> }),
    ...(model === undefined ? {} : { model }),
    ...(title === undefined ? {} : { title: title as string }),
    ...(instructions === undefined ? {} : { instructions }),
    ...(tools === undefined ? {} : { tools }),
  };
};

/**
 * Check one `startChat` request, and answer it in the host's own shape.
 *
 * Checked here rather than where the chat is started, for the same reason
 * `checkSessionRequest` is: this is the boundary a plugin's value crosses, and
 * the refusal has to name the plugin and the member the way every other one
 * here does. The session is checked at the call site, which is where it is
 * read; what this checks is the request.
 *
 * A request may carry no `prompt`, which asks for a chat that opens with
 * nobody speaking. Present and blank is a mistake rather than a quiet chat,
 * the same answer an empty session prompt gets.
 */
export const checkChatRequest = (value: unknown, by: string): ChatRequest => {
  const object = asObject(value, by, 'startChat', 'a chat request');
  const said = object.prompt;
  if (said !== undefined && (typeof said !== 'string' || said.trim() === '')) {
    throw new Error(miss(by, 'startChat', 'prompt', 'the first message, as a line of text, or nothing for a chat that opens silent'));
  }
  const provider = object.provider;
  if (provider !== undefined && !right(provider, 'string')) {
    throw new Error(miss(by, 'startChat', 'provider', 'a string, or nothing for the session\'s own backend'));
  }
  const model = object.model;
  if (model !== undefined && !right(model, 'string')) {
    throw new Error(miss(by, 'startChat', 'model', 'a model id, as a line of text, or nothing for the backend\'s own'));
  }
  const config = object.config;
  if (config !== undefined && !right(config, 'object')) {
    throw new Error(miss(by, 'startChat', 'config', 'an object of session config, or nothing'));
  }
  const title = object.title;
  if (title !== undefined && !right(title, 'string')) {
    throw new Error(miss(by, 'startChat', 'title', 'a string, or nothing'));
  }
  return {
    ...(provider === undefined ? {} : { provider: provider as string }),
    ...(model === undefined ? {} : { model: model as string }),
    ...(config === undefined ? {} : { config: config as Record<string, unknown> }),
    ...(title === undefined ? {} : { title: title as string }),
    ...(said === undefined ? {} : { prompt: (said as string).trim() }),
  };
};

/**
 * Check one `registerRoute` value against `Route`.
 *
 * The whole contract is one function taking a `Request` and answering a
 * `Response`, and what it answers cannot be checked here - the daemon hands it
 * to the listener rather than calling it. So the check is the one thing that
 * can be: it is callable. A JavaScript plugin that registered an object is
 * refused at the call site rather than when somebody's webhook arrives.
 */
export const checkRoute = (value: unknown, by: string): void => {
  if (typeof value !== 'function') {
    throw new Error(miss(by, 'registerRoute', 'handler', 'a function taking a Request and answering a Response'));
  }
};

/**
 * Check one `registerTriggerType` value against `TriggerTypeDefinition`.
 *
 * The type and the events are what an automation is looked up by, so they are
 * checked and the rest is left to the listing: a `title` the host shows, an
 * optional `description` and an optional `configSchema` are a client's to draw
 * and cost nothing when they are wrong, while a type with no events - or an
 * event with no id - is a trigger an automation could name and nothing could
 * fire.
 */
export const checkTriggerType = (value: unknown, by: string): CheckedSchema[] => {
  const object = asObject(value, by, 'registerTriggerType', 'definition');
  stringy(object, 'type', by, 'registerTriggerType');
  stringy(object, 'title', by, 'registerTriggerType');
  if (!Array.isArray(object.events) || object.events.length === 0) {
    throw new Error(miss(by, 'registerTriggerType', 'events', 'a list of the events this type offers'));
  }
  const ids = new Set<string>();
  for (const held of object.events) {
    const event = asObject(held, by, 'registerTriggerType', 'events');
    stringy(event, 'id', by, 'registerTriggerType');
    stringy(event, 'title', by, 'registerTriggerType');
    const id = event.id as string;
    if (ids.has(id)) throw new Error(miss(by, 'registerTriggerType', id, 'an event id no other event of this type uses'));
    ids.add(id);
  }
  if (object.configSchema !== undefined && !right(object.configSchema, 'object')) {
    throw new Error(miss(by, 'registerTriggerType', 'configSchema', 'an object'));
  }
  if (object.configSchema === undefined) return [];
  return [{ where: `trigger ${object.type as string}`, gaps: schemaGaps(object.configSchema) }];
};

/**
 * Check a list of icons against `Icon`, the type AHP exports.
 *
 * An icon is decoration, so a list that is absent is valid and every check
 * here is about the shape a client draws: a `src` it can read, and the three
 * optional members of the one type that says what an icon is. Whether the
 * `src` can be read at all is the host's question, because only the host knows
 * the package a path is relative to.
 */
export const checkIcons = (value: unknown, by: string, method = 'registerAdapter'): void => {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new Error(miss(by, method, 'icons', 'a list of icons, each with a src'));
  }
  for (const held of value) {
    const icon = asObject(held, by, method, 'an icon');
    stringy(icon, 'src', by, method);
    if (icon.contentType !== undefined && typeof icon.contentType !== 'string') {
      throw new Error(miss(by, method, 'contentType', 'a string, the MIME type of the icon, or nothing'));
    }
    if (icon.sizes !== undefined && (!Array.isArray(icon.sizes) || icon.sizes.some((one) => typeof one !== 'string'))) {
      throw new Error(miss(by, method, 'sizes', 'a list of strings, such as 48x48 or any, or nothing'));
    }
    if (icon.theme !== undefined && icon.theme !== 'light' && icon.theme !== 'dark') {
      throw new Error(miss(by, method, 'theme', 'light or dark, or nothing'));
    }
  }
};

/**
 * Check a `signIn` against `SignIn`, and that its fields are ones the schema keeps.
 *
 * A sign-in is served as commands of its own, so every member the host calls
 * has to be there and be the right kind. The field is checked against the
 * schema here: only a field the vault keeps is moved there, and a sign-in
 * filling any other would leave the key in the record a client reads. A
 * device-code sign-in fills several fields, so its `account` field is checked
 * too: it is a field the schema describes, and one it does not mark `secret`.
 */
const checkSignIn = (value: unknown, schema: Record<string, unknown>, by: string): void => {
  if (value === undefined) return;
  const signIn = asObject(value, by, 'registerAdapter', 'a signIn');
  if (typeof signIn.title !== 'string' || signIn.title === '') {
    throw new Error(miss(by, 'registerAdapter', 'signIn.title', 'a non-empty string, what a client prints on the button'));
  }
  if (typeof signIn.field !== 'string' || signIn.field === '') {
    throw new Error(miss(by, 'registerAdapter', 'signIn.field', 'a non-empty string, naming a field the schema marks secret'));
  }
  if (signIn.flow !== undefined && signIn.flow !== 'code' && signIn.flow !== 'device') {
    throw new Error(miss(by, 'registerAdapter', 'signIn.flow', 'code or device, or nothing for the pasted code'));
  }
  if (signIn.flow === 'device') {
    for (const member of ['start', 'poll']) {
      if (typeof signIn[member] !== 'function') {
        throw new Error(miss(by, 'registerAdapter', `signIn.${member}`, 'a function, the half of a device sign-in the host calls'));
      }
    }
    if (signIn.switchAccount !== undefined && typeof signIn.switchAccount !== 'boolean') {
      throw new Error(miss(by, 'registerAdapter', 'signIn.switchAccount', 'true or false, or nothing'));
    }
    checkSignInAccount(signIn.account, schema, by);
  } else {
    for (const member of ['url', 'exchange']) {
      if (typeof signIn[member] !== 'function') {
        throw new Error(miss(by, 'registerAdapter', `signIn.${member}`, 'a function, the half of a sign-in the host calls'));
      }
    }
  }
  const field = signIn.field;
  if (!secretFields(schema).includes(field)) {
    throw new Error(miss(by, 'registerAdapter', field, `a field the schema marks secret, so the exchanged value is kept in the vault`));
  }
};

/** Check the plain field a device sign-in keeps its account in, when it names one. */
const checkSignInAccount = (value: unknown, schema: Record<string, unknown>, by: string): void => {
  if (value === undefined) return;
  if (typeof value !== 'string' || value === '') {
    throw new Error(miss(by, 'registerAdapter', 'signIn.account', 'a non-empty string, naming a field the schema describes'));
  }
  const properties = schema['properties'];
  if (!right(properties, 'object') || !(value in (properties as Record<string, unknown>))) {
    throw new Error(miss(by, 'registerAdapter', value, 'a field the schema describes, so the account is kept in the record'));
  }
  if (isSecret((properties as Record<string, unknown>)[value])) {
    throw new Error(miss(by, 'registerAdapter', value, 'a field the schema does not mark secret, so the account is kept in the record'));
  }
};

/**
 * Check one `registerAdapter` value against `Adapter`, and answer its name and
 * its schemas' gaps.
 *
 * The name is a slug and the schema an object, because those are the two the
 * host acts on: the name is what every stored connector carries, and the
 * schema is what a client draws and what a connector's own config is checked
 * against. The capabilities are read for their shape and for their path: a
 * client lists them, and an `action` runs through `run`, which an adapter may
 * leave out when it has none. Each capability's `input` is a form of its own,
 * so it is walked under a name that says which capability it is.
 */
export const checkAdapter = (value: unknown, by: string): { name: string; checked: CheckedSchema[] } => {
  const object = asObject(value, by, 'registerAdapter', 'adapter');
  for (const member of ['name', 'title', 'description']) stringy(object, member, by, 'registerAdapter');
  const name = object.name as string;
  if (!isRecordSlug(name)) {
    throw new Error(miss(by, 'registerAdapter', name, `a slug, ${RECORD_SLUG}`));
  }
  if (!right(object.schema, 'object')) {
    throw new Error(miss(by, 'registerAdapter', 'schema', 'an object, the JSON Schema a client draws the form from'));
  }
  checkSignIn(object.signIn, object.schema as Record<string, unknown>, by);
  const checked: CheckedSchema[] = [{ where: `adapter ${name}`, gaps: schemaProblems(object.schema) }];
  if (!Array.isArray(object.capabilities)) {
    throw new Error(miss(by, 'registerAdapter', 'capabilities', 'a list of the capabilities a connector of this adapter has'));
  }
  for (const held of object.capabilities) {
    const capability = asObject(held, by, 'registerAdapter', 'a capability');
    for (const member of ['type', 'name', 'title', 'description']) stringy(capability, member, by, 'registerAdapter');
    if (capability.input !== undefined && !right(capability.input, 'object')) {
      throw new Error(miss(by, 'registerAdapter', 'input', 'an object, the JSON Schema a client draws the form from, or nothing'));
    }
    if (capability.input !== undefined) {
      checked.push({ where: `adapter ${name} capability ${capability.name as string} input`, gaps: schemaGaps(capability.input) });
    }
    /*
     * A path is where a client sends a call, so only a `receive` capability
     * may carry one, and it is an absolute path on the daemon's HTTP root.
     * Any other type with a path is a client pointed at a URL nothing answers.
     */
    if (capability.path !== undefined) {
      if (capability.type !== 'receive') {
        throw new Error(miss(by, 'registerAdapter', 'path', `a path only on a receive capability, and ${String(capability.name)} is a ${String(capability.type)}`));
      }
      if (typeof capability.path !== 'string' || !capability.path.startsWith('/')) {
        throw new Error(miss(by, 'registerAdapter', 'path', 'a path that starts with /, such as /plugins/webhook/{id}'));
      }
    }
  }
  if (typeof object.open !== 'function') {
    throw new Error(miss(by, 'registerAdapter', 'open', 'a function answering how to close the connector, or nothing'));
  }
  checkIcons(object.icons, by);
  // An adapter that runs an action says how; one that cannot says nothing, and
  // then no action of it is ever offered as a tool.
  if (object.run !== undefined && typeof object.run !== 'function') {
    throw new Error(miss(by, 'registerAdapter', 'run', 'a function running one action of a connector, or nothing'));
  }
  return { name, checked };
};

/**
 * Check one `registerEngine` value against `Engine`, and answer its name and
 * its schema's gaps.
 *
 * The name is a slug and the schema an object, because those are the two the
 * host acts on: the name is what every stored record carries, and the schema is
 * what a client draws and what a record's own config is checked against. The
 * two field lists are read because a put acts on them: `hostOnly` keeps a
 * setting to the host's record, and `keyVariables` is what lets a person's
 * record set an environment variable at all.
 */
export const checkEngine = (value: unknown, by: string): { name: string; checked: CheckedSchema[] } => {
  const object = asObject(value, by, 'registerEngine', 'engine');
  for (const member of ['name', 'title', 'description']) stringy(object, member, by, 'registerEngine');
  const name = object.name as string;
  if (!isRecordSlug(name)) {
    throw new Error(miss(by, 'registerEngine', name, `a slug, ${RECORD_SLUG}`));
  }
  if (!right(object.schema, 'object')) {
    throw new Error(miss(by, 'registerEngine', 'schema', 'an object, the JSON Schema a client draws the form from'));
  }
  const names = (member: 'hostOnly' | 'keyVariables'): void => {
    const held = object[member];
    if (held === undefined) return;
    if (!Array.isArray(held) || held.some((one) => typeof one !== 'string' || one === '')) {
      throw new Error(miss(by, 'registerEngine', member, 'a list of field or variable names, or nothing'));
    }
  };
  names('hostOnly');
  names('keyVariables');
  if (object.templates !== undefined) {
    if (!Array.isArray(object.templates)) {
      throw new Error(miss(by, 'registerEngine', 'templates', 'a list of templates, or nothing'));
    }
    for (const held of object.templates) {
      const template = asObject(held, by, 'registerEngine', 'a template');
      stringy(template, 'name', by, 'registerEngine');
      for (const member of ['description', 'model']) {
        if (template[member] !== undefined && typeof template[member] !== 'string') {
          throw new Error(miss(by, 'registerEngine', member, 'a string, or nothing'));
        }
      }
      if (template.config !== undefined && !right(template.config, 'object')) {
        throw new Error(miss(by, 'registerEngine', 'config', 'an object, or nothing'));
      }
      if (template.icon !== undefined) checkIcons([template.icon], by, 'registerEngine');
    }
  }
  checkIcons(object.icons, by, 'registerEngine');
  if (typeof object.open !== 'function') {
    throw new Error(miss(by, 'registerEngine', 'open', 'a function building the backend for one record'));
  }
  return { name, checked: [{ where: `engine ${name}`, gaps: schemaProblems(object.schema) }] };
};
