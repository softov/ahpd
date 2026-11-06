/**
 * What kind of thing a tool call is, said where the reference client reads it.
 *
 * `_meta.toolKind` is not protocol. It is the one well-known key VS Code's
 * agent window routes a tool call by: `terminal` goes to the command-and-output
 * renderer, `subagent` to the subagent view, `search` and `read` to theirs, and
 * a call with none is drawn as a generic tool - a name and a box. The reference
 * host stamps it in its own adapters, and derives it for a "remote host" from
 * a Copilot-internal permission payload this backend does not have; so it is
 * stamped here, from the harness's own tool names, which are the one thing
 * about a tool call this backend can be sure of.
 *
 * Names only, as VS Code's Claude table stamps them: the shell's three tools
 * are terminals, a file or a notebook read is a read, a glob and a grep are
 * searches, and a worker is a subagent. Nothing else about the call decides
 * the kind, and a tool the table does not name, a web fetch among them, is
 * left unstamped: the generic renderer is right for it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeToolDisplay.ts#L78-L105
 */

export type ToolKind = 'terminal' | 'read' | 'search' | 'subagent';

const KINDS: Readonly<Record<string, ToolKind>> = {
  Bash: 'terminal',
  BashOutput: 'terminal',
  KillBash: 'terminal',
  terminal: 'terminal',
  Read: 'read',
  NotebookRead: 'read',
  Glob: 'search',
  Grep: 'search',
  Task: 'subagent',
  Agent: 'subagent',
};

/** The kind of a tool by its harness name, or nothing for one the table lacks. */
export const toolKindOf = (name: string): ToolKind | undefined => KINDS[name];

/**
 * The `_meta` a tool call carries from the moment it is announced.
 *
 * The reducer replaces a call's whole `_meta` whenever an action carries one,
 * so anything added later - a progress line while it runs - has to be spread
 * over this rather than sent alone. Absent for a tool with no kind, so a call
 * that has nothing to say carries no empty bag.
 */
export const toolMetaOf = (name: string): Record<string, unknown> | undefined => {
  const toolKind = toolKindOf(name);
  return toolKind === undefined ? undefined : { toolKind };
};

/** The prefix the CLI calls an MCP server's tool under, `mcp__<server>__<tool>`. */
const MCP_TOOL_PREFIX = 'mcp__';

/** VS Code's Claude display table, by the CLI's own tool names. */
const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  Bash: 'Run shell command',
  BashOutput: 'Read shell output',
  KillBash: 'Kill shell command',
  Read: 'Read file',
  Glob: 'Find files',
  Grep: 'Search files',
  LS: 'List directory',
  NotebookRead: 'Read notebook',
  Write: 'Write file',
  Edit: 'Edit file',
  MultiEdit: 'Edit file',
  NotebookEdit: 'Edit notebook',
  TodoWrite: 'Update todo list',
  WebFetch: 'Fetch URL',
  Task: 'Run subagent task',
  Agent: 'Run subagent task',
  ExitPlanMode: 'Ready to code?',
  AskUserQuestion: 'Ask user a question',
  Skill: 'Run skill',
  TaskCreate: 'Create task',
  TaskUpdate: 'Update task',
  TaskList: 'List tasks',
  TaskGet: 'Read task',
};

/**
 * The name a call of one of the CLI's tools is drawn under, as VS Code's
 * Claude agent names it: its table for the CLI's own tools, the server and
 * tool of an MCP call, and the tool's own name for one the table lacks.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeToolDisplay.ts#L142-L176
 */
export const getClaudeToolDisplayName = (toolName: string): string =>
  DISPLAY_NAMES[toolName] ?? (toolName.startsWith(MCP_TOOL_PREFIX) ? `Run MCP tool ${toolName.slice(MCP_TOOL_PREFIX.length)}` : toolName);

/** VS Code's Claude confirmation titles, by the permission kind of each of the CLI's tools. */
const CONFIRMATION_TITLES: Readonly<Record<string, string>> = {
  Bash: 'Run in terminal?',
  BashOutput: 'Run in terminal?',
  KillBash: 'Run in terminal?',
  Read: 'Read file?',
  Glob: 'Read file?',
  Grep: 'Read file?',
  LS: 'Read file?',
  NotebookRead: 'Read file?',
  Write: 'Edit file?',
  Edit: 'Edit file?',
  MultiEdit: 'Edit file?',
  NotebookEdit: 'Edit file?',
  TodoWrite: 'Edit file?',
  WebFetch: 'Fetch URL?',
  Skill: 'Run skill?',
};

/**
 * The title of a confirmation card, as VS Code's Claude agent titles it: by
 * the kind of permission the tool needs, an MCP call by its server, and any
 * other tool as a tool call to allow.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeToolDisplay.ts#L219-L244
 */
export const getClaudeConfirmationTitle = (toolName: string): string => {
  const titled = CONFIRMATION_TITLES[toolName];
  if (titled !== undefined) return titled;
  const server = toolName.startsWith(MCP_TOOL_PREFIX) ? toolName.slice(MCP_TOOL_PREFIX.length).split('__')[0] : undefined;
  return server ? `Allow tool from ${server}?` : 'Allow tool call?';
};

/**
 * What the model is told of a call refused, in VS Code's words: a person's
 * decline, and a question nobody answered.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeToolDenial.ts#L6-L14
 */
export const CLAUDE_USER_DECLINED_MESSAGE = 'User declined';
export const CLAUDE_QUESTION_CANCELLED_MESSAGE = 'The user cancelled the question';

/**
 * A failed call's result read as VS Code reads it: the decline denied, the
 * unanswered question cancelled, and anything else the tool's own failure,
 * which carries no `error`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeToolDenial.ts#L16-L30
 */
export const claudeToolDenialCode = (message: string): 'denied' | 'cancelled' | undefined =>
  (message === CLAUDE_USER_DECLINED_MESSAGE ? 'denied' : message === CLAUDE_QUESTION_CANCELLED_MESSAGE ? 'cancelled' : undefined);

/**
 * A tool result's text as the call's content: a bare string one item, and
 * each text block of a list its own, as VS Code's Claude projects a result.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L449-L463
 */
export const resultContent = (content: unknown): { type: 'text'; text: string }[] => {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  return content.flatMap((block: unknown) => {
    const one = typeof block === 'object' && block !== null ? block as { type?: unknown; text?: unknown } : {};
    return one.type === 'text' && typeof one.text === 'string' ? [{ type: 'text' as const, text: one.text }] : [];
  });
};
