#!/usr/bin/env node
/*
 * A bump of the parts file, proposed rather than made.
 *
 * The ACP Registry is the feed: an entry is matched by id, and an npm part the
 * registry does not carry is asked about itself. An archive the feed ships a
 * sum for takes that sum, and one it does not is downloaded and hashed here,
 * because a part is built only when its archive matches what is written down.
 *
 *   node scripts/parts-bump.mjs                  # bump what moved
 *   node scripts/parts-bump.mjs --dry-run        # print the moves, write nothing
 *   node scripts/parts-bump.mjs --registry <file>
 *
 * A part that cannot be resolved is skipped by name and the rest of the file
 * still lands, because one archive that 404s is not thirteen agents down.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const REGISTRY = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
const FILE = fileURLToPath(new URL('../packages/computer/images/versions.json', import.meta.url));

/** The two platforms a part is built for, and the registry's name for each. */
const PLATFORMS = { 'linux-x64': 'linux-x86_64', 'linux-arm64': 'linux-aarch64' };

/**
 * An exact version, a download url and a sha256, as the parts file has to hold
 * them, copied from `packages/computer/src/parts.ts` rather than imported.
 *
 * Copied because this runs from `parts-bump.yml`, which installs nothing and
 * builds nothing, so there is no built module to import - and a value this file
 * writes without checking is one the next start refuses the whole file for.
 */
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?(?:\+[0-9A-Za-z.]+)?$/;
const URL_SAFE = /^https:\/\/[A-Za-z0-9._~\/%+-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;

const argv = process.argv.slice(2);
const dry = argv.includes('--dry-run');
const registryAt = argv.indexOf('--registry');
const source = registryAt === -1 ? undefined : argv[registryAt + 1];

/** The registry, by id. A fetch that fails is a failed run, not a quiet one. */
const entriesOf = async () => {
  const body = source === undefined
    ? await (await fetch(REGISTRY)).text()
    : await readFile(source, 'utf8');
  return new Map((JSON.parse(body).agents ?? []).map((entry) => [entry.id, entry]));
};

/** What npm says a package is at, which is the only feed an unlisted part has. */
const npmVersion = (name) => {
  const asked = spawnSync('npm', ['view', name, 'version'], { encoding: 'utf8' });
  return asked.status === 0 ? asked.stdout.trim() : undefined;
};

/** The sum of the file at a url, for an archive the registry ships without one. */
const shaOf = async (url) => {
  let bytes;
  try {
    const said = await fetch(url);
    if (!said.ok) throw new Error(`HTTP ${said.status}`);
    bytes = await said.arrayBuffer();
  } catch (error) {
    throw new Error(`${url} could not be read: ${error.message}`);
  }
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
};

/**
 * Whether `next` is a move worth proposing.
 *
 * Dotted halves compare segment by segment, a missing segment is the older one
 * (`1.2` is not newer than `1.2.1`), and a release is newer than the prerelease
 * before it (`1.2.0` follows `1.2.0-rc.1`). A segment that is not a number
 * compares as a string, which is why the version is put to `EXACT` before it is
 * written: a feed that answers `latest` compares as newer than any version.
 *
 * A prerelease is never what a part moves to. It is a version somebody is still
 * working on, and moving to one would make every host that took the bump build
 * an agent that may still change under the same version - the release it is a
 * candidate for proposes itself a while later.
 */
const newerThan = (next, held) => {
  const [one, tagOne = ''] = String(next).replace(/^v/, '').split('-');
  const [two, tagTwo = ''] = String(held).replace(/^v/, '').split('-');
  if (tagOne !== '') return false;
  if (one !== two) {
    const left = one.split('.');
    const right = two.split('.');
    for (let at = 0; at < Math.max(left.length, right.length); at++) {
      const a = left[at];
      const b = right[at];
      if (a === b) continue;
      if (a === undefined) return false;
      if (b === undefined) return true;
      if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return a > b;
      return Number(a) > Number(b);
    }
  }
  return tagTwo !== '';
};

/** What one part moves to, or the line that says why it does not. */
const bumpOf = async (part, entries) => {
  const entry = entries.get(part.id);

  if (part.kind === 'ahpd') return { skipped: 'ahpd is this repository, and its version moves with the package' };
  if (part.kind === 'node') return { skipped: 'node is not fed by the registry or by npm; move it by hand' };

  if (part.kind === 'npm') {
    const version = entry?.version ?? npmVersion(part.packages[0]);
    if (version === undefined) return { skipped: `npm says nothing about ${part.packages[0]}` };
    if (!newerThan(version, part.version)) {
      return { skipped: `the feed has ${version}, which is not newer than ${part.version}` };
    }
    if (!EXACT.test(version)) return { skipped: `the feed has ${version}, which is not one version` };
    return { version };
  }

  if (part.kind !== 'archive') return { skipped: `a ${part.kind} part is fed by nothing here` };
  if (entry === undefined) return { skipped: 'not in the registry, and its url is a template rather than a feed' };
  if (!newerThan(entry.version, part.version)) {
    return { skipped: `the registry has ${entry.version}, which is not newer than ${part.version}` };
  }
  if (!EXACT.test(entry.version)) {
    return { skipped: `the registry has ${entry.version}, which is not one version` };
  }

  const archives = {};
  for (const [platform, build] of Object.entries(PLATFORMS)) {
    const binary = entry.distribution?.binary?.[build];
    if (binary?.archive === undefined) return { skipped: `the registry has no ${build} build of ${entry.version}` };
    if (!URL_SAFE.test(binary.archive)) {
      return { skipped: `the ${build} archive is ${binary.archive}, which is not a plain https url` };
    }
    const sha256 = binary.sha256 ?? await shaOf(binary.archive);
    if (!SHA256.test(sha256)) {
      return { skipped: `the ${build} archive's sha256 is ${sha256}, which is not 64 hex digits` };
    }
    archives[platform] = { url: binary.archive, sha256 };
  }
  return { version: entry.version, archives };
};

/** A block of plain strings joins back onto one line only while it fits on one. */
const oneLine = (whole, items) => {
  const braces = whole[0] === '{';
  const flat = `${braces ? '{ ' : '['}${items.replace(/\s*,\s*/g, ', ')}${braces ? ' }' : ']'}`;
  return flat.length <= 72 ? flat : whole;
};

/**
 * The file, as it is written: two-space JSON, with a short block of strings on
 * one line, so a bump's diff is the versions and the sums and not the whole
 * file. A block too long for one line stays expanded, which is what an
 * archive entry is.
 */
const layout = (parts) => `${JSON.stringify(parts, null, 2)
  .replace(/\[\s+("[^"]*"(?:\s*,\s*"[^"]*")*)\s+\]/g, oneLine)
  .replace(/\{\s+("[^"]*":\s*"[^"]*"(?:\s*,\s*"[^"]*":\s*"[^"]*")*)\s+\}/g, oneLine)}\n`;

const parts = JSON.parse(await readFile(FILE, 'utf8'));
const entries = await entriesOf();
const moved = [];
const skipped = [];

for (const part of parts) {
  let what;
  try {
    what = await bumpOf(part, entries);
  } catch (error) {
    skipped.push(`${part.id}: ${error.message}`);
    continue;
  }
  if (what.version === undefined) {
    skipped.push(`${part.id}: ${what.skipped}`);
    continue;
  }
  const was = part.version;
  moved.push(`${part.id} ${was} -> ${what.version}${what.archives === undefined ? '' : `, ${Object.keys(what.archives).length} archives`}`);
  part.version = what.version;
  if (what.archives !== undefined) part.archives = what.archives;
}

for (const line of moved) console.log(`bumped ${line}`);
for (const line of skipped) console.log(`skipped ${line}`);

if (moved.length === 0) console.log('Nothing moved.');
else if (dry) console.log(`${FILE} left as it is: --dry-run.`);
else {
  await writeFile(FILE, layout(parts));
  console.log(`Wrote ${FILE}.`);
}
