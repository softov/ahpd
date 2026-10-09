/**
 * Frozen copies, for everything that crosses the plugin boundary.
 *
 * A value the host hands a plugin, and a value a plugin hands the host, is
 * copied and then frozen: the copy so a later write by either side changes
 * nothing the other reads, and the freeze so the write is refused where it is
 * made rather than quietly lost. This guards the host against a plugin's
 * writes; it does not sandbox a plugin, which is trusted code either way -
 * decision `a-plugin-gets-frozen-copies-of-host-values`.
 *
 * `frozenCopy` is for plain data, which is what a JSON document holds. A value
 * with methods, such as a store or a principal, is built new and frozen with
 * `Object.freeze`, because a method is not something a copy can carry and the
 * object is the host's own to shape.
 */

/** Whether a value has properties, which is what a freeze reaches. */
const copyable = (value: unknown): value is object => value !== null && typeof value === 'object';

/**
 * Copy plain data, and freeze the copy through and through.
 *
 * The source is untouched, and the copy shares nothing with it: a nested object
 * or array the caller still holds is not the one the callee gets. A value with
 * a function anywhere under it is refused by `structuredClone` itself, which is
 * the honest answer - a function is behaviour, and what crosses this boundary
 * is data.
 */
export function frozenCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

/**
 * Freeze a value and everything under it.
 *
 * In place, and the value itself back, so a literal can be built and frozen in
 * one expression: `Object.freeze` alone reaches one level, and every nested
 * record a plugin could write to is a level below it.
 *
 * A cycle is frozen once and not walked again - `structuredClone` copies one,
 * so one can arrive here - and a `Map` or a `Set` is frozen as an object,
 * which stops its own properties being replaced and not its contents: neither
 * is plain data, and neither is what this boundary carries.
 */
export function deepFreeze<T>(value: T): T {
  const seen = new WeakSet<object>();
  const walk = (one: unknown): void => {
    if (!copyable(one) || seen.has(one)) return;
    seen.add(one);
    Object.freeze(one);
    for (const under of Object.values(one as Record<string, unknown>)) walk(under);
  };
  walk(value);
  return value;
}
