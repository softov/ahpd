import { isAbsolute, resolve } from 'node:path';
import { Status, idOf } from '../sessions/catalog.js';
import { localPath, uriOf } from '../resources/fileuri.js';
import { flag, optional, required, when } from '../utils/toolinput.js';
import { chatIdFor } from '../host/channels.js';
import type { HostTool, SendMessageRequest, SessionlessToolCall, ToolCall } from '../types/host.js';
import type { ToolDefinition } from '@microsoft/agent-host-protocol';
import type { Summary } from '../types/catalog.js';
import type { Bag } from '../types/common.js';
import type { Grant } from '../types/users.js';

/**
 * The tools an agent gets for the host it runs in, under VS Code's names.
 *
 * `serverToolNames.ts` in the reference host names nine, and its
 * `sessionServerTools.ts` says what each takes and answers. The names, the
 * input schemas and the answer shapes are copied rather than redesigned, so a
 * prompt or a skill written against that host calls these and gets the same
 * thing back: `list_sessions` answers `{ sessions: [...] }` with the same
 * keys, `send_message` answers which message it queued or started, under the
 * same id and revision, and a link is `agent-host-session://<provider>/<id>`,
 * which its window opens.
 *
 * Every tool acts through `ToolCall`, which is what the host lets a tool see
 * and do; nothing here reaches past it. Confirmation is the backend's: these
 * are MCP tools to the model, and the ones that write are marked
 * `destructiveHint` so a permission mode that asks, asks.
 */

const LINK = 'agent-host-session';

/** The clickable spelling of a session, or of one chat in it. */
export const openLink = (session: string, provider: string, chatId?: string): string =>
  `${LINK}://${provider}/${idOf(session)}${chatId !== undefined ? `?chat=${encodeURIComponent(chatId)}` : ''}`;

/**
 * The session a tool named, by its URI or by an `agent-host-session://` link.
 *
 * A link carries the provider and the id; a row is matched on both, whichever
 * scheme it is under - a session this host started is `ahp-session:/` and one
 * read off a backend's disk is `<provider>:/`, and both are the same id to the
 * client that opens them. `?chat=` names one chat in it.
 */
export const sessionMeant = (asked: string, rows: Summary[]): { session: Summary; chatId?: string } | undefined => {
  const link = /^agent-host-session:\/\/([^/?#]+)\/([^?#]+)(?:\?([^#]*))?/i.exec(asked);
  if (link !== null) {
    const id = decodeURIComponent(link[2] ?? '');
    const chat = /(?:^|&)chat=([^&]*)/.exec(link[3] ?? '')?.[1];
    const row = rows.find((one) => idOf(one.resource) === id && one.provider === link[1]);
    return row === undefined ? undefined : { session: row, ...(chat ? { chatId: decodeURIComponent(chat) } : {}) };
  }
  const row = rows.find((one) => one.resource === asked);
  return row === undefined ? undefined : { session: row };
};

/**
 * A session's settings, as the object a backend's schema is checked against.
 *
 * A tool's input arrives as JSON, so anything that is not an object - a
 * string, a number, a list - is refused here rather than handed to a
 * backend as settings it cannot read. An absent value and a null both mean
 * none were asked for.
 */
const settingsOf = (value: unknown, tool: string): Record<string, unknown> | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Invalid ${tool} input: config must be an object.`);
  return value as Record<string, unknown>;
};

/** A title fit to keep: non-blank, two hundred characters at most, one space between words. */
const titled = (value: unknown, tool: string): string => {
  const title = required(value, 'title', tool).trim().replace(/\s+/g, ' ');
  if (Array.from(title).length > 200) throw new Error(`Invalid ${tool} input: title must not exceed 200 characters.`);
  return title;
};

/**
 * The status words a row answers to, from its bits.
 *
 * `inputNeeded` is a superset of `inProgress`, so it is matched whole first;
 * `error` and `archived` ride alongside whichever activity is set.
 */
export const statusWords = (status: number): string[] => {
  const words: string[] = [];
  if ((status & Status.InputNeeded) === Status.InputNeeded) words.push('inputNeeded');
  else if (status & Status.InProgress) words.push('inProgress');
  else if (status & Status.Idle) words.push('idle');
  if (status & Status.Error) words.push('error');
  if (status & Status.IsArchived) words.push('archived');
  return words;
};

const meta = (row: Summary, key: string): Bag => {
  const held = (row as { _meta?: Bag })._meta?.[key];
  return typeof held === 'object' && held !== null && !Array.isArray(held) ? held as Bag : {};
};
const pick = (from: Bag, pairs: [string, string][]): Bag | undefined => {
  const out: Bag = {};
  for (const [theirs, ours] of pairs) if (from[theirs] !== undefined) out[ours] = from[theirs];
  return Object.keys(out).length > 0 ? out : undefined;
};

/**
 * The chats of a row, the way `list_sessions` answers them.
 *
 * A row lists its chats only when one of them is nested: a session whose only
 * chat is the default one is that chat, and repeating it says nothing. A
 * tool's chat and a hidden one are not a person's to pick, so they are left
 * out of the list, as the reference host leaves them out of its own.
 */
const serializeChats = (row: Summary): Bag[] | undefined => {
  const chats = (row.chats ?? []).filter((chat) =>
    (chat.origin as Bag | undefined)?.['kind'] !== 'tool' && chat.interactivity !== 'hidden');
  if (!chats.some((chat) => chat.resource !== row.defaultChat)) return undefined;
  return chats.map((chat) => {
    const main = row.defaultChat !== undefined && chat.resource === row.defaultChat;
    const words = chat.status === undefined ? [] : statusWords(chat.status);
    return {
      title: chat.title,
      openLink: openLink(row.resource, row.provider, main ? undefined : idOf(chat.resource)),
      ...(main ? { main: true } : {}),
      ...(words.length > 0 ? { status: words.join(',') } : {}),
      ...(chat.provider !== undefined && chat.provider !== row.provider ? { harness: chat.provider } : {}),
    };
  });
};

/** One row, the way `list_sessions` answers it. */
export const serializeSession = (row: Summary): Bag => {
  const extra = row as Summary & {
    activity?: string;
    project?: { uri: string; displayName: string };
    changes?: Bag;
    changesets?: Bag[];
  };
  const git = pick(meta(row, 'git'), [
    ['branchName', 'branch'], ['baseBranchName', 'baseBranch'], ['upstreamBranchName', 'upstreamBranch'],
    ['outgoingChanges', 'ahead'], ['incomingChanges', 'behind'], ['uncommittedChanges', 'uncommittedChanges'],
  ]);
  const found = meta(row, 'github');
  const pulls = Array.isArray(found.pullRequestUrls) ? found.pullRequestUrls.filter((one): one is string => typeof one === 'string') : [];
  const github = pick({ ...found, ...(pulls[0] !== undefined ? { pullRequestUrl: pulls[0] } : {}) }, [
    ['owner', 'owner'], ['repo', 'repo'], ['pullRequestUrl', 'pullRequestUrl'],
  ]);
  const words = statusWords(row.status);
  const chats = serializeChats(row);
  return {
    session: row.resource,
    openLink: openLink(row.resource, row.provider),
    agent: row.provider,
    title: row.title,
    status: words.length > 0 ? words.join(',') : 'unknown',
    ...(extra.activity !== undefined ? { activity: extra.activity } : {}),
    ...(row.workingDirectories[0] !== undefined ? { workingDirectory: row.workingDirectories[0] } : {}),
    ...(row.workingDirectories.length > 1 ? { workingDirectories: row.workingDirectories } : {}),
    ...(extra.project !== undefined ? { project: extra.project.displayName, projectUri: extra.project.uri } : {}),
    ...((row.status & Status.IsRead) === 0 ? { unread: true } : {}),
    createdAt: row.createdAt,
    modifiedAt: row.modifiedAt,
    ...(extra.changes !== undefined ? { changes: extra.changes } : {}),
    ...(extra.changesets !== undefined ? { changesets: extra.changesets } : {}),
    ...(git !== undefined ? { git } : {}),
    ...(github !== undefined ? { github } : {}),
    ...(chats !== undefined ? { chats } : {}),
  };
};

/**
 * The rows `list_sessions` keeps, under its filters, newest first.
 *
 * A caller that names `session` gets that row alone and no filters are read,
 * as it is a lookup by identity rather than a search. Everything else is a
 * search: `title` and `path` match a part of the text in any case, `agent` is
 * the provider id exactly, and the two `modified` bounds are inclusive, as the
 * `created` ones are.
 */
export const filterSessions = (rows: Summary[], args: Bag, tool = 'list_sessions'): Summary[] => {
  const direct = optional(args.session, 'session', tool);
  if (direct !== undefined) {
    const found = sessionMeant(direct, rows);
    return found === undefined ? [] : [found.session];
  }
  const status = Array.isArray(args.status)
    ? new Set(args.status.filter((one): one is string => typeof one === 'string'))
    : undefined;
  const workspace = optional(args.workspace, 'workspace', tool);
  const agent = optional(args.agent, 'agent', tool);
  const title = optional(args.title, 'title', tool)?.toLowerCase();
  const path = optional(args.path, 'path', tool)?.toLowerCase();
  const withChanges = flag(args.withChanges, 'withChanges', tool);
  const unread = flag(args.unread, 'unread', tool);
  const withPullRequest = flag(args.withPullRequest, 'withPullRequest', tool);
  const includeArchived = flag(args.includeArchived, 'includeArchived', tool);
  const after = when(args.createdAfter, 'createdAfter', tool);
  const before = when(args.createdBefore, 'createdBefore', tool);
  const changedAfter = when(args.modifiedAfter, 'modifiedAfter', tool);
  const changedBefore = when(args.modifiedBefore, 'modifiedBefore', tool);
  const bare = (value: string): string => localPath(value).replace(/\/+$/, '').toLowerCase();
  const kept = rows.filter((row) => {
    const words = statusWords(row.status);
    if (status !== undefined && !words.some((word) => status.has(word))) return false;
    if (workspace !== undefined) {
      const extra = row as Summary & { project?: { uri: string; displayName: string } };
      const names = [
        ...(extra.project !== undefined ? [extra.project.displayName.toLowerCase(), bare(extra.project.uri)] : []),
        ...row.workingDirectories.map(bare),
      ];
      if (!names.includes(workspace.toLowerCase()) && !names.includes(bare(workspace))) return false;
    }
    if (agent !== undefined && row.provider !== agent) return false;
    if (title !== undefined && !row.title.toLowerCase().includes(title)) return false;
    if (path !== undefined && !row.workingDirectories.some((one) => bare(one).includes(bare(path)))) return false;
    if (withChanges === true) {
      const changes = (row as Summary & { changes?: { files?: unknown } }).changes;
      if (typeof changes?.files !== 'number' || changes.files === 0) return false;
    }
    if (unread === true && (row.status & Status.IsRead) !== 0) return false;
    if (withPullRequest === true) {
      const pulls = meta(row, 'github').pullRequestUrls;
      if (!Array.isArray(pulls) || pulls.length === 0) return false;
    }
    if (includeArchived !== true && !status?.has('archived') && (row.status & Status.IsArchived) !== 0) return false;
    const born = Date.parse(row.createdAt);
    if (after !== undefined && born < after) return false;
    if (before !== undefined && born > before) return false;
    const changed = Date.parse(row.modifiedAt);
    if (changedAfter !== undefined && changed < changedAfter) return false;
    if (changedBefore !== undefined && changed > changedBefore) return false;
    return true;
  });
  /*
   * Newest first by the time the row changed; two rows changed in the same
   * millisecond keep the order the catalogue gave them, so one listing is the
   * same as the next.
   */
  const changedAt = (one: Summary): number => {
    const at = Date.parse(one.modifiedAt);
    return Number.isNaN(at) ? 0 : at;
  };
  return kept
    .map((row, index) => ({ row, index }))
    .sort((one, other) => changedAt(other.row) - changedAt(one.row) || one.index - other.index)
    .map((one) => one.row);
};

/** The caps `get_session_context` cuts text to, per level of detail. */
const CAPS = {
  summary: { user: 160, assistant: 140, toolInput: 0 },
  digest: { user: 300, assistant: 800, toolInput: 0 },
  full: { user: 1000, assistant: 2000, toolInput: 200 },
} as const;
type Detail = keyof typeof CAPS;

const textOf = (message: unknown): string => {
  const held = typeof message === 'object' && message !== null ? message as { text?: unknown } : {};
  return typeof held.text === 'string' ? held.text : '';
};
const partsOf = (turn: Bag): Bag[] => (Array.isArray(turn.responseParts) ? turn.responseParts : []) as Bag[];
const inlineInput = (input: unknown): string => {
  if (typeof input === 'string') return input;
  if (typeof input !== 'object' || input === null) return '';
  const held = input as { inlineText?: unknown; text?: unknown; command?: unknown };
  const said = held.inlineText ?? held.text ?? held.command;
  return typeof said === 'string' ? said : JSON.stringify(input);
};

/** A chat's turns, cut to what a level of detail says, the way upstream serialises them. */
export const serializeContext = (
  session: Summary,
  chatId: string | undefined,
  snapshot: { turns: Bag[]; activeTurn?: Bag; hasMoreHistory: boolean },
  detail: Detail,
  limit: number,
): Bag => {
  const caps = CAPS[detail];
  let truncated = false;
  const cut = (text: string, max: number): string | undefined => {
    if (max <= 0) return undefined;
    const trimmed = text.trim();
    if (trimmed === '') return undefined;
    if (trimmed.length <= max) return trimmed;
    truncated = true;
    return `${trimmed.slice(0, Math.max(0, max - 1))}…`;
  };
  const entries = [...snapshot.turns.map((turn) => ({ turn, state: String(turn.state ?? 'complete') }))];
  if (snapshot.activeTurn !== undefined) entries.push({ turn: snapshot.activeTurn, state: 'inProgress' });
  if (entries.length > limit) truncated = true;
  const start = Math.max(0, entries.length - limit);
  const transcript = entries.slice(start).map((entry, index) => {
    const parts = partsOf(entry.turn);
    const user = cut(textOf(entry.turn.message), caps.user);
    const assistant = cut(
      parts.filter((part) => part.kind === 'markdown').map((part) => String(part.content ?? '')).join(''),
      caps.assistant,
    );
    const calls = parts.filter((part) => part.kind === 'toolCall').map((part) => (part.toolCall ?? {}) as Bag);
    const toolCalls = detail === 'summary' || calls.length === 0 ? undefined : calls.map((call) => {
      const name = String(call.toolName ?? 'tool');
      if (caps.toolInput <= 0) return name;
      const input = cut(call.status === 'streaming' ? '' : inlineInput(call.toolInput), caps.toolInput);
      return input === undefined ? { name } : { name, input };
    });
    const state = entry.state === 'complete' || entry.state === 'cancelled' || entry.state === 'error'
      ? entry.state : 'inProgress';
    return {
      turn: start + index + 1,
      state,
      ...(user !== undefined ? { user } : {}),
      ...(assistant !== undefined ? { assistant } : {}),
      ...(toolCalls !== undefined ? { toolCalls } : {}),
    };
  });
  return {
    session: session.resource,
    openLink: openLink(session.resource, session.provider, chatId),
    detail,
    transcript,
    hasMoreHistory: snapshot.hasMoreHistory,
    truncated,
  };
};

/**
 * A call from either place a tool runs: a chat, or a person with no session.
 *
 * All the host's answers a tool reads - the catalogue, the models, a chat's
 * conversation - are the same either way; which one it was is asked of the
 * session the call names, where it names one.
 */
type AnyToolCall = ToolCall | SessionlessToolCall;

/**
 * Where a message came from, in the reference client's spelling.
 *
 * A call with no session behind it has no chat to name as the source, so it
 * carries the origin alone: there is nothing a window could open the message
 * from, and a source it never had would be one it could not.
 */
const delegated = (at: AnyToolCall, messageId?: string, revision?: number): Bag => ({
  origin: { kind: 'agent' },
  ...(at.session === undefined || at.chat === undefined ? {} : {
    _meta: {
      'vscode.chat.delegation': {
        sourceSession: at.session,
        sourceChat: at.chat,
        ...(at.turn() !== undefined ? { sourceTurnId: at.turn() } : {}),
        ...(messageId === undefined ? {} : { messageId, revision }),
      },
    },
  }),
});

/** A positive integer, or a refusal naming the tool and the field. */
const positive = (value: unknown, field: string, tool: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1)
    throw new Error(`Invalid ${tool} input: ${field} must be a positive integer.`);
  return value;
};

/** The row of the calling session, from the catalogue; nothing when there is none. */
const self = async (at: AnyToolCall): Promise<Summary | undefined> =>
  (await at.sessions()).find((row) => row.resource === at.session);

const known = async (at: AnyToolCall, asked: string, tool: string): Promise<{ session: Summary; chatId?: string }> => {
  const found = sessionMeant(asked, await at.sessions());
  if (found === undefined)
    throw new Error(`Invalid ${tool} input: session must match the URI of a known session (see list_sessions).`);
  return found;
};

/**
 * Refuse a call the turn's person may not make here, in the host's own words.
 *
 * `ToolCall.refusal` is what a client is told on the wire when it is missing a
 * grant - `refusalReason`, or the turn itself where nobody sent it - and a tool
 * is refused the same way in the same sentence rather than in one of its own:
 * a model that read "may not session:write here" is being told the same thing
 * a window is, and one wording cannot drift from the other. A host with no
 * users directory refuses nothing and this passes everything, which is what the
 * tools did before there was anybody to ask.
 */
const allowed = (at: AnyToolCall, grant: Grant): void => {
  if (!at.may(grant)) throw new Error(at.refusal(grant));
};

/**
 * The session a tool is about, when the call itself has to be the one.
 *
 * A tool that runs from a session and from a person has no session to fall
 * back on in the second place, so the caller has to name one and this says so
 * in words a model can act on. It is also what says a chat-only tool cannot be
 * called by a window that is not in a chat.
 */
const sessionOf = (at: AnyToolCall, tool: string, hint: string): string => {
  if (at.session === undefined)
    throw new Error(`Invalid ${tool} input: session is required when there is no calling session. ${hint}`);
  return at.session;
};

/** A model by id or by name, and the provider it belongs to. */
const modelMeant = (at: AnyToolCall, asked: string | undefined, tool: string, provider?: string): { id: string; provider: string } | undefined => {
  if (asked === undefined) return undefined;
  const pool = at.models().filter((one) => provider === undefined || one.provider === provider);
  const found = pool.find((one) => one.id === asked) ?? pool.find((one) => one.name.toLowerCase() === asked.toLowerCase());
  if (found === undefined) throw new Error(`Invalid ${tool} input: model "${asked}" is not one this host offers${provider ? ` for ${provider}` : ''}. See list_models for the models an agent offers.`);
  return { id: found.id, provider: found.provider };
};

/**
 * An absolute path or a `file://` URI, as a path; nothing for anything else.
 *
 * Resolved, because a model writes `..` and the host says back and writes down
 * one folder under one name: `/repo/../elsewhere` is `/elsewhere`, and a path
 * that keeps its `..` is compared against a window's trusted folders as the
 * text it was written as rather than as the folder it names. By this host's
 * rules, so a Windows host takes `C:\repo` and its URI, which POSIX rules
 * refused or resolved against the current folder.
 */
const pathOf = (value: string): string | undefined => {
  const path = value.startsWith('file://') ? localPath(value) : value;
  return path !== '' && isAbsolute(path) ? resolve(path) : undefined;
};

/**
 * The directory `create_session` meant, the way upstream resolves one.
 *
 * A directory a known session works in or a project's URI, matched exactly;
 * a project's name, when exactly one project has it; otherwise the path or
 * URI as given, which is a directory this host has to serve.
 */
const workspaceMeant = (asked: string, rows: Summary[], tool: string): string => {
  const parsed = pathOf(asked);
  for (const row of rows) {
    const extra = row as Summary & { project?: { uri: string; displayName: string } };
    for (const candidate of [extra.project?.uri, ...row.workingDirectories]) {
      const path = candidate === undefined ? undefined : pathOf(candidate);
      if (path !== undefined && parsed !== undefined && path === parsed) return path;
    }
  }
  const projects = new Map<string, string>();
  for (const row of rows) {
    const project = (row as Summary & { project?: { uri: string; displayName: string } }).project;
    if (project?.displayName.toLowerCase() === asked.toLowerCase()) projects.set(project.uri, project.displayName);
  }
  if (projects.size === 1) return pathOf([...projects.keys()][0] as string) ?? asked;
  if (projects.size > 1)
    throw new Error(`Invalid ${tool} input: workspace "${asked}" is ambiguous; use one of these project URIs: ${[...projects.keys()].join(', ')}.`);
  if (parsed === undefined)
    throw new Error(`Invalid ${tool} input: workspace must match a unique known project name, project URI, working directory, absolute path, or valid URI string.`);
  return parsed;
};

const LIST_STATUS = ['idle', 'inProgress', 'inputNeeded', 'error', 'archived'];

/**
 * How many models a `list_agents` row names.
 *
 * The first five the host learned for that agent, which is the order its probe
 * lists them in and the only order there is: nothing else ranks a model, and
 * the default is the one a probe names first. `list_models` has them all.
 */
const TOP_MODELS = 5;

/** What `rename_chat` does today, for a session that names its own chats. */
const RENAME_CHAT_DESCRIPTION = 'Rename one specific chat so it is easy to find later. Renaming the default chat also names its owning session, while peer-chat titles remain independent. Use a short, human-friendly chat name in sentence case (1-4 words). Pass an `agent-host-session://` session or chat link to target another chat, or omit `chat` to rename the chat in which this tool is running. Name a fresh chat once its scope is clear. Call this tool again whenever the user explicitly asks to rename the chat; every invocation replaces the current title.';

/**
 * What `rename_chat` says under a deferred strategy, from the reference host.
 *
 * A rename only when the user asks, because the host is the one naming a
 * fresh chat, and there is no `automatic` argument to carry an automatic
 * request with.
 */
const DEFERRED_RENAME_CHAT_DESCRIPTION = 'Rename one specific chat when the user explicitly asks to rename it. Automatic naming is handled by the host; do not call this tool to name a fresh chat. Renaming the default chat also names its owning session, while peer-chat titles remain independent. Use a short, human-friendly chat name in sentence case (1-4 words). Pass an `agent-host-session://` session or chat link to target another chat, or omit `chat` to rename the chat in which this tool is running. Every invocation replaces the current title.';

/** The rename arguments, which a utility strategy withholds whole and a deferred one drops `automatic` from. */
const RENAME_CHAT_PROPERTIES: Record<string, object> = {
  session: { type: 'string', description: 'Optional owning session: a session URI from `list_sessions` or an `agent-host-session://` link. When provided with `chat`, it must match that chat\'s session.' },
  chat: { type: 'string', description: 'The chat to rename: pass an `agent-host-session://` session or chat link. Omit when renaming the chat in which this tool is running.' },
  title: { type: 'string', maxLength: 200, description: 'Short, descriptive chat title, ideally 1-4 words.' },
  automatic: { type: 'boolean', description: 'Set to true only when this call is fulfilling the host\'s automatic title reminder. Omit for user-requested renames.' },
};

/**
 * `create_session`'s `agent` input, as one caller's agents name it.
 *
 * The enum is that caller's list itself, so an agent it may not start cannot
 * be named, and the description gives each id the name a person reads, one per
 * line, as Claude Code's Agent tool names its agent types. The last sentence
 * points at `list_models` for the models behind each id.
 */
const agentInput = (agents: { provider: string; name: string }[]): object => ({
  type: 'string',
  enum: agents.map((one) => one.provider),
  description: `Optional provider id of the agent to run. Defaults to the model's provider, then the current chat's. \`list_models\` names the models each agent offers.${agents.length === 0 ? '' : `\n${agents.map((one) => `${one.provider}: ${one.name}`).join('\n')}`}`,
});

/** `create_session`'s definition, before one caller's agents are named in its `agent` input. */
const CREATE_SESSION: ToolDefinition = {
  name: 'create_session',
  title: 'Create Session',
  description: 'Create delegated work and start it with an initial prompt, either in a new chat sharing the current session\'s workspace, lifecycle, and aggregate diff, or in an independent session. Only supply `worktree` when the user explicitly requests working with or without a new worktree; never combine it with `currentSession`.',
  inputSchema: {
    type: 'object',
    properties: {
      relationship: { type: 'string', enum: ['currentSession', 'independent'], description: 'Whether this work belongs to the current session or is independently managed. Use `currentSession` for tasks from the current plan or deliverable, including parallel or delegated tasks, unless the user explicitly requests a worktree. Use `independent` for a separate deliverable that needs its own workspace, provider, or top-level lifecycle, or for an explicitly requested worktree.' },
      prompt: { type: 'string', description: 'Initial prompt to send to the new session.' },
      workspace: { type: 'string', description: 'For `independent` work: unique project name, project/workspace URI, absolute folder path, or working directory from an existing session. Required for `independent` and invalid for `currentSession`.' },
      worktree: { type: 'boolean', description: 'Override isolation for the new independent session. Set true only when the user explicitly asks to create a worktree, or false only when the user explicitly asks to work without one. Omit to preserve the existing isolation behavior: inherit the creating session\'s isolation for the same project, otherwise use worktree isolation. Only valid with relationship `independent`; omit for `currentSession`.' },
      title: { type: 'string', maxLength: 200, description: 'Short title for the new chat or independent session.' },
      model: { type: 'string', description: 'Optional model ID or display name. Defaults to the current chat\'s model. For `currentSession`, the model must belong to the current session\'s provider; for `independent`, the model selects the new session\'s provider.' },
      agent: { type: 'string', description: 'Optional provider id of the agent to run, such as one `list_sessions` shows. Defaults to the model\'s provider, then the current chat\'s.' },
      config: { type: 'object', description: 'Optional settings for the new session, as the agent\'s config schema names them. Defaults to what the current chat\'s agent says a new chat inherits.' },
    },
    required: ['relationship', 'prompt', 'title'],
  },
  annotations: { title: 'Create Session', readOnlyHint: false, destructiveHint: true },
};

/**
 * The reasons the host refuses a move, in the sentences the reference host
 * answers a model with.
 *
 * `moveChat` refuses in the protocol's words, for a client to explain to a
 * person; a tool says the same thing to a model in VS Code's words, picked by
 * the `reason` the refusal carries. A reason not listed here keeps the host's
 * own sentence, which is the only one there is for it.
 * https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/shared/sessionMoveTools.ts#L197-L225
 */
const MOVE_REFUSALS: Record<string, string> = {
  disabled: 'Moving sessions is turned off; tell the user it needs the `chat.agentHost.moveChats.enabled` setting.',
  notMovable: 'This can\'t be moved: a main session, a subagent\'s chat or a hidden chat stays in its session; to move a whole session, pass its link without a chat id.',
  destinationNotFound: 'The destination session wasn\'t found, can\'t be opened, or is the session itself; check it with `list_sessions`.',
  invalidAnchor: '`after` must name another nested session or the main session of `into`; check it with `list_sessions`, or omit `after` to place it at the end.',
  differentProvider: 'Sessions only move between sessions of the same agent; pick a destination session that uses the same agent.',
  sessionArchived: 'One of the sessions is archived; ask the user to unarchive it first.',
  sessionQuarantined: 'One of the sessions is changing its workspace or can\'t run turns; try again after that finishes.',
  workspaceless: 'This can\'t be moved: its folder is also used by a nested session that stays behind, or it has no folder; move those nested sessions too, or leave this one.',
  notStarted: 'This session has no messages yet; it can be moved after its first message.',
};

/** A whole session this host will not move, said as the reference says it. */
const SESSION_NOT_MOVABLE = 'This session can\'t be moved: it couldn\'t be opened or is no longer a session of its own; check it with `list_sessions` and try again.';

/**
 * A refused move said in a model's words, or the refusal itself where its
 * reason is not one the reference names.
 */
const moveRefused = (error: unknown, wholeSession: boolean): unknown => {
  const data = typeof error === 'object' && error !== null ? (error as { data?: unknown }).data : undefined;
  const reason = typeof data === 'object' && data !== null ? (data as { reason?: unknown }).reason : undefined;
  if (typeof reason !== 'string') return error;
  const sentence = reason === 'notMovable' && wholeSession ? SESSION_NOT_MOVABLE : MOVE_REFUSALS[reason];
  return sentence === undefined ? error : new Error(`Cannot move: ${sentence}`);
};

/** VS Code's session tools, in its order. */
export const sessionTools = (): HostTool[] => [
  {
    definition: {
      name: 'list_sessions',
      title: 'List Sessions',
      description: 'List sessions and their compact metadata (status, activity, working directory, project, worktree changes, git/GitHub info, timestamps). Each result includes `session` for identity and tool inputs and `openLink` for clickable Markdown links; do not use `session` as a link target. A session with nested sessions also lists `chats`: its main session (`main: true`) and its nested sessions in order, each with a `title` and an `openLink` that names that chat in `send_message`, `get_session_context`, `rename_chat` and `archive_chat`. Pass `session` to fetch a single known session by URI. By default archived sessions are omitted. Optionally filter by `status`, `workspace`, `agent`, `title`, `path`, `withChanges`, `unread`, `withPullRequest`, `includeArchived`, `createdAfter`, `createdBefore`, `modifiedAfter`, or `modifiedBefore`. Rows are answered newest first by `modifiedAt`; pass `limit` for only the newest ones, and the answer says `truncated: true` when the limit cut rows.',
      inputSchema: {
        type: 'object',
        properties: {
          session: { type: 'string', description: 'Return only the session with this URI or `agent-host-session://` link (a direct lookup that ignores the other filters). Use this to fetch one known session\'s metadata.' },
          status: { type: 'array', items: { type: 'string', enum: LIST_STATUS }, description: 'Only return sessions whose status matches one of these (e.g. `inputNeeded` for sessions awaiting a reply, `inProgress` for running ones, `archived` for sessions marked Done/completed, which implies `includeArchived`). Omit to return every status.' },
          workspace: { type: 'string', description: 'Only return sessions for this project name, project URI, or working directory path/URI.' },
          agent: { type: 'string', description: 'Only return sessions of this agent: the provider id a row answers as `agent`, matched exactly.' },
          title: { type: 'string', description: 'Only return sessions whose title contains this text, in any case.' },
          path: { type: 'string', description: 'Only return sessions with a working directory that contains this text, in any case.' },
          withChanges: { type: 'boolean', description: 'When true, only return sessions that have pending worktree changes.' },
          unread: { type: 'boolean', description: 'When true, only return sessions with updates the user has not seen yet.' },
          withPullRequest: { type: 'boolean', description: 'When true, only return sessions that have a linked GitHub pull request.' },
          includeArchived: { type: 'boolean', description: 'Whether to include archived sessions. Defaults to false; set true to also return archived sessions.' },
          createdAfter: { type: 'string', description: 'Only return sessions created at or after this time (ISO-8601 timestamp, e.g. `2025-01-31T00:00:00Z`).' },
          createdBefore: { type: 'string', description: 'Only return sessions created at or before this time (ISO-8601 timestamp).' },
          modifiedAfter: { type: 'string', description: 'Only return sessions last modified at or after this time (ISO-8601 timestamp).' },
          modifiedBefore: { type: 'string', description: 'Only return sessions last modified at or before this time (ISO-8601 timestamp).' },
          limit: { type: 'number', description: 'Maximum number of rows to return, the newest first. All matching rows are returned when omitted, and the answer says `truncated: true` when the limit cut some.' },
        },
      },
      annotations: { title: 'List Sessions', readOnlyHint: true, openWorldHint: false },
    },
    /*
     * The one tool a person with no session reaches first, and the only one
     * they need to name a session for anything else. The catalogue is already
     * cut down to what this call's person may read, so no grant is asked for
     * when it runs - what the grant here decides is whether they are offered
     * the tool at all, which is what a window that may not read gets.
     */
    sessionless: true,
    grant: 'session:read',
    run: async (input, at) => {
      const tool = 'list_sessions';
      const found = filterSessions(await at.sessions(), input, tool);
      const asked = input.limit;
      if (asked !== undefined && (typeof asked !== 'number' || !Number.isFinite(asked) || asked < 1))
        throw new Error(`Invalid ${tool} input: limit must be a positive number.`);
      const kept = asked === undefined ? found : found.slice(0, Math.floor(asked));
      /*
       * A limited answer says it was cut, as `get_session_context` says a
       * transcript was, so a model does not read a cut list as the whole of
       * what matched and stop looking.
       */
      return JSON.stringify({
        sessions: kept.map(serializeSession),
        ...(kept.length < found.length ? { truncated: true } : {}),
      });
    },
  },
  {
    definition: {
      name: 'list_agents',
      title: 'List Agents',
      description: 'List the agents a new session may be started on, each with the `agent` id `create_session` and `list_sessions` take, the name a person reads, the settings its `config` accepts, and its first five models. Use this before `create_session` to choose the agent, its model and its settings.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'List Agents', readOnlyHint: true, openWorldHint: false },
    },
    /*
     * A reader, cut to what this call's person may start: the list is built
     * for the caller, so an agent held by somebody else is not named.
     */
    sessionless: true,
    grant: 'session:read',
    run: (_input, at) => {
      const models = at.models();
      return JSON.stringify({
        agents: at.agents().map((one) => ({
          agent: one.provider,
          name: one.name,
          config: one.schema,
          models: models.filter((model) => model.provider === one.provider).slice(0, TOP_MODELS)
            .map((model) => ({ id: model.id, name: model.name })),
        })),
      });
    },
  },
  {
    definition: {
      name: 'list_models',
      title: 'List Models',
      description: 'List the models the agents offer, in the order the host learned them. Pass `agent` for one agent\'s models; omit it for every agent\'s. Each model answers the `id` and `name` that `create_session` and `create_chat` take as `model`, under the `agent` it belongs to.',
      inputSchema: {
        type: 'object',
        properties: {
          agent: { type: 'string', description: 'Only return this agent\'s models: a provider id from `list_agents`. Omit to return every agent\'s.' },
        },
      },
      annotations: { title: 'List Models', readOnlyHint: true, openWorldHint: false },
    },
    sessionless: true,
    grant: 'session:read',
    run: (input, at) => {
      const tool = 'list_models';
      const asked = optional(input.agent, 'agent', tool);
      const agents = at.agents();
      if (asked !== undefined && !agents.some((one) => one.provider === asked))
        throw new Error(`Invalid ${tool} input: agent "${asked}" is not one this host offers${agents.length > 0 ? `; it offers ${agents.map((one) => one.provider).join(', ')}` : ''}.`);
      const models = at.models();
      const named = asked === undefined ? agents : agents.filter((one) => one.provider === asked);
      return JSON.stringify({
        agents: named.map((one) => ({
          agent: one.provider,
          models: models.filter((model) => model.provider === one.provider).map((model) => ({ id: model.id, name: model.name })),
        })),
      });
    },
  },
  {
    definition: {
      name: 'get_current_session',
      title: 'Get Current Session',
      description: 'Get metadata and the open link for the session this conversation is running in. Use this to reference the current session (for example before adding a chat to it).',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'Get Current Session', readOnlyHint: true, openWorldHint: false },
    },
    run: async (_input, at) => {
      allowed(at, 'session:read');
      const row = await self(at);
      return JSON.stringify({
        session: at.session,
        openLink: openLink(at.session, row?.provider ?? 'claude'),
        ...(row !== undefined ? serializeSession(row) : {}),
      });
    },
  },
  {
    definition: {
      name: 'set_workspace',
      title: 'Set Workspace',
      description: 'Set the current chat\'s workspace while preserving its identity and history. If a workspace is already attached, use this tool only when the user explicitly asks to change this chat\'s workspace. Do not infer a workspace change from a file path, a request to inspect another repository, or ordinary work in the current workspace. If `isolation` is false and the requested folder is already this chat\'s effective working directory, skip this tool and the confirmation question; tell the user the chat already uses that workspace and continue normally. Compare against this chat\'s working directory, not its session\'s project root. Creating a new worktree from the same folder is a real change, not a no-op. For a workspace-less quick chat, attach a workspace only to modify its files or run commands requiring its project environment; not for self-contained scratch work on attachments, pasted/generated content, or throwaway/exportable artifacts. Other chats keep their workspaces. Set `isolation` to true for a new managed Git worktree or false to use the selected folder directly; files are not moved or copied to the selected folder. Immediately before every call, use the available user-input tool to ask one question confirming both workspace and isolation, even if already specified; tool approval is not confirmation. Make this the turn\'s final tool call and end the turn; the host changes the workspace and continues the original task automatically. Do not repeat the request.',
      inputSchema: {
        type: 'object',
        properties: {
          workspaceFolder: { type: 'string', description: 'Absolute local folder path or file URI to set as the current chat\'s workspace. Use an exact path from the user or `list_sessions`; do not guess.' },
          isolation: { type: 'boolean', description: 'Whether to create an isolated Git worktree and use it as the workspace. Include this choice in the required user confirmation immediately before calling this tool.' },
        },
        required: ['workspaceFolder', 'isolation'],
      },
      annotations: { title: 'Set Workspace', readOnlyHint: false, destructiveHint: true },
    },
    /*
     * Deferred, as VS Code's is, and offered up front to a session that
     * started workspace-less, whose first turn its instructions point at this
     * tool, as VS Code's host offers it there; it stays so after a workspace
     * is taken, since a tool list that moved would miss the prompt cache.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L300-L307
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L2255-L2258
     */
    deferLoading: true,
    forSession: ({ startedWorkspaceless }) => (startedWorkspaceless === true ? { deferLoading: false } : undefined),
    run: (input, at) => {
      const tool = 'set_workspace';
      allowed(at, 'session:write');
      if (at.turn() === undefined) throw new Error(`${tool} must run from an active chat turn.`);
      const folder = pathOf(required(input.workspaceFolder, 'workspaceFolder', tool));
      if (folder === undefined)
        throw new Error(`Invalid ${tool} input: workspaceFolder must be an absolute local path or file URI.`);
      const isolation = flag(input.isolation, 'isolation', tool);
      if (isolation === undefined) throw new Error(`Invalid ${tool} input: isolation must be a boolean.`);
      at.setWorkspace(folder, isolation);
      /*
       * Both answers name the folder as a URI, which is `uriOf`'s and not a
       * `file://` written by hand: a path may hold a `#` or a `?`, and a URI
       * that carries one raw is read as a fragment or a query - the folder
       * `a#b` becoming the folder `a` to whoever opens the link.
       */
      const named = uriOf(folder);
      return isolation
        ? `An isolated worktree will be created from ${named} and set as the workspace after this turn ends. End this turn now without calling more tools or replying; the host will continue the original task automatically in the isolated workspace.`
        : `Workspace will be set to ${named} after this turn ends. End this turn now without calling more tools or replying; the host will continue the original task automatically in the selected workspace.`;
    },
  },
  {
    definition: {
      name: 'isolate_session',
      title: 'Change Workspace to a New Worktree',
      description: 'Move only the current chat to a new Git worktree when the user wants to continue this task without changing its current checkout. This preserves the chat and its history; it does not create a separate task or move other chats, even those sharing the same folder. The session workspace will include the new worktree. The original folder is unchanged, and uncommitted edits are not copied except configured worktree include-files. Requires a chat working in one local Git folder. Follow the tool confirmation flow. Make this the final tool call and end the turn after it succeeds; the host then moves this chat and continues its task automatically. Do not poll or repeat the request.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'Change Workspace to a New Worktree', readOnlyHint: false, destructiveHint: true },
    },
    /*
     * Deferred, and for the session's own chats alone, as VS Code's is: a
     * worker chat a call spawned has no folder of its own to move. Offered
     * only where the agent keeps a folder per chat, since a session with one
     * folder moves as a whole, which is `set_workspace`'s.
     * https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/shared/sessionIsolationTools.ts#L19-L28
     */
    deferLoading: true,
    topLevelChatOnly: true,
    isEnabledForSession: ({ multipleDirectories }) => multipleDirectories === true,
    run: async (input, at) => {
      const tool = 'isolate_session';
      allowed(at, 'session:write');
      // The checks are VS Code's, in its order: a turn first, then the arguments.
      if (at.turn() === undefined)
        throw new Error('Changing a chat\'s workspace with this tool requires an active turn.');
      const args: unknown = input;
      if (typeof args !== 'object' || args === null || Array.isArray(args) || Object.keys(args).length > 0)
        throw new Error('isolate_session takes no arguments.');
      /*
       * The folder is the chat's own, which a chat this host does not hold -
       * a worker chat a call spawned - has none of.
       */
      const folders = at.workingDirectories();
      const folder = folders.length === 1 ? localPath(folders[0] ?? '') : '';
      if (folder === '')
        throw new Error(`Invalid ${tool}: it needs a chat working in one local Git folder.`);
      if (await at.isolation(folder) !== 'worktree')
        throw new Error(`Invalid ${tool}: this host cannot cut a Git worktree from ${uriOf(folder)}.`);
      at.setWorkspace(folder, true);
      return 'Moving this chat to a new worktree is scheduled. End this turn now without calling more tools or replying. The host will move only this chat to a new worktree, update the session workspace, and continue the original task automatically. Other chats remain unchanged.';
    },
  },
  {
    definition: CREATE_SESSION,
    /*
     * The `agent` input is one caller's list, so the definition is shaped for
     * the caller each time it is offered: an agent held by somebody else is
     * neither in the enum nor named in the description, and the run refuses
     * the same ids the enum holds.
     */
    forSession: (session) => {
      if (session.agents === undefined) return undefined;
      const schema = CREATE_SESSION.inputSchema ?? { type: 'object' as const, properties: {} };
      return {
        definition: {
          inputSchema: {
            ...schema,
            type: 'object' as const,
            properties: { ...schema.properties, agent: agentInput(session.agents) },
          },
        },
      };
    },
    sessionless: true,
    grant: 'session:write',
    run: async (input, at) => {
      const tool = 'create_session';
      allowed(at, 'session:write');
      const relationship = required(input.relationship, 'relationship', tool);
      if (relationship !== 'currentSession' && relationship !== 'independent')
        throw new Error(`Invalid ${tool} input: relationship must be "currentSession" or "independent".`);
      const prompt = required(input.prompt, 'prompt', tool);
      const title = titled(input.title, tool);
      const agent = optional(input.agent, 'agent', tool);
      if (agent !== undefined) {
        const offers = at.agents().map((one) => one.provider);
        if (!offers.includes(agent))
          throw new Error(`Invalid ${tool} input: agent "${agent}" is not one this host offers${offers.length > 0 ? `; it offers ${offers.join(', ')}` : ''}.`);
      }
      const config = settingsOf(input.config, tool);
      const rows = await at.sessions();
      const calling = at.session;
      const mine = calling === undefined ? undefined : rows.find((row) => row.resource === calling);
      if (relationship === 'currentSession') {
        if (calling === undefined)
          throw new Error('currentSession needs a calling session; use independent');
        if (input.workspace !== undefined || input.worktree !== undefined)
          throw new Error(`Invalid ${tool} input: workspace and worktree are only valid with relationship "independent".`);
        const model = modelMeant(at, optional(input.model, 'model', tool), tool, agent ?? mine?.provider);
        const made = await at.createChat(calling, {
          title,
          prompt,
          ...(agent !== undefined ? { provider: agent } : {}),
          ...(config !== undefined ? { config } : {}),
          ...(model ? { model: model.id } : {}),
          from: delegated(at),
        });
        return `Chat created in the current session (${openLink(calling, agent ?? mine?.provider ?? 'claude', idOf(made.chat))}).`;
      }
      const workspace = workspaceMeant(required(input.workspace, 'workspace', tool), rows, tool);
      const worktree = flag(input.worktree, 'worktree', tool);
      const model = modelMeant(at, optional(input.model, 'model', tool), tool, agent);
      /*
       * What this folder takes, as the host offers it, so a folder with no git
       * is used as it is and a worktree asked for there is refused rather than
       * quietly made a folder.
       * https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/shared/worktreeIsolation.ts
       */
      const offers = await at.isolation(workspace);
      if (worktree === true && offers === 'folder')
        throw new Error(`Invalid ${tool} input: ${workspace} is not a git repository, so it has no worktrees.`);
      // What was asked; else the caller's own arrangement for its own
      // directory, which is the folder it is in; else what the folder takes,
      // and a worktree where the host cannot say, which is what keeps two
      // sessions from editing one checkout.
      const own = mine?.workingDirectories[0] === undefined ? undefined : pathOf(mine.workingDirectories[0]);
      const isolation: 'worktree' | 'folder' = worktree !== undefined
        ? (worktree ? 'worktree' : 'folder')
        : own === workspace ? 'folder' : offers ?? 'worktree';
      const made = await at.create({
        workingDirectory: workspace,
        ...(agent !== undefined ? { provider: agent } : {}),
        ...(config !== undefined ? { config } : {}),
        ...(model ? { provider: model.provider, model: model.id } : {}),
        isolation,
        title,
        prompt,
        from: delegated(at),
      });
      return `New session created (${openLink(made.session, agent ?? model?.provider ?? mine?.provider ?? 'claude')}).`;
    },
  },
  {
    definition: {
      name: 'create_chat',
      title: 'Create Chat',
      description: 'Create a new chat in an existing session and start it with an initial prompt. The chat shares the session\'s workspace, lifecycle and aggregate diff. Omit `session` to add the chat to the session this tool runs in.',
      inputSchema: {
        type: 'object',
        properties: {
          session: { type: 'string', description: 'The session to add the chat to: a session URI from `list_sessions` or an `agent-host-session://` link. Omit for the current session.' },
          prompt: { type: 'string', description: 'Initial prompt to send to the new chat.' },
          title: { type: 'string', maxLength: 200, description: 'Short title for the new chat.' },
          model: { type: 'string', description: 'Optional model ID or display name, belonging to the session\'s provider.' },
        },
        required: ['prompt'],
      },
      annotations: { title: 'Create Chat', readOnlyHint: false, destructiveHint: true },
    },
    sessionless: true,
    grant: 'session:write',
    run: async (input, at) => {
      const tool = 'create_chat';
      allowed(at, 'session:write');
      const asked = optional(input.session, 'session', tool);
      const target = asked === undefined ? (await self(at)) : (await known(at, asked, tool)).session;
      const session = target?.resource ?? sessionOf(at, tool, 'Pass `session` from list_sessions.');
      const provider = target?.provider ?? 'claude';
      const title = input.title === undefined ? undefined : titled(input.title, tool);
      const model = modelMeant(at, optional(input.model, 'model', tool), tool, provider);
      const made = await at.createChat(session, {
        ...(title !== undefined ? { title } : {}),
        ...(model ? { model: model.id } : {}),
        prompt: required(input.prompt, 'prompt', tool),
        from: delegated(at),
      });
      return `Chat created (${openLink(session, provider, idOf(made.chat))}).`;
    },
  },
  {
    definition: {
      name: 'rename_chat',
      title: 'Rename Chat',
      description: RENAME_CHAT_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: RENAME_CHAT_PROPERTIES,
        required: ['title'],
      },
      annotations: { title: 'Rename Chat', readOnlyHint: false, destructiveHint: false },
    },
    sessionless: true,
    grant: 'session:write',
    /*
     * What a session's strategy asks of this tool. A utility strategy withholds
     * it whole, which the host does by leaving it out of the list; a deferred
     * strategy offers it without `automatic`, since the host is the one naming
     * fresh chats.
     */
    isEnabledForSession: ({ titleStrategy }) => titleStrategy !== 'utility',
    forSession: ({ titleStrategy }) => {
      if (titleStrategy !== 'deferred') return undefined;
      const { automatic: _automatic, ...properties } = RENAME_CHAT_PROPERTIES;
      return {
        definition: {
          description: DEFERRED_RENAME_CHAT_DESCRIPTION,
          inputSchema: { type: 'object', properties, required: ['title'] },
        },
      };
    },
    /*
     * Deferred, as the reference host's is once it names its own chats: under
     * the deferred strategy a rename is something a person asks for rather
     * than something every turn needs, so the tool need not sit in the tool
     * list the model is offered up front.
     */
    deferLoading: true,
    run: async (input, at) => {
      const tool = 'rename_chat';
      allowed(at, 'session:write');
      const title = titled(input.title, tool);
      const asked = optional(input.chat, 'chat', tool) ?? optional(input.session, 'session', tool);
      let session = at.session;
      let chat = at.chat;
      if (asked !== undefined) {
        const found = await known(at, asked, tool);
        session = found.session.resource;
        const chats = at.chats(session);
        const target = found.chatId === undefined ? chats[0] : chats.find((one) => idOf(one.resource) === found.chatId);
        if (target === undefined) throw new Error(`Invalid ${tool} input: ${asked} is not a chat this host is running.`);
        chat = target.resource;
      }
      if (session === undefined || chat === undefined)
        throw new Error(`Invalid ${tool} input: session is required when there is no calling session. Pass \`session\` from list_sessions.`);
      at.rename(session, chat, title);
      return flag(input.automatic, 'automatic', tool) === true ? 'Renaming chat.' : `Renamed chat to "${title}".`;
    },
  },
  {
    definition: {
      name: 'archive_chat',
      title: 'Archive Chat',
      description: 'Archive a chat, or a whole session, so it no longer appears among active sessions. Use it when the user asks to archive a chat or session or to mark it done. Archiving a nested session archives only that chat. Archiving a session\'s main session (`main: true` in `chats`, or a session link without a chat id) archives the whole session with all of its nested sessions, and removes its isolated worktree after committing the worktree\'s changes. Archived chats keep their history and can be unarchived. To remove a session permanently, use `delete_session` instead. Refuses the chat this tool runs in and the main session of its own session.',
      inputSchema: {
        type: 'object',
        properties: {
          chat: { type: 'string', description: 'The chat to archive: an `agent-host-session://` chat link from `list_sessions`, `get_current_session` or `create_session`. A session link without a chat id targets that session\'s main session, which archives the whole session.' },
        },
        required: ['chat'],
      },
      annotations: { title: 'Archive Chat', readOnlyHint: false },
    },
    /*
     * Offered to a person with no session too, as archiving is a thing a window
     * asks for from outside any chat. What it may do is the target's: a chat
     * asks `chat:mark` and a session `session:mark`, checked once the link says
     * which it is, so a caller who may file away a session is not refused the
     * chat half it was never offered.
     */
    sessionless: true,
    grant: 'session:write',
    deferLoading: true,
    run: async (input, at) => {
      const tool = 'archive_chat';
      const asked = required(input.chat, 'chat', tool);
      /*
       * An explicit chat id that is empty or cannot be decoded must not fall
       * back to the whole session: the model asked to archive one chat and
       * wrote which badly, and archiving everything is the answer it did not
       * ask for. The reference host refuses it in these words.
       * https://github.com/microsoft/vscode/blob/a1a15017f8a/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L2077-L2080
       */
      const explicit = /[?&]chat=([^&#]*)/.exec(asked)?.[1];
      if (explicit !== undefined) {
        let read: string | undefined;
        try {
          read = explicit === '' ? undefined : decodeURIComponent(explicit);
        } catch {
          read = undefined;
        }
        if (read === undefined)
          throw new Error(`Invalid ${tool} input: chat must name a valid chat id; omit the chat id to archive the whole session.`);
      }
      const found = sessionMeant(asked, await at.sessions());
      if (found === undefined)
        throw new Error(`Invalid ${tool} input: chat must be an agent-host-session:// link targeting a known chat (see list_sessions).`);
      /*
       * The default chat is the session itself: a link to it, and a link with
       * no chat id, archive the whole session with every chat of it.
       */
      const chats = at.chats(found.session.resource);
      const defaultChat = chats[0];
      const named = found.chatId === undefined ? undefined : chats.find((one) => idOf(one.resource) === found.chatId);
      if (found.chatId !== undefined && named === undefined)
        throw new Error(`Invalid ${tool} input: chat must target a known chat of its session.`);
      const wholeSession = found.chatId === undefined || (defaultChat !== undefined && named?.resource === defaultChat.resource);
      const chat = wholeSession ? defaultChat?.resource : named?.resource;
      // Archiving either the chat this call runs in or its own session's main
      // chat would archive the conversation that is calling the tool.
      if (at.chat !== undefined && chat !== undefined && chat === at.chat)
        throw new Error(`Invalid ${tool} input: refusing to archive the chat this tool runs in.`);
      if (wholeSession && at.session !== undefined && found.session.resource === at.session)
        throw new Error(`Invalid ${tool} input: refusing to archive the main session of the current session, which would archive the current session.`);
      allowed(at, wholeSession ? 'session:mark' : 'chat:mark');
      const moved = await at.archive(found.session.resource, wholeSession ? undefined : chat);
      const link = openLink(found.session.resource, found.session.provider, wholeSession || chat === undefined ? undefined : idOf(chat));
      if (wholeSession) return moved ? `Archived session ${link} with all of its chats.` : `Session ${link} is already archived.`;
      return moved ? `Archived chat ${link}.` : `Chat ${link} is already archived.`;
    },
  },
  {
    definition: {
      name: 'send_message',
      title: 'Send Message',
      description: 'Send, replace, or cancel your message in an existing session or chat. Use `delivery: "steer"` only to update an active turn; steering is handed to the provider immediately and cannot be replaced or cancelled. Use `delivery: "queue"` for a separate turn. Replace and cancel require the message ID and revision returned by an earlier call and succeed only while that queued message is pending. If it already started, the result reports `processing` or `completed`; decide whether to send a steering correction or a queued follow-up. Delivery is asynchronous; this tool does not wait for or return a reply.',
      inputSchema: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['send', 'replace', 'cancel'], description: '`send` (default) creates a message, `replace` updates one of your pending queued messages, and `cancel` removes one of your pending queued messages.' },
          session: { type: 'string', description: 'The session or chat to message: a session URI from `list_sessions`, or an `agent-host-session://` link. A link carrying a chat id targets that specific chat.' },
          message: { type: 'string', description: 'The complete message text. Required for `send` and `replace`; omit for `cancel`.' },
          delivery: { type: 'string', enum: ['queue', 'steer'], description: 'For `send`, use `steer` to update an active turn or `queue` for a separate turn. Defaults to `queue`.' },
          messageId: { type: 'string', description: 'For `replace` or `cancel`, the ID returned when this chat sent the message.' },
          expectedRevision: { type: 'number', description: 'For `replace` or `cancel`, the revision returned with a pending queued message. The operation fails if the message changed or started processing.' },
        },
        required: ['session'],
      },
      annotations: { title: 'Send Message', readOnlyHint: false, destructiveHint: true },
    },
    sessionless: true,
    grant: 'session:write',
    run: async (input, at) => {
      const tool = 'send_message';
      allowed(at, 'session:write');
      const found = await known(at, required(input.session, 'session', tool), tool);
      const operation = optional(input.operation, 'operation', tool) ?? 'send';
      if (operation !== 'send' && operation !== 'replace' && operation !== 'cancel')
        throw new Error(`Invalid ${tool} input: operation must be one of send, replace, cancel.`);
      let request: SendMessageRequest;
      if (operation === 'send') {
        const delivery = optional(input.delivery, 'delivery', tool) ?? 'queue';
        if (delivery !== 'queue' && delivery !== 'steer')
          throw new Error(`Invalid ${tool} input: delivery must be one of queue, steer.`);
        request = { operation, delivery, message: required(input.message, 'message', tool) };
      } else {
        const messageId = required(input.messageId, 'messageId', tool);
        const expectedRevision = positive(input.expectedRevision, 'expectedRevision', tool);
        request = operation === 'replace'
          ? { operation, messageId, expectedRevision, message: required(input.message, 'message', tool) }
          : { operation, messageId, expectedRevision };
      }
      const chats = at.chats(found.session.resource);
      const target = found.chatId === undefined ? chats[0]?.resource : chats.find((one) => idOf(one.resource) === found.chatId)?.resource;
      if (at.chat !== undefined && target === at.chat)
        throw new Error(`Invalid ${tool} input: refusing to send a message to the current chat.`);
      const messageId = request.messageId ?? crypto.randomUUID();
      // A new message is the first revision of its life; a replacement is the
      // next one after the revision the earlier answer named.
      const revision = request.operation === 'send' ? 1 : request.operation === 'replace' ? (request.expectedRevision ?? 0) + 1 : undefined;
      const answer = await at.send(found.session.resource, found.chatId, { ...request, messageId }, delegated(at, messageId, revision));
      return JSON.stringify({ ...answer, openLink: openLink(found.session.resource, found.session.provider, found.chatId) });
    },
  },
  {
    definition: {
      name: 'get_session_context',
      title: 'Get Session Context',
      description: 'Read the recent conversation of an existing session or chat: a compacted transcript of its turns (messages, replies, and tool calls). Use this to see what a session you created is doing, or to gather context before sending it a message. Returns a compacted summary by default (`detail: "summary"`); request `digest` or `full` for more detail. For session metadata (status, working directory, changes, ...) use `list_sessions` with the `session` argument.',
      inputSchema: {
        type: 'object',
        properties: {
          session: { type: 'string', description: 'The session or chat to read: a session URI from `list_sessions`, or an `agent-host-session://` link. A link carrying a chat id targets that specific chat.' },
          detail: { type: 'string', enum: ['summary', 'digest', 'full'], description: 'How much conversation detail to return. `summary` (default): status and a short per-turn gist (the message plus a compact snippet of the reply). `digest`: adds the full assistant reply text and tool-call names. `full`: adds tool-call inputs. Higher levels return more tokens.' },
          transcriptLimit: { type: 'number', description: 'Maximum number of most-recent turns to include. Defaults to 10; capped at 50.' },
        },
        required: ['session'],
      },
      annotations: { title: 'Get Session Context', readOnlyHint: true, openWorldHint: false },
    },
    sessionless: true,
    grant: 'session:read',
    run: async (input, at) => {
      const tool = 'get_session_context';
      allowed(at, 'session:read');
      const found = await known(at, required(input.session, 'session', tool), tool);
      const detail = optional(input.detail, 'detail', tool) ?? 'summary';
      if (!(detail in CAPS)) throw new Error(`Invalid ${tool} input: detail must be "summary", "digest" or "full".`);
      const asked = input.transcriptLimit;
      if (asked !== undefined && (typeof asked !== 'number' || !Number.isFinite(asked) || asked < 1))
        throw new Error(`Invalid ${tool} input: transcriptLimit must be a positive number.`);
      const limit = Math.min(50, Math.floor(typeof asked === 'number' ? asked : 10));
      const snapshot = await at.context(found.session.resource, found.chatId);
      if (snapshot === undefined) {
        return JSON.stringify({
          session: found.session.resource,
          openLink: openLink(found.session.resource, found.session.provider, found.chatId),
          detail, transcript: [], hasMoreHistory: false, truncated: false,
        });
      }
      return JSON.stringify(serializeContext(found.session, found.chatId, snapshot, detail as Detail, limit));
    },
  },
  {
    definition: {
      name: 'delete_session',
      title: 'Delete Session',
      description: 'Permanently delete a session (identified by a session URI from `list_sessions`), including its stored data. This cannot be undone. Refuses to delete the current session.',
      inputSchema: {
        type: 'object',
        properties: {
          session: { type: 'string', description: 'The session to delete: a session URI from `list_sessions` or an `agent-host-session://` link (e.g. from `create_session`).' },
        },
        required: ['session'],
      },
      annotations: { title: 'Delete Session', readOnlyHint: false, destructiveHint: true },
    },
    sessionless: true,
    grant: 'session:write',
    run: async (input, at) => {
      const tool = 'delete_session';
      allowed(at, 'session:write');
      const found = await known(at, required(input.session, 'session', tool), tool);
      if (at.session !== undefined && found.session.resource === at.session)
        throw new Error(`Invalid ${tool} input: refusing to delete the current session.`);
      await at.remove(found.session.resource);
      return `Deleted session ${found.session.resource}. Reply with one short sentence confirming the session was deleted.`;
    },
  },
  {
    definition: {
      name: 'move_session',
      title: 'Move Session',
      description: 'Move a nested session or a whole session when the user asks to reorganize sessions: reorder a nested session within its session, move it into another session, make it its own session (`independent`), or move a session that has no nested sessions into another session as a nested session. Pass `into` for every move except `independent`, which takes neither `into` nor `after`. Use this only when the user asks to move or reorganize sessions; never to tidy up sessions on your own. To start new work, use `create_session` instead. A moved session keeps its history, folders and running work, including a session without a workspace; both sessions must use the same agent. Get links from `list_sessions` or `get_current_session`: a session\'s `openLink`, or for a nested session the `openLink` listed for it in the session\'s `chats`. The user is asked to confirm every move. When it moves the chat this tool runs in, the move happens after this turn ends: make it your final tool call.',
      inputSchema: {
        type: 'object',
        properties: {
          session: { type: 'string', description: 'What to move: an `agent-host-session://` link or a session URI from `list_sessions`. A link carrying a chat id moves that nested session; a session without one moves the whole session, which must have no nested sessions. Omit to move the chat this tool runs in.' },
          relationship: { type: 'string', enum: ['nested', 'independent'], description: 'Use `independent` to make a nested session its own top-level session; `into` and `after` must then be omitted. Otherwise omit it; defaults to `nested`.' },
          into: { type: 'string', description: 'Required unless `relationship` is `independent`, which forbids it: the session to move it into, as a session URI from `list_sessions` or an `agent-host-session://` link. Pass its current session to reorder it there.' },
          after: { type: 'string', description: 'Only with `into`; forbidden with `independent`: an `agent-host-session://` link to a nested session of `into`, or to `into`\'s main session, to place it after. Omit to place it at the end.' },
        },
      },
      annotations: { title: 'Move Session', readOnlyHint: false, destructiveHint: true },
    },
    /*
     * Offered to a person with no session too, as the reference host's group is
     * read from a window: a move names the chat it moves, and only a call that
     * leaves that out needs the chat it runs in. Deferred, as the reference's
     * is: reorganizing is a thing a person asks for, not every turn's work.
     */
    sessionless: true,
    grant: 'session:write',
    deferLoading: true,
    run: async (input, at) => {
      const tool = 'move_session';
      allowed(at, 'session:write');
      const relationship = optional(input.relationship, 'relationship', tool) ?? 'nested';
      if (relationship !== 'nested' && relationship !== 'independent')
        throw new Error(`Invalid ${tool} input: relationship must be one of nested, independent.`);
      const sessionInput = optional(input.session, 'session', tool);
      const intoInput = optional(input.into, 'into', tool);
      const afterInput = optional(input.after, 'after', tool);
      if (relationship === 'independent' && (intoInput !== undefined || afterInput !== undefined))
        throw new Error(`Invalid ${tool} input: omit \`into\` and \`after\` with relationship "independent".`);
      if (relationship === 'nested' && intoInput === undefined)
        throw new Error(`Invalid ${tool} input: \`into\` is required unless relationship is "independent".`);
      const rows = await at.sessions();
      /*
       * One chat of a running session, by the id a link carries. The default
       * chat is the one with no id, which is what a session without one names:
       * this host keeps the chat a whole session moves by under it.
       */
      const chatOf = (session: string, chatId: string | undefined) => {
        const chats = at.chats(session);
        return chatId === undefined ? chats[0] : chats.find((one) => idOf(one.resource) === chatId);
      };
      /*
       * What moves: the chat a link names, or the chat this tool runs in. A
       * session named without a chat id moves its main chat, which is the
       * whole session.
       */
      let session: string;
      let chat: string;
      let wholeSession: boolean;
      let provider: string;
      if (sessionInput !== undefined) {
        const found = sessionMeant(sessionInput, rows);
        if (found === undefined)
          throw new Error(`Invalid ${tool} input: session must be an \`agent-host-session://\` link or the URI of a known session (see list_sessions).`);
        const moving = chatOf(found.session.resource, found.chatId);
        if (moving === undefined)
          throw new Error(found.chatId === undefined
            ? `Invalid ${tool} input: the session has no main session.`
            : `Invalid ${tool} input: session's chat id must name a nested session of that session (see list_sessions).`);
        session = found.session.resource;
        chat = moving.resource;
        wholeSession = found.chatId === undefined;
        provider = found.session.provider;
      }
      else {
        if (at.session === undefined || at.chat === undefined)
          throw new Error(`Invalid ${tool} input: session is required when this tool does not run in a chat.`);
        session = at.session;
        chat = at.chat;
        wholeSession = rows.find((one) => one.resource === session)?.defaultChat === chat;
        provider = rows.find((one) => one.resource === session)?.provider ?? at.provider ?? 'claude';
      }
      if (relationship === 'independent') {
        if (wholeSession)
          throw new Error(`Invalid ${tool} input: it is already its own session. To make a nested session its own session, pass its link with its chat id.`);
        let moved: { session: string };
        try {
          moved = await at.move(chat, { kind: 'newSession' });
        } catch (error) {
          throw moveRefused(error, false);
        }
        return `Nested session moved to its own session (${openLink(moved.session, provider)}).`;
      }
      const into = sessionMeant(intoInput as string, rows);
      if (into === undefined)
        throw new Error(`Invalid ${tool} input: into must be an \`agent-host-session://\` link or the URI of a known session (see list_sessions).`);
      /*
       * The chat it goes after, which has to be one of the destination's: a
       * link to `into` itself names its main chat. An absent `after` is the
       * end, which is what the schema says and what the host reads `end` as.
       */
      let after = 'end';
      if (afterInput !== undefined) {
        const anchor = sessionMeant(afterInput, rows);
        const target = anchor === undefined || anchor.session.resource !== into.session.resource
          ? undefined
          : chatOf(into.session.resource, anchor.chatId);
        if (target === undefined)
          throw new Error(`Invalid ${tool} input: after must be a link to a nested session of \`into\`, or to its main session. Omit it to place the session at the end.`);
        if (target.resource === chat)
          throw new Error(`Invalid ${tool} input: after must name another session than the one that moves.`);
        after = target.resource;
      }
      const reorder = into.session.resource === session;
      let moved: { session: string };
      try {
        moved = await at.move(chat, { kind: 'session', session: into.session.resource, after });
      } catch (error) {
        throw moveRefused(error, wholeSession);
      }
      // The chat's own link, in the session it landed in: the same id, since a
      // move keeps the chat's URI, and none for a default chat, as the link
      // scheme omits it.
      const chatLink = openLink(moved.session, into.session.provider, chatIdFor(moved.session, chat));
      if (wholeSession) return `Session moved into ${openLink(moved.session, into.session.provider)} as a nested session (${chatLink}).`;
      return reorder
        ? `Nested session reordered in its session (${chatLink}).`
        : `Nested session moved into ${openLink(moved.session, into.session.provider)} (${chatLink}).`;
    },
  },
];

/**
 * The session tools by name, which is what a daemon's `sessionTools` covers.
 *
 * Read off `sessionTools()` rather than written out a second time, so the list
 * cannot drift from the tools themselves: one added there is one the option
 * switches off, and one taken away leaves the list. Only these fourteen are the
 * session tools - the artifact tools, `ahp_resource`, `ahp_terminals` and
 * `schedule_wakeup` are this host's own and are offered whatever the option
 * says.
 */
export const SESSION_TOOL_NAMES: readonly string[] = sessionTools().map((one) => one.definition.name);

/**
 * A wake the agent asks for in its own chat: a turn begun later with a prompt.
 *
 * This host's own rather than the reference host's, so it is not among the
 * nine above.
 */
/** The shortest wait `schedule_wakeup` takes, in seconds. */
const WAKE_MIN_SECONDS = 60;
/** The longest wait `schedule_wakeup` takes, in seconds: 30 days. */
const WAKE_MAX_SECONDS = 2_592_000;

export const wakeupTool = (): HostTool => ({
  definition: {
    name: 'schedule_wakeup',
    title: 'Schedule Wakeup',
    description: 'Begin a new turn in this chat after a delay, with the given prompt. Use this to come back to work that is waiting on something, such as a build or a review. The chat holds one wakeup: a new call replaces the one held, and `stop: true` cancels it. The wakeup is kept by the host, so it survives this session going to sleep and the daemon restarting, and the session is woken for it when it is due. The delay is 60 seconds to 30 days; a wait under 60 seconds belongs inside the turn, not in a wakeup.',
    inputSchema: {
      type: 'object',
      properties: {
        delaySeconds: { type: 'number', minimum: WAKE_MIN_SECONDS, maximum: WAKE_MAX_SECONDS, description: 'Seconds from now until the wakeup begins its turn, 60 to 2592000 (30 days).' },
        prompt: { type: 'string', description: 'The message the new turn begins with. Say what to check or continue, since the turn starts from this text.' },
        stop: { type: 'boolean', description: 'When true, cancel the wakeup this chat holds and schedule nothing. `delaySeconds` and `prompt` are not needed.' },
      },
    },
    annotations: { title: 'Schedule Wakeup', readOnlyHint: false, destructiveHint: false },
  },
  run: (input, at) => {
    const tool = 'schedule_wakeup';
    /*
     * No grant is asked for, because this acts on the calling chat alone: a
     * wake is this conversation's own next turn, and a person who may talk in
     * a chat may arrange to talk in it later. The turn it begins is theirs,
     * which is what the record it is written on carries.
     */
    if (flag(input.stop, 'stop', tool) === true) return at.cancelWake() ? 'Wakeup cancelled.' : 'No wakeup was scheduled.';
    const delay = input.delaySeconds;
    if (typeof delay !== 'number' || !Number.isFinite(delay) || delay < WAKE_MIN_SECONDS || delay > WAKE_MAX_SECONDS)
      throw new Error(`Invalid ${tool} input: delaySeconds must be a number of seconds from ${String(WAKE_MIN_SECONDS)} to ${String(WAKE_MAX_SECONDS)} (30 days). A wait under ${String(WAKE_MIN_SECONDS)} seconds belongs inside the turn.`);
    const due = at.scheduleWake(delay, required(input.prompt, 'prompt', tool));
    return `Wakeup scheduled for ${due.toISOString()}.`;
  },
});
