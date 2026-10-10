import type { Bag, OnWire } from '@ahpd/sdk';
import { bag, str } from '@ahpd/sdk';
import type { ChatInputAnswer, ChatInputQuestion, ChatInputRequest, StringOrMarkdown } from '@microsoft/agent-host-protocol';

/**
 * What a tool call says about its input, live and read back from a transcript.
 *
 * Three different things: the line a row draws, the subject a status line
 * reads, and the input a client parses.
 */

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

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

/** VS Code's `SUBAGENT_CHAT_TITLE_MAX_LENGTH`: a worker chat's title, before it is cut. */
const TITLE_MAX = 60;

/**
 * What a worker chat is called, from the one-line task its own call described.
 *
 * VS Code's `subagentChatTitle`: the task description, which is the sentence
 * somebody actually wrote and the one thing that tells two workers apart, cut
 * to sixty characters; failing that the kind of agent it is, which says what
 * it is rather than what it was for; failing that `Subagent`, which says only
 * that there is one.
 *
 * One rule for a live chat, one restored from a transcript and the `subagent`
 * block that links the two, so a worker's name does not change when the daemon
 * does - and so six workers spawned by one turn do not all read `Explore`.
 */
export function titleOf(description: string | undefined, agentType: string | undefined): string {
  const task = description?.trim();
  if (task) return truncate(task, TITLE_MAX);
  return agentType?.trim() || 'Subagent';
}

/**
 * The carousel an `AskUserQuestion` asks for, and the map its answers are read
 * back through.
 *
 * The questions keyed `q1`..`qN` in the order they were asked, each titled by
 * its `header` when it has one and an option list keyed by the label the SDK
 * wants the answer valued by. The request's line is the default one, since
 * AskUserQuestion has no header of its own above its questions. The map is from
 * each question's key to the question's own text, which is what an answer is
 * keyed by.
 *
 * One builder for the question a person answers now and the one a transcript
 * draws after a restart, so the two are the same thing rather than two that
 * have to be kept alike.
 */
export function questionRequest(input: Bag, id: string): { request: OnWire<ChatInputRequest>; asked: Map<string, string> } {
  const asked = new Map<string, string>();
  const questions: OnWire<ChatInputQuestion>[] = list(input.questions).map((entry, index) => {
    const question = bag(entry);
    const key = `q${index + 1}`;
    asked.set(key, str(question.question) ?? '');
    const header = str(question.header);
    const carousel = {
      id: key,
      ...(header === undefined || header === '' ? {} : { title: header }),
      message: str(question.question) ?? '',
      required: true,
      // The label is the id, because the label is what the SDK wants back:
      // answers are valued by the option's own label, not by an id.
      options: list(question.options).map((option) => {
        const held = bag(option);
        const label = str(held.label) ?? '';
        const description = str(held.description);
        return {
          id: label,
          label,
          // Carried through because a choice with a name and no explanation is
          // a choice somebody has to guess at, and the agent wrote one for
          // every option it offered.
          ...(description === undefined ? {} : { description }),
        };
      }),
      allowFreeformInput: true,
    };
    return question.multiSelect === true
      ? { ...carousel, kind: 'multi-select' } satisfies OnWire<ChatInputQuestion>
      : { ...carousel, kind: 'single-select' } satisfies OnWire<ChatInputQuestion>;
  });
  return { request: { id, message: 'The agent has a question', questions }, asked };
}

/**
 * What a question was answered, in the shape a client draws it.
 *
 * The SDK keys an answer by the question's own text and a multi-select by the
 * labels picked, which is what a transcript records; a question restored from
 * one is drawn from that, and a client keys the answers on a part by the
 * question's id. So this reads the transcript's key and says it under the id
 * the carousel gave the question, which is what a live completion carries.
 */
export function questionAnswers(request: OnWire<ChatInputRequest>, answers: Bag): Record<string, OnWire<ChatInputAnswer>> {
  const keyed = new Map((request.questions ?? []).map((question) => [question.message, question.id]));
  const out: Record<string, OnWire<ChatInputAnswer>> = {};
  for (const [asked, value] of Object.entries(answers)) {
    const id = keyed.get(asked);
    if (id === undefined) continue;
    out[id] = {
      state: 'submitted',
      value: Array.isArray(value)
        ? { kind: 'selected-many', value: value.map((one) => String(one)) }
        : typeof value === 'string'
          ? { kind: 'selected', value }
          : { kind: 'text', value: String(value) },
    };
  }
  return out;
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
 * A text with one string replaced by another, or nothing when it is not there.
 *
 * `all` replaces every occurrence, as `replace_all` asks, and the first one
 * otherwise. The replacement is a function so a `new_string` holding `$&` or
 * `$'` is written as itself rather than read as a pattern.
 *
 * Nothing for a file that is not there, because there is nothing to replace in
 * it. Nothing for an empty `old_string` either: it is in every text, so
 * replacing it would insert the new text at the start of a file no `Edit`
 * asked to change.
 */
const swapped = (current: string | undefined, old: string, next: string, all: boolean): string | undefined => {
  if (current === undefined || old === '' || !current.includes(old)) return undefined;
  return all ? current.split(old).join(next) : current.replace(old, () => next);
};

/**
 * The file a write tool would change, and the text it would leave there.
 *
 * Only the three tools whose input holds the whole of what they would write.
 * `Write` carries the text; `Edit` and `MultiEdit` name a string to replace,
 * so the text they would leave is made by reading the file back with that
 * string swapped - which is what `apply` is for, and why it is handed the file
 * rather than a promise of one. `NotebookEdit` writes a cell of a notebook and
 * is not one of them.
 *
 * Nothing for a tool this does not cover, or for an input with no path in it:
 * a call that names no file is a call with nothing to preview.
 */
export function writeOf(name: string, input: Bag): { path: string; apply: (current: string | undefined) => string | undefined } | undefined {
  const path = filled(input[PATHS[name] ?? '']);
  if (path === undefined) return undefined;

  if (name === 'Write') {
    const content = str(input.content);
    return content === undefined ? undefined : { path, apply: () => content };
  }

  if (name === 'Edit') {
    const old = str(input.old_string);
    const next = str(input.new_string);
    if (old === undefined || next === undefined) return undefined;
    return { path, apply: (current) => swapped(current, old, next, input.replace_all === true) };
  }

  if (name === 'MultiEdit') {
    const steps: { old: string; next: string; all: boolean }[] = [];
    for (const entry of list(input.edits)) {
      const held = bag(entry);
      const old = str(held.old_string);
      const next = str(held.new_string);
      // An edit that names no string is one that cannot be carried out, and a
      // preview of the list without it would be of a file the tool will not
      // write - so the whole call goes unpreviewed rather than half of it.
      if (old === undefined || next === undefined) return undefined;
      steps.push({ old, next, all: held.replace_all === true });
    }
    if (steps.length === 0) return undefined;
    return {
      path,
      apply: (current) => {
        // In order, each over what the one before it left, which is what the
        // tool does: the second edit may name a string the first one wrote.
        let text = current;
        for (const step of steps) {
          text = swapped(text, step.old, step.next, step.all);
          if (text === undefined) return undefined;
        }
        return text;
      },
    };
  }

  return undefined;
}

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
