/**
 * The `policy:` scheme.
 *
 * One URI is one row and the scheme's root is a directory of them, exactly as
 * `people.ts` serves `user:`, `team:`, `project:` and `role:` - decision
 * `policies-are-a-scheme-clients-edit`. A client edits policies the way it edits
 * people: it reads the manifest, draws a form, writes a body and reads it back.
 *
 * This is another door onto the `Policies` port, not a second set of rules. A
 * body the port would refuse is refused here with the same sentence, because
 * `checkPolicy` is what the port itself calls.
 *
 * Whether a row binds is not this scheme's business: a host is told to check
 * through `policiesCheck`, and `decide` does the checking.
 */

import { checkPolicy, EFFECTS, KINDS, LIMIT_POOLS, MATCHES, MEASURES, PERIODS } from './policies.js';
import { line, lines, recordsProvider, type Records, type RecordsProvider } from './records.js';
import type { Policies } from './types/policies.js';

/** The scheme, which is also its grant subject. */
const SCHEMES = ['policy'] as const;

/**
 * What this provider implements.
 *
 * The provider itself is `records.ts`'s, over the store: these are this
 * scheme's `Records`, and what a client sees of them is the shared one's rules.
 */
export type PolicyProvider = RecordsProvider;

/** The values a field may take, as the schema keyword that says so. */
const enums = (values: readonly string[]): Record<string, unknown> => ({ enum: [...values] });

/**
 * One manifest field that is a line of text out of a table, which is what a
 * form draws a picker from rather than a box to type into.
 *
 * The values are `checkPolicy`'s own, so what a form offers is what the check
 * takes: the description carries no list of them, because a list in prose is
 * the copy that goes stale the day a host adds one.
 */
const choice = (title: string, description: string, values: readonly string[]): Record<string, unknown> =>
  ({ type: 'string', title, description, ...enums(values) });

/** Every measure there is, in the order the kinds name them. */
const ALL_MEASURES = [...new Set(KINDS.flatMap((kind) => MEASURES[kind]))];

/**
 * Which measures and which match types a kind takes, as one `allOf` entry per
 * kind.
 *
 * JSON Schema says "only for this kind" with `if`/`then`, so a validator such
 * as ajv reads it and a client that knows nothing beyond `properties` sees the
 * union and is no worse off than it was.
 */
const narrowed = KINDS.map((kind) => ({
  if: { properties: { kind: { const: kind } }, required: ['kind'] },
  then: {
    properties: {
      limits: { items: { properties: { measure: enums(MEASURES[kind]) } } },
      match: { propertyNames: enums(MATCHES[kind]) },
    },
  },
}));

const TITLE = 'Policies';
const ABOUT = 'Who may use which agent, model and computer, and how much.';

const manifest: Record<string, unknown> = {
  type: 'object',
  properties: {
    scope: line('Scope', 'Who the row is about: `all`, `user:<id>`, `team:<id>` or `project:<team>:<project>`.'),
    kind: choice('Kind', 'What it is about: a proxy call, a harness this host runs, or a machine.', KINDS),
    effect: choice('Effect', 'Any matching deny wins over any allow.', EFFECTS),
    match: {
      title: 'Match',
      description: 'What it applies to. Values of one type are alternatives and values of different types must all hold. A type left out allows any value of it.',
      type: 'object',
      properties: {
        model: lines('Models', '`<maker>/<name>`, where `*` stands for any run of characters within the value.'),
        proxy: lines('Proxies', 'Which provider the model may be called through. `model` rows only.'),
        agent: lines('Agents', 'The harness, as `claude`, `pi`, `cofold` or `acp:<server>`.'),
        computer: lines('Computers', 'The machine, as the `computers` port names it.'),
      },
    },
    limits: {
      title: 'Limits',
      description: 'How much may be used. Every limit must have room.',
      type: 'array',
      items: {
        type: 'object',
        properties: {
          amount: { type: 'number', minimum: 0, title: 'Amount', description: 'How much, in the measure. Never negative.' },
          measure: choice('Measure', 'What the limit is counted in, of the ones the kind takes.', ALL_MEASURES),
          period: choice('Period', 'The window the limit is counted over.', PERIODS),
          pool: choice('Pool', 'Whether the group shares this total or every member has their own.', LIMIT_POOLS),
        },
      },
    },
    pool: line('Pool', 'A name several rows draw from one total under.'),
    cap: { type: 'boolean', title: 'Cap', description: 'Count usage without charging it.' },
    from: line('From', 'When the row starts, as an ISO 8601 instant or a `YYYY-MM-DD` day.'),
    until: line('Until', 'When the row ends, as an ISO 8601 instant or a `YYYY-MM-DD` day. A bare day includes all of it.'),
  },
  required: ['scope', 'kind', 'effect', 'match'],
  allOf: narrowed,
};

/**
 * The `policy:` records, over the store.
 *
 * `checkPolicy` is the port's own check, so a body the store would refuse is
 * refused here in the same words, and what a client reads back is the row the
 * store holds rather than the body it sent.
 */
const records = (store: Policies): Records => ({
  title: TITLE,
  description: ABOUT,
  manifest,
  ids: async () => (await store.list()).map((one) => one.id),
  find: async (id) => {
    const held = await store.get(id);
    return held === undefined ? undefined : { ...held } as Record<string, unknown>;
  },
  put: async (id, body, was) => {
    /*
     * A field the body does not name is the one the row already had, and the id
     * is the address rather than anything the body says.
     *
     * A client that read a row and drew a form from it sends back what it
     * changed, not the whole row, and a write that dropped what it left out
     * would make every edit a rewrite. An empty body is an empty object rather
     * than a refusal, so a client writing nothing to an id that is not there
     * means exactly that - and the port refuses it as the row it is not.
     */
    await store.put(checkPolicy({ ...(was ?? {}), ...body, id }));
  },
  // Nothing refuses a removal here: no membership and no record names a policy,
  // so an id nothing holds is the only way this fails.
  drop: async (id) => store.remove(id),
});

/**
 * The `policy:` provider, over a store.
 *
 * One scheme, so this answers a `Record<string, PolicyProvider>` like
 * `peopleProviders` does and sits in the same `resourceProviders` map beside
 * them rather than in a second spread.
 */
export const policyProviders = (store: Policies): Record<string, PolicyProvider> =>
  Object.fromEntries(SCHEMES.map((what) => [what, recordsProvider(what, records(store))]));