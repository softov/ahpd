/*
 * A package with no `ahpd` key at all.
 *
 * The package's own `exports` is enough to find the entry, and the package
 * `name` is what a listing prints where the manifest supplies no title. The
 * loader never imports it in the listing test, which is the point.
 */

export const name = 'plain';

export function apply() {}
