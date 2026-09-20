import { Status, idOf } from './catalog.js';
import type { HostTool, ToolCall } from './types/host.js';
import type { Summary } from './types/catalog.js';
import type { Bag } from './types/common.js';

/**
 * The tools an agent gets for the host it runs in, under VS Code's names.
 *
 * `serverToolNames.ts` in the reference host names nine, and its
 * `sessionServerTools.ts` says what each takes and answers. The names, the
 * input schemas and the answer shapes are copied rather than redesigned, so a
 * prompt or a skill written against that host calls these and gets the same
 * thing back: `list_sessions` answers `{ sessions: [...] }` with the same
 * keys, `send_message` says "Message queued (link)." in the same words, and a
 * link is `agent-host-session://<provider>/<id>`, which its window opens.
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

const required = (value: unknown, field: string, tool: string): string => {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`Invalid ${tool} input: ${field} must be a non-empty string.`);
  return value;
};
const optional = (value: unknown, field: string, tool: string): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`Invalid ${tool} input: ${field} must be a string.`);
  return value;
};
const flag = (value: unknown, field: string, tool: string): boolean | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new Error(`Invalid ${tool} input: ${field} must be a boolean.`);
  return value;
};
const when = (value: unknown, field: string, tool: string): number | undefined => {
  if (value === undefined || value === null) return undefined;
  const at = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(at)) throw new Error(`Invalid ${tool} input: ${field} must be an ISO-8601 timestamp.`);
  return at;
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
  return {
    session: row.resource,
    openLink: openLink(row.resource, row.provider),
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
  };
};

/** The rows `list_sessions` keeps, under its filters. */
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
  const withChanges = flag(args.withChanges, 'withChanges', tool);
  const unread = flag(args.unread, 'unread', tool);
  const withPullRequest = flag(args.withPullRequest, 'withPullRequest', tool);
  const includeArchived = flag(args.includeArchived, 'includeArchived', tool);
  const after = when(args.createdAfter, 'createdAfter', tool);
  const before = when(args.createdBefore, 'createdBefore', tool);
  const bare = (value: string): string => value.replace(/^file:\/\//, '').replace(/\/+$/, '').toLowerCase();
  return rows.filter((row) => {
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
    return true;
  });
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

/** Where a message came from, in the reference client's spelling. */
const delegated = (at: ToolCall): Bag => ({
  origin: { kind: 'agent' },
  _meta: {
    'vscode.chat.delegation': {
      sourceSession: at.session,
      sourceChat: at.chat,
      ...(at.turn() !== undefined ? { sourceTurnId: at.turn() } : {}),
    },
  },
});

/** The row of the calling session, from the catalogue. */
const self = async (at: ToolCall): Promise<Summary | undefined> =>
  (await at.sessions()).find((row) => row.resource === at.session);

const known = async (at: ToolCall, asked: string, tool: string): Promise<{ session: Summary; chatId?: string }> => {
  const found = sessionMeant(asked, await at.sessions());
  if (found === undefined)
    throw new Error(`Invalid ${tool} input: session must match the URI of a known session (see list_sessions).`);
  return found;
};

/** A model by id or by name, and the provider it belongs to. */
const modelMeant = (at: ToolCall, asked: string | undefined, tool: string, provider?: string): { id: string; provider: string } | undefined => {
  if (asked === undefined) return undefined;
  const pool = at.models().filter((one) => provider === undefined || one.provider === provider);
  const found = pool.find((one) => one.id === asked) ?? pool.find((one) => one.name.toLowerCase() === asked.toLowerCase());
  if (found === undefined) throw new Error(`Invalid ${tool} input: model "${asked}" is not one this host offers${provider ? ` for ${provider}` : ''}.`);
  return { id: found.id, provider: found.provider };
};

/** An absolute path or a `file://` URI, as a path; nothing for anything else. */
const pathOf = (value: string): string | undefined => {
  if (value.startsWith('file://')) return value.slice('file://'.length).replace(/\/+$/, '') || '/';
  if (value.startsWith('/')) return value.replace(/\/+$/, '') || '/';
  return undefined;
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

/** VS Code's session tools, in its order. */
export const sessionTools = (): HostTool[] => [
  {
    definition: {
      name: 'list_sessions',
      title: 'List Sessions',
      description: 'List sessions and their compact metadata (status, activity, working directory, project, worktree changes, git/GitHub info, timestamps). Each result includes `session` for identity and tool inputs and `openLink` for clickable Markdown links; do not use `session` as a link target. Pass `session` to fetch a single known session by URI. By default archived sessions are omitted. Optionally filter by `status`, `workspace`, `withChanges`, `unread`, `withPullRequest`, `includeArchived`, `createdAfter`, or `createdBefore`.',
      inputSchema: {
        type: 'object',
        properties: {
          session: { type: 'string', description: 'Return only the session with this URI or `agent-host-session://` link (a direct lookup that ignores the other filters). Use this to fetch one known session\'s metadata.' },
          status: { type: 'array', items: { type: 'string', enum: LIST_STATUS }, description: 'Only return sessions whose status matches one of these (e.g. `inputNeeded` for sessions awaiting a reply, `inProgress` for running ones, `archived` for sessions marked Done/completed, which implies `includeArchived`). Omit to return every status.' },
          workspace: { type: 'string', description: 'Only return sessions for this project name, project URI, or working directory path/URI.' },
          withChanges: { type: 'boolean', description: 'When true, only return sessions that have pending worktree changes.' },
          unread: { type: 'boolean', description: 'When true, only return sessions with updates the user has not seen yet.' },
          withPullRequest: { type: 'boolean', description: 'When true, only return sessions that have a linked GitHub pull request.' },
          includeArchived: { type: 'boolean', description: 'Whether to include archived sessions. Defaults to false; set true to also return archived sessions.' },
          createdAfter: { type: 'string', description: 'Only return sessions created at or after this time (ISO-8601 timestamp, e.g. `2025-01-31T00:00:00Z`).' },
          createdBefore: { type: 'string', description: 'Only return sessions created at or before this time (ISO-8601 timestamp).' },
        },
      },
      annotations: { title: 'List Sessions', readOnlyHint: true, openWorldHint: false },
    },
    run: async (input, at) => JSON.stringify({ sessions: filterSessions(await at.sessions(), input).map(serializeSession) }),
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
      description: 'Attach a real workspace only to modify its files or run commands requiring its project environment. Do not use for self-contained scratch work on attachments, pasted/generated content, or throwaway/exportable artifacts. The session, chat, and history are preserved. Immediately before every call, use the available user-input tool to ask one question confirming both workspace and isolation, even if already specified; tool approval is not confirmation. Set `isolation` to true for a managed Git worktree or false for the folder directly. After this turn, the host attaches the workspace and continues the original task. Make this the turn\'s final tool call.',
      inputSchema: {
        type: 'object',
        properties: {
          workspaceFolder: { type: 'string', description: 'Absolute local folder path or file URI to set as the current session\'s workspace. Use an exact path from the user or `list_sessions`; do not guess.' },
          isolation: { type: 'boolean', description: 'Whether to create an isolated Git worktree and use it as the workspace. Include this choice in the required user confirmation immediately before calling this tool.' },
        },
        required: ['workspaceFolder', 'isolation'],
      },
      annotations: { title: 'Set Workspace', readOnlyHint: false, destructiveHint: true },
    },
    run: (input, at) => {
      const tool = 'set_workspace';
      if (at.turn() === undefined) throw new Error(`${tool} must run from an active chat turn.`);
      const folder = pathOf(required(input.workspaceFolder, 'workspaceFolder', tool));
      if (folder === undefined)
        throw new Error(`Invalid ${tool} input: workspaceFolder must be an absolute local path or file URI.`);
      const isolation = flag(input.isolation, 'isolation', tool);
      if (isolation === undefined) throw new Error(`Invalid ${tool} input: isolation must be a boolean.`);
      at.setWorkspace(folder, isolation);
      return isolation
        ? `An isolated worktree will be created from file://${folder} and set as the workspace after this turn ends. End this turn now without calling more tools or replying; the host will continue the original task automatically in the isolated workspace.`
        : `Workspace will be set to file://${folder} after this turn ends. End this turn now without calling more tools or replying; the host will continue the original task automatically in the selected workspace.`;
    },
  },
  {
    definition: {
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
        },
        required: ['relationship', 'prompt', 'title'],
      },
      annotations: { title: 'Create Session', readOnlyHint: false, destructiveHint: true },
    },
    run: async (input, at) => {
      const tool = 'create_session';
      const relationship = required(input.relationship, 'relationship', tool);
      if (relationship !== 'currentSession' && relationship !== 'independent')
        throw new Error(`Invalid ${tool} input: relationship must be "currentSession" or "independent".`);
      const prompt = required(input.prompt, 'prompt', tool);
      const title = titled(input.title, tool);
      const rows = await at.sessions();
      const mine = rows.find((row) => row.resource === at.session);
      if (relationship === 'currentSession') {
        if (input.workspace !== undefined || input.worktree !== undefined)
          throw new Error(`Invalid ${tool} input: workspace and worktree are only valid with relationship "independent".`);
        const model = modelMeant(at, optional(input.model, 'model', tool), tool, mine?.provider);
        const made = await at.createChat(at.session, { title, prompt, ...(model ? { model: model.id } : {}), from: delegated(at) });
        return `Chat created in the current session (${openLink(at.session, mine?.provider ?? 'claude', idOf(made.chat))}).`;
      }
      const workspace = workspaceMeant(required(input.workspace, 'workspace', tool), rows, tool);
      const worktree = flag(input.worktree, 'worktree', tool);
      const model = modelMeant(at, optional(input.model, 'model', tool), tool);
      // What was asked; else the caller's own arrangement for its own
      // directory, which is the folder it is in; else a worktree, which is
      // what keeps two sessions from editing one checkout.
      const own = mine?.workingDirectories[0] === undefined ? undefined : pathOf(mine.workingDirectories[0]);
      const isolation: 'worktree' | 'folder' = worktree !== undefined
        ? (worktree ? 'worktree' : 'folder')
        : own === workspace ? 'folder' : 'worktree';
      const made = await at.create({
        workingDirectory: workspace,
        ...(model ? { provider: model.provider, model: model.id } : {}),
        isolation,
        title,
        prompt,
        from: delegated(at),
      });
      return `New session created (${openLink(made.session, model?.provider ?? mine?.provider ?? 'claude')}).`;
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
    run: async (input, at) => {
      const tool = 'create_chat';
      const asked = optional(input.session, 'session', tool);
      const target = asked === undefined ? (await self(at)) : (await known(at, asked, tool)).session;
      const session = target?.resource ?? at.session;
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
    /*
     * What a session's strategy asks of this tool. A utility strategy withholds
     * it whole, which the host does by leaving it out of the list; a deferred
     * strategy offers it without `automatic`, since the host is the one naming
     * fresh chats.
     */
    forSession: ({ titleStrategy }) => {
      if (titleStrategy === 'utility') return { offered: false };
      if (titleStrategy !== 'deferred') return undefined;
      const { automatic: _automatic, ...properties } = RENAME_CHAT_PROPERTIES;
      return {
        offered: true,
        definition: {
          description: DEFERRED_RENAME_CHAT_DESCRIPTION,
          inputSchema: { type: 'object', properties, required: ['title'] },
        },
      };
    },
    run: async (input, at) => {
      const tool = 'rename_chat';
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
      at.rename(session, chat, title);
      return flag(input.automatic, 'automatic', tool) === true ? 'Renaming chat.' : `Renamed chat to "${title}".`;
    },
  },
  {
    definition: {
      name: 'send_message',
      title: 'Send Message',
      description: 'Send a message to an existing session or chat, starting a new turn there. Provide a session URI from `list_sessions` or an `agent-host-session://` link; a link carrying a chat id targets that specific chat. If the target chat is busy, the message is queued and starts after the active turn completes successfully. Delivery is asynchronous: this tool does not wait for or return the reply.',
      inputSchema: {
        type: 'object',
        properties: {
          session: { type: 'string', description: 'The session or chat to message: a session URI from `list_sessions`, or an `agent-host-session://` link. A link carrying a chat id targets that specific chat.' },
          message: { type: 'string', description: 'The message to send.' },
        },
        required: ['session', 'message'],
      },
      annotations: { title: 'Send Message', readOnlyHint: false, destructiveHint: true },
    },
    run: async (input, at) => {
      const tool = 'send_message';
      const message = required(input.message, 'message', tool);
      const found = await known(at, required(input.session, 'session', tool), tool);
      const chats = at.chats(found.session.resource);
      const target = found.chatId === undefined ? chats[0]?.resource : chats.find((one) => idOf(one.resource) === found.chatId)?.resource;
      if (target === at.chat)
        throw new Error(`Invalid ${tool} input: refusing to send a message to the current chat.`);
      const what = await at.send(found.session.resource, found.chatId, message, delegated(at));
      return `Message ${what} (${openLink(found.session.resource, found.session.provider, found.chatId)}).`;
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
    run: async (input, at) => {
      const tool = 'get_session_context';
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
    run: async (input, at) => {
      const tool = 'delete_session';
      const found = await known(at, required(input.session, 'session', tool), tool);
      if (found.session.resource === at.session)
        throw new Error(`Invalid ${tool} input: refusing to delete the current session.`);
      await at.remove(found.session.resource);
      return `Deleted session ${found.session.resource}. Reply with one short sentence confirming the session was deleted.`;
    },
  },
];
