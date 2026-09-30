/**
 * Whether a session config value is one its schema property still offers.
 *
 * What a session property can say about a value, and no more: the JSON `type`
 * it declares and, for a fixed list, the `enum` it is one of. A stored value
 * is checked against the schema a backend publishes now, which may have
 * renamed or dropped what the value names since it was written.
 *
 * Hand-written for the reason `validate.ts` is: ahpd has no runtime
 * dependency, and a whole JSON Schema validator is far more than these two
 * questions need. Anything else a property says - `items`, `properties`,
 * `required` - is not checked, so a value is refused only for what a property
 * certainly rules out.
 */

/** The JSON type of a value, in JSON Schema's words. */
const typeOf = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
};

/** Whether a value is of one declared type. An integer is a number too. */
const ofType = (value: unknown, declared: unknown): boolean => {
  const actual = typeOf(value);
  return declared === actual || (declared === 'number' && actual === 'integer');
};

/**
 * Whether a property accepts a value.
 *
 * A property that is not an object accepts nothing, since there is no key to
 * put the value under. An `enum` marked `enumDynamic` is the first page of a
 * list a client asks for, so a value not on it is not refused for that.
 */
export function accepts(property: unknown, value: unknown): boolean {
  if (typeof property !== 'object' || property === null || Array.isArray(property)) return false;
  const one = property as { type?: unknown; enum?: unknown; enumDynamic?: unknown };
  if (one.type !== undefined) {
    const types = Array.isArray(one.type) ? one.type : [one.type];
    if (!types.some((declared) => ofType(value, declared))) return false;
  }
  if (Array.isArray(one.enum) && one.enumDynamic !== true) {
    const said = JSON.stringify(value);
    if (!one.enum.some((allowed) => JSON.stringify(allowed) === said)) return false;
  }
  return true;
}
