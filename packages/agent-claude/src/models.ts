/**
 * The models a Claude harness offers, when its operator names them.
 *
 * The CLI only knows Anthropic's names, so a harness pointed at another
 * endpoint names its own: by id, or by fetching the endpoint's model list and
 * keeping the ids that match a pattern.
 */

/** One model as a picker draws it. */
export interface OfferedModel {
  id: string;
  name: string;
  /** Per-model options, which only the CLI's own models carry. */
  configSchema?: Record<string, unknown>;
}

/**
 * One entry of the `models` option.
 *
 * A model id, a model with a name, or a fetch: `fetch` is a URL answering an
 * OpenAI-shaped `{ data: [{ id, name? }] }`, `match` keeps the ids it covers
 * (`*` is any run of characters), and `key` names the daemon variable sent as
 * a bearer token.
 */
export type ModelEntry =
  | string
  | { id: string; name?: string }
  | { fetch: string; match?: string; key?: { fromEnv: string } };

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
    if (typeof entry === 'string') {
      if (entry === '') return `${at} is an empty id`;
      continue;
    }
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return `${at} is not a model id or an object`;
    const held = entry as Record<string, unknown>;
    if (typeof held.id === 'string' && held.id !== '') {
      if (held.name !== undefined && typeof held.name !== 'string') return `${at}.name is not a string`;
      continue;
    }
    if (typeof held.fetch === 'string' && held.fetch !== '') {
      if (held.match !== undefined && typeof held.match !== 'string') return `${at}.match is not a string`;
      const key = held.key as Record<string, unknown> | undefined;
      if (key !== undefined && (typeof key !== 'object' || key === null || typeof key.fromEnv !== 'string')) {
        return `${at}.key is not { fromEnv }`;
      }
      continue;
    }
    return `${at} has neither an id nor a fetch`;
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

/** One fetch entry's models; nothing, and a line said, when the endpoint fails. */
const fetched = async (
  entry: { fetch: string; match?: string; key?: { fromEnv: string } },
  log: (line: string) => void,
  get: typeof fetch,
): Promise<OfferedModel[]> => {
  const token = entry.key === undefined ? undefined : process.env[entry.key.fromEnv];
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
    log(`models from ${entry.fetch} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
};

/** Every model the `models` option names, in its order, each id once. */
export const ownModels = async (
  entries: readonly ModelEntry[],
  log: (line: string) => void = () => {},
  get: typeof fetch = fetch,
): Promise<OfferedModel[]> => {
  const lists = await Promise.all(entries.map(async (entry): Promise<OfferedModel[]> => {
    if (typeof entry === 'string') return [{ id: entry, name: entry }];
    if ('id' in entry) return [{ id: entry.id, name: entry.name ?? entry.id }];
    return fetched(entry, log, get);
  }));
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
