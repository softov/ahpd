/*
 * A capture, run through the strict schema.
 *
 * The command over `wire.mjs`, which is the same check the suite runs against
 * the frames its own tests produce. This one takes a recording off a real
 * daemon - `scripts/tee.mjs` writes them - so what a client and this host
 * actually exchanged can be checked without either of them being changed.
 *
 *   node tools/validate.mjs <capture.jsonl> [--limit N] [--verbose]
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checker, collapse, framesIn, SCHEMA, stale } from './wire.mjs';

const [file] = process.argv.slice(2).filter((one) => !one.startsWith('--'));
if (!file) {
  process.stderr.write('usage: node tools/validate.mjs <capture.jsonl> [--limit N] [--verbose]\n');
  process.exit(2);
}
const verbose = process.argv.includes('--verbose');
const limit = process.argv.includes('--limit')
  ? Number(process.argv[process.argv.indexOf('--limit') + 1])
  : Infinity;

/*
 * Said rather than fixed. This command reads a capture somebody took, and a
 * finding drawn against a schema built from a package that is not the one
 * installed describes a protocol this host no longer speaks; regenerating it
 * under the reader would quietly replace the question being asked.
 */
if (stale()) {
  process.stderr.write(`${fileURLToPath(SCHEMA)} was built from another @microsoft/agent-host-protocol; run \`node tools/schema.mjs\` first\n`);
  process.exit(2);
}

const wire = checker();
const defects = [];
let frames = 0;
for (const frame of framesIn(readFileSync(file, 'utf8'))) {
  if (frames >= limit) break;
  frames += 1;
  defects.push(...wire.frame(frame));
}

const found = collapse(defects);
process.stdout.write(
  `${file}: ${frames} frames, ${wire.checked()} payloads checked against ${wire.declarations} declarations\n`,
);
if (found.length === 0) process.stdout.write('nothing undeclared, nothing missing\n');
for (const [key, entry] of found) {
  process.stdout.write(`  x${entry.count}  ${key}${verbose ? `   (${entry.sample})` : ''}\n`);
}
const skipped = wire.skipped();
if (skipped.size > 0 && verbose) {
  process.stdout.write(`no declaration for: ${[...skipped.keys()].sort().join(', ')}\n`);
}
process.exit(found.length > 0 ? 1 : 0);
