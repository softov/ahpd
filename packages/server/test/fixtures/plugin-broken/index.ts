/**
 * A fixture that is not a plugin: it exports no `apply`.
 *
 * The loader has to refuse it by name rather than reaching `createHost` with a
 * module it cannot call, and the test loads a good plugin after it to prove
 * one bad spec does not stop the rest.
 */

export const name = 'broken';

export function notApply(): string {
  return 'no apply here';
}
