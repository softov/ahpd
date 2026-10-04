import type { Bag } from '@ahpd/sdk';
import type { StringOrMarkdown } from '@microsoft/agent-host-protocol';

/**
 * What a tool call says about its input, live and read back from a transcript.
 *
 * Three different things: the line a row draws, the subject a status line
 * reads, and the input a client parses.
 */

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/**
 * What a tool call is *about*, in one line.
 *
 * The only thing separating twenty identical rows, so it is worth doing per
 * tool: `Bash` is its command, the file tools are their path, AskUserQuestion
 * its first question, WebFetch its url, WebSearch its query, and an MCP tool
 * its first string argument. Any other tool has no subject, and its row reads
 * the display name: a row reading `{"file_path":"/very/long/…","offset":0}` is
 * a row nobody reads.
 */
export function summarize(name: string, input: Bag): string | undefined {
  if (name === 'Bash') return str(input.command);
  if (name === 'Read' || name === 'Write' || name === 'Edit') return str(input.file_path);
  if (name === 'Glob' || name === 'Grep') return str(input.pattern);
  if (name === 'Task' || name === 'Agent') return str(input.description);
  if (name === 'AskUserQuestion') {
    const first: unknown = Array.isArray(input.questions) ? input.questions[0] : undefined;
    return typeof first === 'object' && first !== null ? str((first as Bag).question) : undefined;
  }
  if (name === 'WebFetch') return str(input.url);
  if (name === 'WebSearch') return str(input.query);
  if (name.startsWith('mcp__')) return Object.values(input).find((value): value is string => typeof value === 'string');
  return undefined;
}

/**
 * A call's `toolInput`: its whole input as JSON, which a client parses.
 *
 * Bash is its command, because a terminal row reads the command there. Absent
 * for a call with no input, as a call with nothing to say carries no `{}`.
 */
export function toolInputOf(name: string, input: Bag): string | undefined {
  if (name === 'Bash') return str(input.command);
  return Object.keys(input).length > 0 ? JSON.stringify(input) : undefined;
}

/** A string field that is present and not empty. */
const filled = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

const md = (markdown: string): StringOrMarkdown => ({ markdown });

/** VS Code's `truncate`: the first `max` characters and `…`. */
const truncate = (value: string, max: number): string => (value.length <= max ? value : `${value.slice(0, max)}…`);

/**
 * VS Code's `appendEscapedMarkdownInlineCode`: inline code whose fence is one
 * backtick longer than any run in the text, padded when the text starts or
 * ends with a backtick.
 */
const code = (text: string): string => {
  const fence = '`'.repeat(Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length)) + 1);
  return text.startsWith('`') || text.endsWith('`') ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
};

/** VS Code's `escapeMarkdownLinkLabel`. */
const label = (text: string): string => text.replace(/[\\\]]/g, '\\$&');

/**
 * VS Code's `URI.file(path).toString()`: a UNC host as the authority, a drive
 * letter lowercased, and every character but `A-Za-z0-9-._~/` percent-encoded.
 */
const fileUri = (path: string): string => {
  let authority = '';
  let rest = path;
  if (rest.startsWith('//')) {
    const at = rest.indexOf('/', 2);
    authority = at === -1 ? rest.slice(2) : rest.slice(2, at);
    rest = at === -1 ? '/' : rest.slice(at) || '/';
  }
  if (!rest.startsWith('/')) rest = `/${rest}`;
  const drive = /^\/([A-Z]):/.exec(rest);
  if (drive) rest = `/${(drive[1] ?? '').toLowerCase()}${rest.slice(2)}`;
  const encode = (part: string, keep: RegExp): string => [...part].map((char) => (keep.test(char)
    ? char
    : encodeURIComponent(char).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))).join('');
  return `file://${encode(authority.toLowerCase(), /[A-Za-z0-9\-._~[\]:]/)}${encode(rest, /[A-Za-z0-9\-._~/]/)}`;
};

/** VS Code's markdown link to a file: its base name, pointing at its `file:` URI. */
const fileLink = (path: string): string => `[${label(path.split('/').pop() ?? path)}](${fileUri(path)})`;

/** The field on each tool's input that names the file it works on. */
const PATHS: Readonly<Record<string, string>> = {
  Read: 'file_path', NotebookRead: 'notebook_path', LS: 'path',
  Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path',
};

/** Tools whose `description` says what the call does, rather than being data it carries. */
const DESCRIBED = new Set(['Bash', 'Task', 'Agent', 'Monitor']);

/**
 * The line a call's row draws while it runs, and on its confirmation card.
 *
 * The call's `description` for a tool whose description says what the call
 * does. Otherwise VS Code's line for the tools `getClaudeInvocationMessage`
 * maps, in its English and as markdown where it sends markdown. Otherwise the
 * subject from `summarize`, cut as VS Code's lines are, or the tool's name.
 */
export function lineOf(name: string, input: Bag): StringOrMarkdown {
  const said = DESCRIBED.has(name) ? filled(input.description) : undefined;
  if (said !== undefined) return said;
  const path = PATHS[name] === undefined ? undefined : filled(input[PATHS[name]]);
  switch (name) {
    case 'Bash': {
      const first = filled(input.command)?.split('\n')[0];
      return first ? md(`Running ${code(truncate(first, 80))}`) : 'Running shell command';
    }
    case 'BashOutput': return 'Reading shell output';
    case 'KillBash': return 'Kill shell command';
    case 'Read':
    case 'NotebookRead': return path !== undefined ? md(`Read ${fileLink(path)}`) : 'Read file';
    case 'LS': return path !== undefined ? md(`List ${fileLink(path)}`) : 'List directory';
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': return path !== undefined ? md(`Edit ${fileLink(path)}`) : 'Edit file';
    case 'TodoWrite': return 'Update todo list';
    case 'Grep': {
      const pattern = filled(input.pattern);
      return pattern !== undefined ? md(`Search for ${code(truncate(pattern, 80))}`) : 'Search files';
    }
    case 'Glob': {
      const pattern = filled(input.pattern);
      return pattern !== undefined ? md(`Find files matching ${code(truncate(pattern, 80))}`) : 'Find files';
    }
    case 'WebFetch': {
      const url = filled(input.url);
      return url !== undefined ? md(`Fetching [${label(truncate(url, 80))}](${url})`) : 'Fetching URL';
    }
    case 'Skill': {
      const skill = filled(input.skill);
      return skill !== undefined ? md(`Running skill ${code(truncate(skill, 80))}`) : 'Running skill';
    }
    case 'TaskCreate': {
      const subject = filled(input.subject);
      return subject !== undefined ? `Create task: ${truncate(subject, 80)}` : 'Create task';
    }
    case 'TaskUpdate':
      switch (input.status) {
        case 'in_progress': return 'Start task';
        case 'completed': return 'Complete task';
        case 'deleted': return 'Delete task';
        default: return 'Update task';
      }
    case 'TaskList': return 'Read task list';
    case 'TaskGet': return 'Read task';
    default: {
      const subject = summarize(name, input)?.split('\n').find((line) => line.trim() !== '');
      return subject === undefined ? name : truncate(subject, 80);
    }
  }
}

/**
 * The line a call's row draws once it has ended, whether it succeeded or not:
 * a failure is the result's `success`, not its line.
 *
 * The same rule as {@link lineOf}, with VS Code's past tense for the tools
 * `getClaudePastTenseMessage` maps and the running line for the rest.
 */
export function pastLineOf(name: string, input: Bag): StringOrMarkdown {
  if (DESCRIBED.has(name) && filled(input.description) !== undefined) return lineOf(name, input);
  switch (name) {
    case 'Bash': {
      const first = filled(input.command)?.split('\n')[0];
      return first ? md(`Ran ${code(truncate(first, 80))}`) : 'Ran shell command';
    }
    case 'BashOutput': return 'Read shell output';
    case 'WebFetch': {
      const url = filled(input.url);
      return url !== undefined ? md(`Fetched [${label(truncate(url, 80))}](${url})`) : 'Fetched URL';
    }
    case 'Task':
    case 'Agent': return 'Ran subagent';
    case 'Skill': {
      const skill = filled(input.skill);
      return skill !== undefined ? md(`Ran skill ${code(truncate(skill, 80))}`) : 'Ran skill';
    }
    default: return lineOf(name, input);
  }
}
