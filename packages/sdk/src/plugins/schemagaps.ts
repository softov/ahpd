/**
 * Where a JSON Schema a plugin gave names no value at all.
 *
 * A client draws a form from each schema the host sends. An object with no
 * `properties` and no value schema, an array with no `items`, or a field that
 * says nothing about its type is a hole: a client draws "No parameters
 * defined." or `[object Object]`, and an edit there can destroy what was
 * written. scena draws a schema with no shape at all as JSON text, which is why
 * a bare `{}` is not a gap - it is the one way to say "any JSON value" - while
 * `{ type: 'object' }` is, because it promises an object and names none of it.
 *
 * The check is not a validator and never refuses anything. It walks the
 * keywords a form is drawn from - `properties`, `additionalProperties`,
 * `items` and the branches of `oneOf` and `anyOf` - and reports each hole with
 * the path that reaches it, so the caller can write one problem line and carry
 * on loading.
 */

/** One hole in a schema: where it is, and what is missing there. */
export interface SchemaGap {
  /**
   * The path from the schema's root, such as `env`, `models.items` or
   * `machine.env.*`. Empty when the schema itself is the hole.
   */
  path: string;
  /** What the schema leaves unnamed: `object with no properties`, `array with no items` or `value with no type`. */
  reason: string;
}

/** What an object schema leaves unnamed. */
const NO_PROPERTIES = 'object with no properties';

/** What an array schema leaves unnamed. */
const NO_ITEMS = 'array with no items';

/** What a field with no shape leaves unnamed. */
const NO_TYPE = 'value with no type';

/** Whether a value is a plain object, which every schema node is. */
const isSchema = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The types a schema names, as a list, whether it wrote one or several. */
const typesOf = (schema: Record<string, unknown>): string[] => {
  const held = schema['type'];
  if (typeof held === 'string') return [held];
  if (Array.isArray(held)) return held.filter((one): one is string => typeof one === 'string');
  // No `type` is no types named, not "every type": the caller reads the other
  // keywords to see whether the shape is named another way.
  return [];
};

/**
 * Whether an object schema names what its values are.
 *
 * `properties` with at least one key names them, and so does an
 * `additionalProperties` that is a schema. An empty `properties` names
 * nothing, which is the same hole as leaving it off.
 */
const namesItsValues = (schema: Record<string, unknown>): boolean => {
  const properties = schema['properties'];
  if (isSchema(properties) && Object.keys(properties).length > 0) return true;
  return schema['additionalProperties'] !== undefined && typeof schema['additionalProperties'] !== 'boolean';
};

/**
 * Whether a schema names its own shape without a `type`.
 *
 * JSON Schema reads `properties` as an object and `items` as an array, and a
 * `$ref` names a schema written elsewhere. An `if` is a condition on a value
 * the schema around it names, such as a field required for one kind of a
 * connection. Those are named values, so they are not the "field with no type"
 * this walk reports. A `oneOf`, `anyOf`, `enum` or `const` is named the same
 * way, in the caller.
 */
const namedWithoutType = (schema: Record<string, unknown>): boolean =>
  schema['properties'] !== undefined
  || schema['additionalProperties'] !== undefined
  || schema['items'] !== undefined
  || schema['$ref'] !== undefined
  || schema['if'] !== undefined;

/** One path below another, with a dot only when there is a parent. */
const under = (base: string, tail: string): string => (base === '' ? tail : `${base}.${tail}`);

/**
 * Every gap in one schema, found by walking it.
 *
 * The branches of `oneOf` and `anyOf` are walked because a form offers one of
 * them, and a branch with a hole is a hole. `allOf` is walked too, though it is
 * a conjunction rather than a choice: a hole in one part is a hole in what the
 * value must be. A node is not walked again inside itself, and nothing is
 * followed through a `$ref`, because a reference is a name this walk cannot
 * resolve and a named value is not a gap.
 */
export function schemaGaps(schema: unknown): SchemaGap[] {
  const gaps: SchemaGap[] = [];
  // A schema built in code may hold itself: a node is not walked again inside itself.
  const walking = new Set<object>();

  const walk = (node: unknown, path: string): void => {
    // A boolean schema is `true` (any value) or `false` (none), and a value
    // that is not a schema at all is the caller's to refuse, not this walk's.
    if (!isSchema(node)) return;
    if (walking.has(node)) return;
    walking.add(node);

    const keys = Object.keys(node);
    const unions: [string, unknown][] = [];
    for (const keyword of ['oneOf', 'anyOf', 'allOf']) {
      for (const [index, branch] of (Array.isArray(node[keyword]) ? node[keyword] as unknown[] : []).entries()) {
        unions.push([`${keyword}[${String(index)}]`, branch]);
      }
    }

    const types = typesOf(node);
    const typed = types.length > 0;
    if (types.includes('object') && !namesItsValues(node)) {
      gaps.push({ path, reason: NO_PROPERTIES });
    }
    if (types.includes('array') && node['items'] === undefined) {
      gaps.push({ path, reason: NO_ITEMS });
    }
    const named = node['enum'] !== undefined
      || node['const'] !== undefined
      || unions.length > 0
      || namedWithoutType(node);
    if (!typed && !named && keys.length > 0) {
      gaps.push({ path, reason: NO_TYPE });
    }

    const properties = node['properties'];
    if (isSchema(properties)) {
      for (const [key, value] of Object.entries(properties)) walk(value, under(path, key));
    }
    const additional = node['additionalProperties'];
    if (isSchema(additional)) walk(additional, under(path, '*'));
    const items = node['items'];
    if (Array.isArray(items)) {
      for (const [index, item] of items.entries()) walk(item, under(path, `items[${String(index)}]`));
    }
    else if (items !== undefined) {
      walk(items, under(path, 'items'));
    }
    for (const [tail, branch] of unions) walk(branch, under(path, tail));
    walking.delete(node);
  };

  walk(schema, '');
  return gaps;
}

/**
 * The problem line one gap is said in.
 *
 * `<plugin>: <where> <path>: <gap>`, with the path left off when the schema
 * itself is the hole: `agent-claude: engine claude env: object with no
 * properties`.
 */
export const gapLine = (by: string, where: string, gap: SchemaGap): string =>
  `${by}: ${where}${gap.path === '' ? '' : ` ${gap.path}`}: ${gap.reason}`;
