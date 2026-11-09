import type { LogLevel } from '@ahpd/sdk';
/**
 * The models a Claude harness offers, when its operator names them.
 *
 * The CLI only knows Anthropic's names, so a harness pointed at another
 * endpoint names its own: `models` writes them by id, and `modelSources`
 * fetches an endpoint's model list and keeps the ids that match a pattern.
 */

/** One model as a picker draws it. */
export interface OfferedModel {
  id: string;
  name: string;
  /** Per-model options, which only the CLI's own models carry. */
  configSchema?: Record<string, unknown>;
}

/**
 * A key a fetch entry sends as its bearer token.
 *
 * The channel opens a record with its config resolved, so a record's `key`
 * arrives as the token's text whether it was written as `{ fromEnv }` or as a
 * `$secret`. A preset, or any caller that did not pass through the channel,
 * still holds `{ fromEnv }`, which names the daemon variable to read.
 */
export type ModelKey = string | { fromEnv: string };

/** One entry of the `models` option: a model id, and the name it is drawn with. */
export interface ModelEntry {
  id: string;
  name?: string;
}

/**
 * One entry of the `modelSources` option.
 *
 * `fetch` is a URL answering an OpenAI-shaped `{ data: [{ id, name? }] }`,
 * `match` keeps the ids it covers (`*` is any run of characters), and `key` is
 * the bearer token sent with the request.
 */
export interface ModelSource {
  fetch: string;
  match?: string;
  key?: ModelKey;
}

/** Whether a value is a token's text or the daemon variable it is read from. */
const isKey = (value: unknown): value is ModelKey => {
  if (typeof value === 'string') return value !== '';
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && typeof (value as { fromEnv?: unknown })['fromEnv'] === 'string';
};

/** The model Claude Code names on an assistant message it wrote itself, such as an API error. */
const SYNTHETIC = '<synthetic>';

/**
 * The model an assistant message ran on, or nothing for one no model wrote.
 *
 * The message itself is still a turn's content; only its model is not one the
 * session ran on.
 */
export const ranOn = (model: unknown): string | undefined =>
  (typeof model === 'string' && model !== SYNTHETIC ? model : undefined);

/**
 * What is wrong with a `models` list, named; nothing when it holds.
 *
 * `by` names the option the list was written under, which is a preset's when a
 * preset holds one, so the problem says where to look.
 */
export const modelsProblem = (value: unknown, by = 'options.models'): string | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return `${by} is not a list`;
  for (const [index, entry] of value.entries()) {
    const at = `${by}[${String(index)}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return `${at} is not an object with an id`;
    const held = entry as Record<string, unknown>;
    if (typeof held.id !== 'string' || held.id === '') return `${at} has no id`;
    if (held.name !== undefined && typeof held.name !== 'string') return `${at}.name is not a string`;
  }
  return undefined;
};

/** What is wrong with a `modelSources` list, named; nothing when it holds. */
export const sourcesProblem = (value: unknown, by = 'options.modelSources'): string | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return `${by} is not a list`;
  for (const [index, entry] of value.entries()) {
    const at = `${by}[${String(index)}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return `${at} is not an object with a fetch`;
    const held = entry as Record<string, unknown>;
    if (typeof held.fetch !== 'string' || held.fetch === '') return `${at} has no fetch`;
    if (held.match !== undefined && typeof held.match !== 'string') return `${at}.match is not a string`;
    if (held.key !== undefined && !isKey(held.key)) return `${at}.key is not a string or { fromEnv }`;
  }
  return undefined;
};

/** A `*` pattern as a whole-id test. */
const matcher = (pattern: string | undefined): ((id: string) => boolean) => {
  if (pattern === undefined || pattern === '' || pattern === '*') return () => true;
  const source = pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, '\\$&')).join('.*');
  const test = new RegExp(`^${source}$`, 'u');
  return (id) => test.test(id);
};

/**
 * The bearer token a fetch entry's `key` names.
 *
 * A record's key is already the text the channel resolved, so it is sent as it
 * is; a `{ fromEnv }` names a variable of the daemon's own environment.
 */
export const tokenOf = (key: ModelKey | undefined): string | undefined => {
  if (key === undefined) return undefined;
  return typeof key === 'string' ? key : process.env[key.fromEnv];
};

/** One source's models; nothing, and a line said, when the endpoint fails. */
const fetched = async (
  entry: ModelSource,
  log: (line: string, level?: LogLevel) => void,
  get: typeof fetch,
): Promise<OfferedModel[]> => {
  const token = tokenOf(entry.key);
  try {
    const answer = await get(entry.fetch, token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } });
    if (!answer.ok) throw new Error(`HTTP ${String(answer.status)}`);
    const body = await answer.json() as { data?: unknown };
    const keep = matcher(entry.match);
    return (Array.isArray(body.data) ? body.data : [])
      .map((raw) => raw as { id?: unknown; name?: unknown })
      .filter((one): one is { id: string; name?: unknown } => typeof one.id === 'string' && keep(one.id))
      .map((one) => ({ id: one.id, name: typeof one.name === 'string' && one.name !== '' ? one.name : one.id }));
  }
  catch (error) {
    // A fetch layer may quote what it was handed, so the token never reaches the
    // line even when it is in the error's own words.
    const said = error instanceof Error ? error.message : String(error);
    log(`models from ${entry.fetch} could not be read: ${token === undefined || token === '' ? said : said.replaceAll(token, '<redacted>')}`, 'error');
    return [];
  }
};

/**
 * Every model the two lists name, each id once: the written models first, in
 * their order, then each source's list, in the order the sources are written.
 */
export const ownModels = async (
  models: readonly ModelEntry[] = [],
  sources: readonly ModelSource[] = [],
  log: (line: string, level?: LogLevel) => void = () => {},
  get: typeof fetch = fetch,
): Promise<OfferedModel[]> => {
  const lists = await Promise.all([
    ...models.map(async (entry): Promise<OfferedModel[]> => [{ id: entry.id, name: entry.name ?? entry.id }]),
    ...sources.map(async (entry): Promise<OfferedModel[]> => fetched(entry, log, get)),
  ]);
  return unique(lists.flat());
};

/** The first of each id. */
const unique = <T extends { id: string }>(models: readonly T[]): T[] => {
  const seen = new Set<string>();
  return models.filter((one) => (seen.has(one.id) ? false : (seen.add(one.id), true)));
};

/**
 * What the harness offers: the CLI's list without `models`, the named ones
 * with it, and both, the CLI's first, with `keepCliModels`.
 */
export const offeredModels = <T extends OfferedModel>(
  cli: readonly T[],
  own: readonly OfferedModel[] | undefined,
  keepCliModels: boolean | undefined,
): (T | OfferedModel)[] => {
  if (own === undefined) return [...cli];
  return keepCliModels === true ? unique<T | OfferedModel>([...cli, ...own]) : [...own];
};
