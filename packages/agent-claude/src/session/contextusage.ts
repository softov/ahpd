import type { Bag } from '@ahpd/sdk';
import { bag, list, str } from './common.js';

/**
 * What fills a turn's context window, as a client draws it.
 *
 * The CLI answers `getContextUsage` in its own shape, with the system prompt's
 * sections, the memory files, the tools, the skills, the agents and the MCP
 * tools each counted. VS Code's context widget reads a flat list of entries,
 * with the conversation itself as the remainder, so this maps one to the
 * other. Both spellings are read: the control answer uses camelCase, and the
 * SDK's own `/context` report uses snake_case.
 */

/** One row of the breakdown, as `IContextAttributionData` reads it. */
export interface ContextEntry {
  /** What the row is. VS Code groups its widget by this. */
  kind: 'system' | 'toolDefinition' | 'skill' | 'subagent' | 'mcpServer';
  /** A name that stays the same for the same row across turns. */
  id: string;
  /** What a client prints. */
  label: string;
  /** How many tokens the row holds. */
  tokens: number;
}

/** The whole breakdown, in `UsageInfoMeta.contextAttribution`'s shape. */
export interface ContextAttribution {
  /** What the entries and the messages add up to. */
  totalTokens: number;
  /** Everything counted except the messages. */
  entries: ContextEntry[];
  /** Automatic compactions in the conversation. The count is not asked for. */
  compactions: { count: number };
}

/** The two keys a turn's usage carries, and nothing else. */
export interface ContextFigure {
  /** VS Code's own breakdown. */
  attribution: ContextAttribution;
  /** The window, the model's limit, and what is left of it. */
  context: Bag;
}

/** The category the CLI counts the conversation under, which a reader counts as the remainder. */
const MESSAGES = 'Messages';

/** The kind of each category the CLI names; any other is part of the system prompt. */
const CATEGORY_KINDS: Record<string, ContextEntry['kind']> = {
  'System prompt': 'system',
  'Memory files': 'system',
  'MCP server instructions': 'system',
  'System tools': 'toolDefinition',
  'MCP tools': 'mcpServer',
  'Custom agents': 'subagent',
  Skills: 'skill',
};

/** A finite number, or nothing. A count of zero is a count. */
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** A list under either spelling of its key, each row read as a bag. */
const rows = (found: Bag, camel: string, snake: string): Bag[] =>
  list(found[camel] ?? found[snake]).map(bag);

/** One row of the answer, when it holds a token count and a name. */
const entryOf = (kind: ContextEntry['kind'], id: string, label: string, row: Bag): ContextEntry | undefined => {
  const tokens = num(row.tokens);
  return tokens === undefined ? undefined : { kind, id, label, tokens };
};

/** What the answer's categories add up to for one kind, if it names one. */
const kindTokens = (categories: Bag[], kind: string): number | undefined => {
  let found: number | undefined;
  for (const category of categories) {
    if (str(category.kind) !== kind) continue;
    const tokens = num(category.tokens);
    if (tokens !== undefined) found = (found ?? 0) + tokens;
  }
  return found;
};

/**
 * The Skills the CLI reported, under either shape.
 *
 * The control answer nests them under `skills.skillFrontmatter`; the SDK's own
 * report is the list itself, and it is absent entirely when nothing is used.
 */
const skillRows = (value: unknown): Bag[] =>
  Array.isArray(value) ? list(value).map(bag) : list(bag(value).skillFrontmatter).map(bag);

/**
 * Map one `getContextUsage` answer to the turn's two `_meta` keys.
 *
 * The entries leave the messages out, because VS Code counts what the entries
 * leave against `totalTokens` as the conversation. `ahpd.context` keeps the
 * names agent-acp already writes for the bar, `used` and `size`, and adds the
 * model's own limit and the space the autocompact buffer and the deferred
 * tools hold. An answer that does not say what it counted is no answer.
 *
 * @param answer the control answer, in either spelling.
 * @param limit the model's hard limit, when a result has taught it.
 */
export const contextOf = (answer: unknown, limit?: number): ContextFigure | undefined => {
  const found = bag(answer);
  const totalTokens = num(found.totalTokens) ?? num(found.total_tokens);
  if (totalTokens === undefined) return undefined;
  const rawMax = num(found.rawMaxTokens) ?? num(found.raw_max_tokens);
  const categories = list(found.categories).map(bag);

  /*
   * The rows that break a category down, by the category's name. The CLI
   * sends only some of them: the system tools and the prompt's sections are
   * often absent, and the category alone says what they hold.
   */
  const details = new Map<string, ContextEntry[]>();
  const add = (category: string, entry: ContextEntry | undefined): void => {
    if (entry !== undefined) details.set(category, [...(details.get(category) ?? []), entry]);
  };
  for (const section of list(found.systemPromptSections).map(bag)) {
    const name = str(section.name) ?? '';
    add('System prompt', name === '' ? undefined : entryOf('system', `system:prompt:${name}`, name, section));
  }
  for (const file of rows(found, 'memoryFiles', 'memory_files')) {
    const path = str(file.path) ?? '';
    add('Memory files', path === '' ? undefined : entryOf('system', `system:memory:${path}`, path, file));
  }
  for (const tool of list(found.systemTools).map(bag)) {
    const name = str(tool.name) ?? '';
    add('System tools', name === '' ? undefined : entryOf('toolDefinition', `toolDefinition:${name}`, name, tool));
  }
  for (const skill of skillRows(found.skills)) {
    const name = str(skill.name) ?? '';
    add('Skills', name === '' ? undefined : entryOf('skill', `skill:${name}`, name, skill));
  }
  for (const agent of list(found.agents).map(bag)) {
    const name = str(agent.agentType) ?? str(agent.agent_type) ?? '';
    add('Custom agents', name === '' ? undefined : entryOf('subagent', `subagent:${name}`, name, agent));
  }
  for (const tool of rows(found, 'mcpTools', 'mcp_tools')) {
    // A deferred tool's schema is not in the window, so it fills nothing.
    if (tool.isLoaded === false) continue;
    const name = str(tool.name) ?? '';
    const server = str(tool.serverName) ?? str(tool.server_name) ?? '';
    add('MCP tools', name === '' ? undefined : entryOf('mcpServer', `mcpServer:${server}:${name}`, name, tool));
  }

  /*
   * The categories the CLI counted are what add up to the total, so each one
   * other than the messages is its rows, and an entry of its own for what
   * the rows do not cover. An answer with no counted category is its rows.
   */
  const counted = categories.filter((category) => str(category.kind) === 'used');
  const entries: ContextEntry[] = counted.length === 0 ? [...details.values()].flat() : [];
  for (const category of counted) {
    const name = str(category.name) ?? '';
    const tokens = num(category.tokens);
    if (name === '' || name === MESSAGES || tokens === undefined) continue;
    const rowsOf = details.get(name) ?? [];
    entries.push(...rowsOf);
    const rest = tokens - rowsOf.reduce((sum, one) => sum + one.tokens, 0);
    if (rest > 0) entries.push({ kind: CATEGORY_KINDS[name] ?? 'system', id: `category:${name}`, label: name, tokens: rest });
  }

  const free = kindTokens(categories, 'free');
  const buffer = kindTokens(categories, 'buffer');
  const deferred = kindTokens(categories, 'deferred');
  const context: Bag = {
    used: totalTokens,
    ...(rawMax === undefined ? {} : { size: rawMax }),
    ...(limit === undefined ? {} : { limit }),
    ...(free === undefined ? {} : { free }),
    ...(buffer === undefined ? {} : { buffer }),
    ...(deferred === undefined ? {} : { deferred }),
  };

  return {
    attribution: { totalTokens, entries, compactions: { count: 0 } },
    context,
  };
};
