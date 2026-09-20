/*
 * What version of this package is running.
 *
 * The loader checks a plugin's `peerDependencies["@ahpd/sdk"]` against the SDK
 * it is actually running beside, and this is what answers that question. Read
 * from the manifest rather than written twice for the reason `packages/server`'s
 * copy gives: a literal in the source is a literal that drifts, and a
 * compatibility check against a drifted number is worse than none.
 *
 * Found by walking up from this module rather than by a fixed relative path,
 * because the depth differs - `src/version.ts` in this checkout and
 * `dist/version.js` in an install - and `package.json` is always at the
 * package root, so the first one above this file is this package's.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The version in the nearest `package.json`, or `unknown` where there is none. */
export const sdkVersion = (): string => {
  let at = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    try {
      const found = JSON.parse(readFileSync(join(at, 'package.json'), 'utf8')) as { version?: unknown };
      if (typeof found.version === 'string') return found.version;
    }
    catch { /* not this directory */ }
    const up = dirname(at);
    if (up === at) return 'unknown';
    at = up;
  }
};
