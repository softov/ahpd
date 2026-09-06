/*
 * The shared `resourceWrite` conformance fixture, run against this host.
 *
 * `test/fixtures/resource-write.json` is checked into this repository and into
 * `ahpc` byte for byte, and each runs it against its own copy of the
 * algorithm - AHP's write is symmetrical, so a host asks a client for one
 * exactly as a client asks a host, and the two implementations have to agree
 * on every flag, every precondition and every clamp. They were wrong together
 * once and corrected together once; this is what turns the next divergence
 * into a failing build rather than something a review has to notice.
 *
 * The other runner is `ahpc`'s `test/resource-write.test.ts`.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { resolve, write } from '../packages/sdk/src/resources.js';
import type { Write } from '../packages/sdk/src/types/resources.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/resource-write.json'), 'utf8')) as Fixture;

interface Case {
  name: string;
  path?: string;
  before: 'absent' | 'directory' | { file: string } | { symlinkTo: string };
  write: Record<string, unknown>;
  then: { content?: string; absent?: boolean; refusal?: string; elsewhere?: string };
}
interface Fixture { revision: string; cases: Case[] }

/** The codes this host answers with, under the names the fixture uses. */
const REFUSALS: Record<string, number> = {
  notFound: -32008,
  refused: -32009,
  alreadyExists: -32010,
  conflict: -32011,
};

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ahpd-write-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

for (const one of fixture.cases) {
  it(one.name, async () => {
    const relative = one.path ?? 'file.txt';
    const at = join(root, relative);
    mkdirSync(dirname(at), { recursive: true });

    if (one.before === 'directory') mkdirSync(at);
    else if (typeof one.before === 'object' && 'file' in one.before) writeFileSync(at, one.before.file);
    else if (typeof one.before === 'object' && 'symlinkTo' in one.before) {
      writeFileSync(join(root, one.before.symlinkTo), 'not this');
      symlinkSync(join(root, one.before.symlinkTo), at);
    }
    if (one.before === 'absent' && one.path !== undefined) rmSync(dirname(at), { recursive: true, force: true });

    const uri = pathToFileURL(at).href;
    const roots = [root];
    /*
     * The etag from this end's own `resolve`.
     *
     * Read rather than computed, because a fixture that carried a literal tag
     * would be a fixture about `stat` output. `stale` is a tag no file has.
     */
    let ifMatch = one.write.ifMatch as string | undefined;
    if (ifMatch === 'current') {
      ifMatch = (await resolve(uri, roots)).etag;
      expect(ifMatch, 'the fixture asked for the current etag and this end has none').toBeTypeOf('string');
    }
    else if (ifMatch === 'stale') ifMatch = 'W/"0-0"';

    const content = {
      ...one.write,
      encoding: (one.write.encoding as string | undefined) ?? 'utf8',
      ...(ifMatch === undefined ? {} : { ifMatch }),
    } as unknown as Write;
    const asked = write(uri, roots, content);

    if (one.then.refusal !== undefined) {
      const refused = await asked.then(() => undefined, (error: unknown) => error);
      expect(refused, 'this was supposed to be refused').toBeInstanceOf(Error);
      expect((refused as { code?: number }).code).toBe(REFUSALS[one.then.refusal]);
    }
    else await asked;

    if (one.then.content !== undefined) expect(readFileSync(at, 'utf8')).toBe(one.then.content);
    if (one.then.absent === true) expect(existsSync(at)).toBe(false);
    if (one.then.elsewhere !== undefined) {
      // A link that was followed writes through it, and the file it points at
      // is the only place that shows.
      const target = (one.before as { symlinkTo: string }).symlinkTo;
      expect(readFileSync(join(root, target), 'utf8')).toBe(one.then.elsewhere);
    }
  });
}
