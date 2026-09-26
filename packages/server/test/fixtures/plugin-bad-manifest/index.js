/*
 * The entry of a package whose manifest does not parse.
 *
 * It exists so the directory still resolves - `entryOf` falls back to
 * `index.js` when it cannot read the manifest - which is what puts the
 * malformed `package.json` in front of the loader's manifest check, before
 * `import()` is reached. The flag proves the import never happened.
 */

globalThis.__pluginBadManifestImported = true;

export const name = 'bad-manifest';

export function apply() {}
