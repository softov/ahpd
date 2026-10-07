/*
 * The protocol's conformance cases, copied out of a tag.
 *
 * `packages/sdk/test/fixtures/ahp-test-cases` is a copy of `types/test-cases`
 * from the protocol repository, and the suite that runs it refuses to run
 * while the copy and the installed package disagree. So a protocol bump is
 * two steps: bump the package, then point this at the tag that publishes it.
 *
 *   node tools/ahp-test-cases.mjs v1.0.0 --from ../agent-host-protocol
 *
 * The checkout is given rather than fetched. Nothing here reaches the network:
 * a copy taken from a moving branch is a copy that cannot be read back, and
 * the whole use of these cases is that the next run reads the same bytes as
 * this one.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CASES = join(ROOT, 'packages/sdk/test/fixtures/ahp-test-cases');
const PACKAGE = join(ROOT, 'node_modules/@microsoft/agent-host-protocol/package.json');
const UPSTREAM = 'types/test-cases';

const argv = process.argv.slice(2);
const tag = argv.find((one) => !one.startsWith('--') && argv[argv.indexOf(one) - 1] !== '--from');
const repo = argv.includes('--from') ? argv[argv.indexOf('--from') + 1] : undefined;
if (!tag || !repo) {
  process.stderr.write('usage: node tools/ahp-test-cases.mjs <tag> --from <checkout of the protocol repository>\n');
  process.exit(2);
}

/** The git command's output, as text, or nothing when it said nothing. */
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });

let commit;
try {
  commit = git('rev-parse', `${tag}^{commit}`).trim();
} catch {
  process.stderr.write(`${repo} has no tag ${tag}\n`);
  process.exit(2);
}

/*
 * The copy is of one protocol version, and the schema the suite checks frames
 * against is built from the installed package. A copy of one version beside a
 * package of another is a suite checking frames against cases that describe a
 * protocol this host does not speak, so the two are compared before anything
 * is written rather than after.
 */
const published = JSON.parse(git('show', `${commit}:package.json`)).version;
const installed = JSON.parse(readFileSync(PACKAGE, 'utf8')).version;
if (published !== installed) {
  process.stderr.write(`${tag} publishes ${published} and ${installed} is installed; bump the package first\n`);
  process.exit(2);
}

const wanted = git('ls-tree', '-r', '--name-only', commit, UPSTREAM)
  .split('\n')
  .filter((one) => one.startsWith(`${UPSTREAM}/`) && one.length > UPSTREAM.length + 1);
if (wanted.length === 0) {
  process.stderr.write(`${tag} has no ${UPSTREAM}\n`);
  process.exit(2);
}

const wrote = [];
for (const path of wanted) {
  const to = join(CASES, relative(UPSTREAM, path));
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, git('show', `${commit}:${path}`));
  wrote.push(to);
}

/*
 * A case the tag dropped is a case this folder would go on running: the suite
 * reads the folder, and a file left behind by a bump is a file that describes
 * the protocol as it was. Pruned, and said out loud.
 */
const kept = new Set([...wrote, join(CASES, 'SOURCE.md')]);
const prune = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const at = join(dir, entry.name);
    if (entry.isDirectory()) prune(at);
    else if (!kept.has(at)) {
      rmSync(at);
      process.stdout.write(`removed ${relative(ROOT, at)}\n`);
    }
  }
};
if (existsSync(CASES)) prune(CASES);

const counted = (where) => readdirSync(join(CASES, where)).filter((one) => one.endsWith('.json')).length;
writeFileSync(join(CASES, 'SOURCE.md'), `# Where these cases came from

The files in this folder are the protocol's own conformance suite, copied unchanged from the repository that publishes \`@microsoft/agent-host-protocol\`.

- Repository: <https://github.com/microsoft/agent-host-protocol.git>
- Tag: \`${tag}\`
- Commit: \`${commit}\`
- Copied: \`types/test-cases/reducers/\` (${counted('reducers')} files), \`types/test-cases/round-trips/\` (${counted('round-trips')} cases and \`KNOWN-FIDELITY-GAPS.md\`) and \`types/test-cases/version-negotiation.json\` (${JSON.parse(git('show', `${commit}:${UPSTREAM}/version-negotiation.json`)).length} rows).

Nothing was edited on the way in. A case that this host cannot run is named in \`packages/sdk/test/ahp-test-cases.test.ts\` with the reason it cannot; the case file itself stays as the protocol wrote it.

The installed package is \`@microsoft/agent-host-protocol@${installed}\`, which is the version this tag publishes. The test reads both and refuses to run a case while they disagree, so a bump that leaves this folder behind fails instead of passing quietly.

To refresh the copy after a protocol bump, run \`node tools/ahp-test-cases.mjs <tag>\` against a checkout of the protocol repository. The script reads every file under \`types/test-cases\` out of that tag and rewrites this file with the tag and the commit it read. The suite never fetches anything itself: the cases are on disk, and a run that reaches the network is not the same run twice.
`);

process.stdout.write(`${commit.slice(0, 12)}: ${wrote.length} files copied into ${relative(ROOT, CASES)}\n`);
