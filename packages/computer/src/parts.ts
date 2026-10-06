import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { partTarget } from '@ahpd/sdk';
import type { ComputerRuntime } from './runtime.js';

/**
 * The parts a machine is made of, and the one file that says what they are.
 *
 * A part is one agent CLI, or ahpd itself, at an exact version, built into an
 * image of its own and mounted or copied at `/opt/ahpd/<id>` - decision
 * `an-agent-cli-is-pinned-in-one-versions-file`. Nothing here fetches or builds:
 * this is the file, what it is allowed to say, the Dockerfiles that build them
 * and the tags they answer, so a version move is a pull request and whether an
 * image is already there is one `docker image inspect`.
 */

/** One part, as the versions file names it. */
export interface Part {
  /** The name it is mounted at, under `/opt/ahpd`, and the name of its image. */
  id: string;
  /** What it is called in a listing and in a refusal. */
  name: string;
  /**
   * How it is fetched: an npm package, a download per platform, the Node
   * distribution, or ahpd itself.
   */
  kind: 'npm' | 'archive' | 'ahpd' | 'node';
  /** The exact version, never a range - decision `an-agent-cli-is-pinned-in-one-versions-file`. */
  version: string;
  /** The npm packages it is, all at this part's version. */
  packages?: string[];
  /** One download per platform, each checked by sha256. */
  archives?: Record<string, { url: string; sha256: string }>;
  /** The commands in its own `bin`, which is what a machine puts on its `PATH`. */
  bin: string[];
  /** The parts that have to be there first; `node` is one of them for everything installed by npm. */
  requires?: string[];
  /** The environment that switches this CLI's own update off, set by its launcher. */
  updates?: Record<string, string>;
  /** The backends that run nested inside a machine, which the `ahpd` part installs for itself. */
  plugins?: string[];
}

/** Where the file is, in a checkout and in an installed package alike. */
export const versionsPath = (): string => fileURLToPath(new URL('../images/versions.json', import.meta.url));

/** The kinds an entry may say, so a typo is a refusal rather than a part nothing can build. */
const KINDS = ['npm', 'archive', 'ahpd', 'node'] as const;

/**
 * An exact version, which is what the file has to hold.
 *
 * A range would let two hosts building the same tag run different agents, which
 * is the whole thing pinning is against - decision
 * `an-agent-cli-is-pinned-in-one-versions-file`.
 */
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?(?:\+[0-9A-Za-z.]+)?$/;

/** A download url, which lands unquoted in a shell line in the Dockerfile. */
const URL_SAFE = /^https:\/\/[A-Za-z0-9._~\/%+-]+$/;

/** A sha256 as `sha256sum` prints it. */
const SHA256 = /^[0-9a-f]{64}$/;

/** One error, as the one line a person reads. */
const said = (problem: string): never => { throw new Error(`${versionsPath()}: ${problem}`); };

/**
 * One entry, read as an entry or refused as one.
 *
 * Everything a part cannot be is refused here rather than at build: a version
 * that is a range, an archive nobody can check, a `requires` naming a part that
 * is not in the file. The file is small and read on every build, so a refusal
 * here is a refusal that costs nothing.
 */
const entryOf = (value: unknown, where: string): Part => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return said(`${where} is not an entry`);
  const held = value as Record<string, unknown>;
  const text = (key: string): string => (typeof held[key] === 'string' ? held[key] : said(`${where} has no ${key}`));
  const kind = text('kind');
  if (!KINDS.includes(kind as Part['kind'])) return said(`${where} names no kind this can build: ${kind}`);
  const version = text('version');
  if (!EXACT.test(version)) return said(`${where} has the version ${version}, which is a range rather than one version`);
  const archives = ((): Part['archives'] => {
    if (held.archives === undefined) return undefined;
    if (typeof held.archives !== 'object' || held.archives === null || Array.isArray(held.archives)) {
      return said(`${where} has archives that are not one per platform`);
    }
    const per: NonNullable<Part['archives']> = {};
    for (const [platform, one] of Object.entries(held.archives as Record<string, unknown>)) {
      const file = typeof one === 'object' && one !== null && !Array.isArray(one) ? one as Record<string, unknown> : {};
      const url = typeof file.url === 'string' ? file.url : said(`${where} has no url for ${platform}`);
      if (!URL_SAFE.test(url)) return said(`${where} has the url ${url} for ${platform}, which is not a plain https url`);
      const sha256 = typeof file.sha256 === 'string' && file.sha256 !== '' ? file.sha256
        : said(`${where} has no sha256 for ${platform}, so a download of it could not be checked`);
      if (!SHA256.test(sha256)) return said(`${where} has the sha256 ${sha256} for ${platform}, which is not 64 hex digits`);
      per[platform] = { url, sha256 };
    }
    return per;
  })();
  const list = (key: string): string[] | undefined =>
    (Array.isArray(held[key]) && (held[key] as unknown[]).every((one) => typeof one === 'string')
      ? held[key] as string[]
      : undefined);
  const bin = list('bin') ?? said(`${where} names no command`);
  return {
    id: text('id'),
    name: text('name'),
    kind: kind as Part['kind'],
    version,
    ...(list('packages') === undefined ? {} : { packages: list('packages') as string[] }),
    ...(archives === undefined ? {} : { archives }),
    bin,
    ...(list('requires') === undefined ? {} : { requires: list('requires') as string[] }),
    ...(typeof held.updates === 'object' && held.updates !== null && !Array.isArray(held.updates)
      ? { updates: held.updates as Record<string, string> }
      : {}),
    ...(list('plugins') === undefined ? {} : { plugins: list('plugins') as string[] }),
  };
};

/**
 * Every part the file names, in the order it names them.
 *
 * Read on every tag, so the refusals are here rather than at the first build:
 * a duplicate id would give two parts one tag, and a `requires` naming a part
 * that is not in the file would fail a build for a reason the file already
 * knows.
 */
export const readParts = (path: string = versionsPath()): Part[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  }
  catch (error) {
    throw new Error(`${path} could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${path} is not a list of parts`);
  const byId = new Map<string, Part>();
  for (const [at, value] of parsed.entries()) {
    const part = entryOf(value, `entry ${String(at)}`);
    if (byId.has(part.id)) throw new Error(`${path} names ${part.id} twice`);
    byId.set(part.id, part);
  }
  for (const part of byId.values()) {
    for (const need of part.requires ?? []) {
      if (!byId.has(need)) throw new Error(`${path}: ${part.id} requires ${need}, which it does not name`);
    }
  }
  return [...byId.values()];
};

/**
 * The image a part is built as, and the one place that is spelled.
 *
 * The tag is the version, so whether a part is built is one `docker image
 * inspect`. The `ahpd` part carries a hash of its own source beside the
 * version, because a checkout that changed its code has not changed its
 * version and would otherwise reuse the image built from the code before it -
 * the thing that hash is there for.
 */
export const tagOf = (part: Part, sourceHash?: string): string => {
  if (part.kind !== 'ahpd') return `ahpd-part/${part.id}:${part.version}`;
  if (sourceHash === undefined || sourceHash === '') {
    throw new Error('the tag of the ahpd part carries a hash of its own source, and none was given to tag it with');
  }
  return `ahpd-part/${part.id}:${part.version}-${sourceHash}`;
};

/**
 * What the joined image's tag is a hash of: the file's own bytes, and the ahpd
 * part's tag beside them.
 *
 * So a version move and a change to this repository's own code both move the
 * joined image, and nothing else does. The parts are taken as an argument so a
 * caller that read its own file is hashed beside its own ahpd tag rather than
 * the one that ships.
 */
export const hashOf = (sourceHash?: string, parts: Part[] = readParts()): string => {
  const ahpd = parts.find((one) => one.kind === 'ahpd');
  const hash = createHash('sha256')
    .update(readFileSync(versionsPath()))
    .update(`\n${ahpd === undefined ? '' : tagOf(ahpd, sourceHash)}`)
    .digest('hex');
  return hash.slice(0, 12);
};

/**
 * Where the ahpd part's own code comes from.
 *
 * A checkout packs the workspace's own packages and installs those tarballs,
 * so a developer tests the code they are editing; an installed package names
 * the version from npm, which is the only one there is - the answer is made
 * once, in this one function, so the choice is one place to change.
 */
export type AhpdSource =
  | { from: 'workspace'; hash: string; tarballs: Tarball[]; plugins: Tarball[] }
  | { from: 'npm'; hash: string; version: string };

/** A packed workspace package, as the build context carries it. */
export type Tarball = { name: string; bytes: Buffer };

/** What `ensurePart` needs to answer, and builds with. */
export interface EnsureOptions {
  /** The runtime the image is built on, which is where the build happens. */
  runtime: ComputerRuntime;
  /** The parts to read, which is the shipped file unless a caller says otherwise. */
  parts?: Part[];
}

/** The directory holding `versions.json`, which is the package root in both cases. */
const packageRoot = (): string => dirname(dirname(fileURLToPath(import.meta.url)));

/** The repository this is a checkout of, or nothing when it is an installed package. */
const checkoutRoot = (): string | undefined => {
  for (let at = packageRoot(); ; at = dirname(at)) {
    if (existsSync(join(at, 'pnpm-workspace.yaml'))) return at;
    if (dirname(at) === at) return undefined;
  }
};

/** Where a workspace package of this repository lives, by the name it publishes under. */
const workspaceDir = (root: string, name: string): string | undefined => {
  for (const entry of readdirSync(join(root, 'packages'))) {
    const path = join(root, 'packages', entry, 'package.json');
    if (!existsSync(path)) continue;
    if ((JSON.parse(readFileSync(path, 'utf8')) as { name?: string }).name === name) {
      return dirname(path);
    }
  }
  return undefined;
};

/** The workspace packages the ahpd part is built from, in a checkout. */
const workspacePackages = (root: string): string[] => {
  const server = workspaceDir(root, '@ahpd/server');
  if (server === undefined) throw new Error(`${root} has no @ahpd/server, so there is nothing to pack for the ahpd part`);
  const manifest = JSON.parse(readFileSync(join(server, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  // Its own workspace dependencies with it: `pnpm pack` rewrites a `workspace:`
  // range to the published one, and the tarballs beside it are what satisfies it.
  const own = Object.entries(manifest.dependencies ?? {})
    .filter(([, range]) => range.startsWith('workspace:'))
    .map(([name]) => name);
  return ['@ahpd/server', ...own];
};

/** One packed workspace package, named as the Dockerfile will name it. */
const packOf = (root: string, name: string, into: string): { name: string; bytes: Buffer } => {
  const at = workspaceDir(root, name);
  if (at === undefined) throw new Error(`${root} has no ${name}, so the ahpd part cannot be built from this checkout`);
  const packed = spawnSync('pnpm', ['pack', '--pack-destination', into], { cwd: at, encoding: 'utf8' });
  if (packed.status !== 0) {
    const said = (packed.stderr.trim() || packed.stdout.trim()).split('\n').slice(-3).join(' ');
    throw new Error(`pnpm pack could not pack ${name}, which the release workflow runs after pnpm build: ${said}`);
  }
  const file = packed.stdout.trim().split('\n').pop() ?? '';
  return { name: `${name.replace(/^@/, '').replace('/', '-')}.tgz`, bytes: readFileSync(join(into, file)) };
};

/** The tarballs a checkout builds the ahpd part from, and the hash their bytes make. */
const packedOf = (root: string, part: Part): { tarballs: { name: string; bytes: Buffer }[]; plugins: { name: string; bytes: Buffer }[]; hash: string } => {
  const into = mkdtempSync(join(tmpdir(), 'ahpd-pack-'));
  const tarballs = workspacePackages(root).map((name) => packOf(root, name, into));
  const plugins = (part.plugins ?? []).map((name) => packOf(root, name, into));
  const hash = createHash('sha256');
  for (const one of [...tarballs, ...plugins]) hash.update(one.name).update(one.bytes);
  return { tarballs, plugins, hash: hash.digest('hex').slice(0, 12) };
};

/** The answer, packed once per process however many builds ask for it. */
let answered: Promise<AhpdSource> | undefined;

/**
 * What the ahpd part is built from, which is the workspace's own code in a
 * checkout and the pinned version anywhere else.
 *
 * Packing is a `pnpm pack` per package and it is done once and remembered: the
 * bytes are what the build context carries and what the tag's hash covers, and
 * two builds in one process have to agree on them.
 */
export const ahpdSourceOf = async (): Promise<AhpdSource> => {
  answered ??= (async () => {
    const part = readParts().find((one) => one.kind === 'ahpd');
    if (part === undefined) throw new Error(`${versionsPath()} names no ahpd part`);
    const root = checkoutRoot();
    if (root === undefined) {
      return { from: 'npm', version: part.version, hash: createHash('sha256').update(part.version).digest('hex').slice(0, 12) };
    }
    return { from: 'workspace', ...packedOf(root, part) };
  })();
  return answered;
};

/** The image a part downloads from, for one platform. */
const platformOf = (part: Part, key: string): { url: string; sha256: string } => {
  const found = (part.archives ?? {})[key];
  if (found === undefined) throw new Error(`${versionsPath()} has no ${key} download for ${part.id}`);
  return found;
};

/** How `tar` is told which compression an archive used. */
const tarFlag = (url: string): string => {
  if (url.endsWith('.tar.xz')) return '-xJf';
  if (url.endsWith('.tar.bz2')) return '-xjf';
  if (url.endsWith('.tar.gz')) return '-xzf';
  throw new Error(`${url} is not a tar archive this can unpack`);
};

/** The tag of the `node` part, which every part installed by npm copies in. */
const nodeTag = (): string => {
  const node = readParts().find((one) => one.kind === 'node');
  if (node === undefined) throw new Error(`${versionsPath()} names no node part, so nothing that needs Node can be built`);
  return tagOf(node);
};

/**
 * The `case` a build runs to pick the download for the architecture it is for.
 *
 * `TARGETARCH` is BuildKit's own, so one Dockerfile builds both images and a
 * build for anything else says which architecture it was rather than downloading
 * the wrong one.
 *
 * Every line carries the trailing backslash the `RUN` it sits in needs. Without
 * it Docker takes the next line for a fresh instruction, and says
 * `unknown instruction: amd64)`.
 */
const byPlatform = (part: Part): string => {
  const line = (arch: string, key: string): string => {
    const one = platformOf(part, key);
    // `how` is here rather than outside because a publisher may compress its two
    // architectures differently, and `tar` has to be told per build.
    return `      ${arch}) url=${one.url}; sum=${one.sha256}; how=${tarFlag(one.url)};; \\`;
  };
  return [
    '    case "${TARGETARCH:-amd64}" in \\',
    line('amd64', 'linux-x64'),
    line('arm64', 'linux-arm64'),
    '      *) echo "no download for ${TARGETARCH}" >&2; exit 1;; \\',
    '    esac; \\',
  ].join('\n');
};

/** The stage a part is fetched in: a Debian with what the fetch needs on it. */
const fetching = (withNode: boolean, packages: string): string => [
  'FROM debian:bookworm-slim AS fetch',
  // BuildKit's own, so one Dockerfile builds both architectures.
  'ARG TARGETARCH',
  ...(withNode ? [`COPY --from=${nodeTag()} /opt/ahpd/node /opt/ahpd/node`, 'ENV PATH="/opt/ahpd/node/bin:${PATH}"'] : []),
  `RUN apt-get update \\
 && apt-get install --yes --no-install-recommends ${packages} \\
 && rm -rf /var/lib/apt/lists/*`,
  'WORKDIR /fetch',
].join('\n');

/**
 * The last stage of every part: nothing but the part.
 *
 * `FROM scratch` and one copy, so the image a machine mounts is the CLI and
 * what it needs to run, and not the Debian it was fetched in - decision
 * `the-published-image-is-the-parts-joined` is about the joined image, and
 * this is the same rule one part at a time.
 */
const only = (id: string): string => [
  'FROM scratch',
  `COPY --from=fetch /opt/ahpd/${id} /opt/ahpd/${id}`,
].join('\n');

/** The `export` lines a launcher runs before it runs its part. */
const exported = (part: Part, extra: Record<string, string> = {}): string[] =>
  Object.entries({ ...extra, ...(part.updates ?? {}) }).map(([key, value]) => `export ${key}=${value}`);

/**
 * A launcher, as the two `printf` statements that write it.
 *
 * The head is one argument per line - the shebang, then an `export` per update -
 * and the command is the substitution in a format rather than an argument of its
 * own. That is what `printf '%s\n'` makes of a word: an argument is a line, so a
 * launcher whose command was written as one word would be four lines with `exec`
 * on the second, and a `#!/bin/sh` script that runs `exec` with no command.
 *
 * `command` is written into a double-quoted argument so that an archive part
 * can hand it the path its own `find` found, and left expanded there.
 */
const writes = (path: string, part: Part, command: string, extra: Record<string, string> = {}): string => {
  const head = [`'#!/bin/sh'`, ...exported(part, extra).map((one) => `'${one}'`)].join(' ');
  return `printf '%s\\n' ${head} > ${path}; printf 'exec %s "$@"\\n' "${command}" >> ${path}`;
};

/**
 * One launcher per `bin` entry, as `RUN` lines.
 *
 * Written rather than symlinked, because the `updates` the entry gives and, for
 * the ahpd part, the root its plugins live in have to be set before the command
 * runs and a symlink sets nothing.
 */
const launchers = (part: Part, exec: (bin: string) => string, extra: Record<string, string> = {}): string => {
  const steps = [`mkdir -p /opt/ahpd/${part.id}/bin`];
  for (const bin of part.bin) {
    steps.push(writes(`/opt/ahpd/${part.id}/bin/${bin}`, part, exec(bin), extra));
    steps.push(`chmod +x /opt/ahpd/${part.id}/bin/${bin}`);
  }
  // One `RUN`, joined by the backslash every line but the last needs.
  return [`RUN ${steps[0]}`, ...steps.slice(1).map((one) => ` && ${one}`)].join(' \\\n');
};

/** The `case`, `curl` and `tar` a part installed by download runs, as one `RUN`. */
const download = (part: Part, after: string[]): string => [
  'RUN set -eu; \\',
  byPlatform(part),
  ' curl --fail --silent --show-error --location --output part "${url}"; \\',
  ' echo "${sum}  part" | sha256sum --check --strict -; \\',
  ` mkdir -p /opt/ahpd/${part.id}; \\`,
  // Unstripped, because an archive does not have to hold one wrapping
  // directory and three of the five do not: goose lays out
  // `goose-x86_64-unknown-linux-gnu/goose`, while opencode and amp ship the
  // executable at the root, where stripping a component leaves nothing at all.
  // Nothing here needs the depth, because the launcher below finds the
  // executable rather than naming a path.
  ` tar "${'${how}'}" part -C /opt/ahpd/${part.id}; \\`,
  // Each is a statement of its own, and the semicolon is added here rather than
  // left to the caller: docker joins a continued `RUN` into one line with
  // nothing between the lines, so `mkdir x` followed by `found=$(...)` is a
  // `mkdir` with an argument the shell already ran.
  ...after.map((one) => `${one.replace(/;?$/, ';')} \\`),
].join('\n').replace(/; \\$/, ';');

/**
 * The launcher of a part installed by download.
 *
 * What is inside the archive is the publisher's own layout - a binary at the
 * root, one under `bin`, one under `dist-package` - so the build finds the
 * executable of the name the entry gives and writes its path into the launcher,
 * rather than this file having to know three layouts.
 */
const launchersIn = (part: Part): string[] => [`mkdir -p /opt/ahpd/${part.id}/bin`, ...part.bin.map((bin) => {
  // A symlink counts: `npm` and `npx` are symlinks in a Node tarball, and some
  // of these CLIs ship their binary behind one.
  const found = `found=$(find /opt/ahpd/${part.id} -name ${bin} \\( -type f -o -type l \\) -perm -u+x | head -n 1);`;
  // One line, because the shell has no `else` without a command after it and the
  // launcher is four statements. A publisher that already put the command where
  // a launcher goes has written the launcher itself - devin ships `bin/devin` -
  // and one written over it would exec itself, so it is left alone.
  return `if test -x /opt/ahpd/${part.id}/bin/${bin}; then :; else ${found} `
    + `test -n "$found" || { echo "the ${part.id} archive holds no ${bin} to run" >&2; exit 1; }; `
    + `${writes(`/opt/ahpd/${part.id}/bin/${bin}`, part, '$found')}; chmod +x /opt/ahpd/${part.id}/bin/${bin}; fi`;
})];

/** The `npm install` a part installed by npm runs, and the launcher it leaves. */
const byNpm = (part: Part): string => [
  fetching(true, 'ca-certificates'),
  `RUN npm install --prefix /opt/ahpd/${part.id} --no-audit --no-fund --loglevel=error ${
    (part.packages ?? []).map((one) => `${one}@${part.version}`).join(' ')}`,
  launchers(part, (bin) => `/opt/ahpd/node/bin/node /opt/ahpd/${part.id}/node_modules/.bin/${bin}`),
  only(part.id),
].join('\n\n');

/** The download a part made of one tarball fetches, unpacked into the part. */
const byDownload = (part: Part): string => [
  fetching(false, 'ca-certificates curl bzip2 xz-utils'),
  download(part, launchersIn(part)),
  only(part.id),
].join('\n\n');

/**
 * The download of the `node` part, which needs no launcher of its own.
 *
 * A Node tarball already lays out `bin/node`, `bin/npm` and `bin/npx`, and a
 * launcher for `node` would be a file that runs itself.
 */
const byNode = (part: Part): string => [
  fetching(false, 'ca-certificates curl bzip2 xz-utils'),
  download(part, []),
  only(part.id),
].join('\n\n');

/** The root the ahpd part's own plugins are installed in and read from. */
const PLUGIN_ROOT = '/opt/ahpd/ahpd/plugins';

/** The launcher the ahpd part leaves, which is the one that sets the root. */
const ahpdLauncher = (part: Part): string =>
  launchers(part, () => '/opt/ahpd/node/bin/node /opt/ahpd/ahpd/node_modules/.bin/ahpd', { AHPD_PLUGIN_ROOT: PLUGIN_ROOT });

/**
 * The Dockerfile that builds one part.
 *
 * Four kinds, one shape: a Debian that fetches and a `FROM scratch` that keeps
 * `/opt/ahpd/<id>` and nothing else, so a part is the same directory whether it
 * was mounted or copied. The `ahpd` part is the one kind whose source has to be
 * answered first, because its image holds this repository's code or the published
 * version and the two are not the same build.
 */
export const dockerfileOf = (part: Part, source?: AhpdSource): string => {
  if (part.kind === 'node') return byNode(part);
  if (part.kind === 'archive') return byDownload(part);
  if (part.kind === 'npm') return byNpm(part);
  if (source === undefined) {
    throw new Error(`the ${part.id} part is built from code this checkout has to pack, which is what ahpdSourceOf() answers`);
  }
  const flags = '--no-audit --no-fund --loglevel=error --legacy-peer-deps';
  if (source.from === 'npm') {
    return [
      fetching(true, 'ca-certificates'),
      `RUN npm install --prefix /opt/ahpd/${part.id} ${flags} @ahpd/sdk@${source.version} @ahpd/server@${source.version}`,
      // The nested backends go in the part, not in the config dir, because a
      // `FROM scratch` stage keeps nothing that is not under `/opt/ahpd/ahpd`.
      `RUN AHPD_PLUGIN_ROOT=${PLUGIN_ROOT} /opt/ahpd/${part.id}/node_modules/.bin/ahpd plugin install --no-enable ${
        (part.plugins ?? []).map((one) => `${one}@${part.version}`).join(' ')}`,
      ahpdLauncher(part),
      only(part.id),
    ].join('\n\n');
  }
  // A checkout's own code, as the tarballs `pnpm pack` wrote of it, so the part
  // holds what this working tree holds rather than what npm publishes.
  const names = [...source.tarballs, ...source.plugins].map((one) => one.name);
  return [
    fetching(true, 'ca-certificates'),
    `COPY ${names.join(' ')} ./`,
    `RUN npm install --prefix /opt/ahpd/${part.id} ${flags} ${source.tarballs.map((one) => `./${one.name}`).join(' ')}`,
    // `ahpd plugin install` names a package, not a tarball - `isPackageName` in
    // the installer refuses a path - so the plugins of a checkout are installed
    // into the same root by npm, which is what `AHPD_PLUGIN_ROOT` points at.
    `RUN npm install --prefix ${PLUGIN_ROOT} ${flags} ${[...source.plugins, ...source.tarballs]
      .map((one) => `./${one.name}`).join(' ')}`,
    ahpdLauncher(part),
    only(part.id),
  ].join('\n\n');
};

/** One entry of a tar archive: 512 bytes of header, then the bytes themselves. */
const tarEntry = (name: string, bytes: Buffer): Buffer => {
  const header = Buffer.alloc(512);
  // A tar header is a fixed layout of fields, each padded to its own width, and
  // the checksum is the sum of the header's bytes with its own field read as
  // spaces - which is what a reader adds up to decide the header is honest.
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'utf8');
  header.write('0000000\0', 108, 8, 'utf8');
  header.write('0000000\0', 116, 8, 'utf8');
  header.write(`${bytes.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8');
  // A fixed mtime, so the same context twice is the same bytes and Docker's own
  // cache is not thrown away by a build that changed nothing.
  header.write('00000000000\0', 136, 12, 'utf8');
  header.write('        ', 148, 8, 'utf8');
  header.write('0', 156, 1, 'utf8');
  header.write('ustar\0', 257, 6, 'utf8');
  header.write('00', 263, 2, 'utf8');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');
  // The data is padded out to the next 512, and an archive ends with two empty
  // blocks that say so.
  const padded = Buffer.alloc((bytes.length + 511) & ~511);
  bytes.copy(padded);
  return Buffer.concat([header, padded]);
};

/**
 * The build context one part is built from: the Dockerfile and, for an ahpd
 * part of a checkout, the tarballs it installs.
 *
 * Piped rather than left in a directory, so nothing is written into the package
 * at run time and an installed package may sit on a read-only filesystem.
 */
export const contextOf = (dockerfile: string, files: Tarball[] = []): Buffer =>
  archiveOf([{ name: 'Dockerfile', bytes: Buffer.from(dockerfile, 'utf8') }, ...files]);

/** Files as one tar archive, which is what `docker build -` and `docker cp -` read on stdin. */
export const archiveOf = (files: Tarball[]): Buffer =>
  Buffer.concat([...files.map((one) => tarEntry(one.name, one.bytes)), Buffer.alloc(1024)]);

/** The builds and fills running in this process, by key, so two callers wait for one of them. */
const building = new Map<string, Promise<unknown>>();

/**
 * One turn per key: an image's tag, or a volume's name.
 *
 * Two callers that arrive while a build is running wait for it rather than run
 * one of their own, and only a running build is held: a caller that arrives
 * after it is over asks the runtime what it has, which is the honest answer,
 * because a build that succeeded left an image behind and one that failed did
 * not.
 */
export const once = <T>(tag: string, work: () => Promise<T>): Promise<T> => {
  const held = building.get(tag);
  if (held !== undefined) return held as Promise<T>;
  const started = work();
  building.set(tag, started);
  const forget = (): void => { if (building.get(tag) === started) building.delete(tag); };
  started.then(forget, forget);
  return started;
};

/**
 * One part's tag, its image built the first time anything asks for it.
 *
 * A part that names a `requires` is not built until those are, because its
 * Dockerfile copies the `node` part's image in by tag and a build without it
 * fails on a stage Docker cannot resolve.
 */
export const ensurePart = async (id: string, options: EnsureOptions): Promise<string> => {
  const parts = options.parts ?? readParts();
  const part = parts.find((one) => one.id === id);
  if (part === undefined) throw new Error(`${versionsPath()} names no ${id} part`);
  for (const need of part.requires ?? []) {
    await ensurePart(need, { ...options, parts });
  }
  const source = part.kind === 'ahpd' ? await ahpdSourceOf() : undefined;
  const tag = tagOf(part, source?.hash);
  return once(tag, async () => {
    if (await options.runtime.hasImage(tag)) return tag;
    const files = source?.from === 'workspace' ? [...source.tarballs, ...source.plugins] : [];
    await options.runtime.buildImage(tag, contextOf(dockerfileOf(part, source), files));
    return tag;
  });
};

/** One part a machine is made with: its id, the image it comes from, and the version that image is. */
export interface MadePart {
  /** The part's id, which is the directory it is mounted at under `/opt/ahpd`. */
  id: string;
  /** The image it is mounted or filled from. */
  tag: string;
  /** What the tag says after its name: the version, and for the ahpd part its source hash. */
  version: string;
  /** The parts it cannot run without, which a machine leaving one out leaves this out with it. */
  requires?: string[];
}

/**
 * The label a machine carries naming the parts it has, as `<id>@<version>`
 * joined by commas.
 *
 * Only the parts it was made with: a part whose build failed is not on it, and
 * that absence is what refuses a session needing that part. The joined image
 * carries the same label with ids alone, so a machine made from it reads the
 * same way.
 */
export const MACHINE_PARTS = 'ahpd.parts';

/** The label value for a machine made with these parts. */
export const partsLabel = (parts: readonly MadePart[]): string =>
  parts.map((one) => `${one.id}@${one.version}`).join(',');

/** The part ids a label value names, with any version dropped. */
export const partsSaid = (value: unknown): string[] =>
  (typeof value === 'string'
    ? value.split(',').map((one) => one.trim().split('@')[0] ?? '').filter((one) => one !== '')
    : []);

/** The `PATH` Docker gives a container whose image sets none. */
export const IMAGE_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

/**
 * The volume a part is copied into where an image mount is refused,
 * `ahpd-part-<id>-<version>`.
 *
 * The version is in the name, so a bump makes a new volume and the old one is
 * left for `docker volume prune`. A character Docker refuses in a volume name -
 * the `+` of a build suffix - is written `_`.
 */
export const volumeOf = (part: MadePart): string =>
  `ahpd-part-${part.id}-${part.version.replace(/[^A-Za-z0-9_.-]/g, '_')}`;

/**
 * The file written into a part volume once it is filled, and last.
 *
 * A volume without it is a fill that stopped half way, which is removed and
 * filled again rather than mounted.
 */
export const FILLED_MARKER = '.ahpd-filled';

/** A `PATH` with each part's `bin` in front of `base`, in the order the parts are named. */
export const pathWith = (ids: readonly string[], base: string): string =>
  [...ids.map((id) => `${partTarget(id)}/bin`), base].join(':');

/**
 * The parts a machine asking for these is made with: each one, then the parts
 * it requires, each once, in that order.
 *
 * An id the file does not name stays in the list, so the build that cannot find
 * it is what says so, and a file that cannot be read answers the ids as asked.
 */
export const withRequires = (ids: readonly string[], parts?: Part[]): string[] => {
  let named: Part[];
  try {
    named = parts ?? readParts();
  }
  catch {
    return [...new Set(ids)];
  }
  const out: string[] = [];
  const add = (id: string): void => {
    if (out.includes(id)) return;
    out.push(id);
    for (const need of named.find((one) => one.id === id)?.requires ?? []) add(need);
  };
  for (const id of ids) add(id);
  return out;
};

/**
 * Every part a machine asks for, built where it is not already, with what each
 * requires.
 *
 * A part whose build fails, or whose requirement's build fails, is answered
 * among `failed` with the build's own reason rather than thrown: the machine is
 * made with the rest, and only a session that needs the missing part is
 * refused.
 */
export const ensureParts = async (
  ids: readonly string[],
  options: EnsureOptions,
): Promise<{ made: MadePart[]; failed: { id: string; reason: string }[] }> => {
  const made: MadePart[] = [];
  const failed: { id: string; reason: string }[] = [];
  let named: Part[] = [];
  try { named = options.parts ?? readParts(); }
  catch { /* each build below says why the file could not be read */ }
  for (const id of withRequires(ids, options.parts)) {
    try {
      const tag = await ensurePart(id, options);
      const requires = named.find((one) => one.id === id)?.requires;
      made.push({ id, tag, version: tag.slice(tag.lastIndexOf(':') + 1), ...(requires === undefined ? {} : { requires }) });
    }
    catch (error) {
      failed.push({ id, reason: (error instanceof Error ? error.message : String(error)).replace(/\s*\n\s*/g, ' ') });
    }
  }
  return { made, failed };
};

/**
 * The failed parts a machine is not made without, and the one place that is
 * decided.
 *
 * A machine made for one session is refused when a part that session's agent
 * needs failed, since no other session will run in it. A machine sessions
 * share is made without any failed part, and only a session needing it is
 * refused when it asks.
 */
export const refusedWithout = (spec: { sessionParts?: string[] }, failed: readonly string[]): string[] =>
  (spec.sessionParts === undefined ? [] : failed.filter((id) => spec.sessionParts?.includes(id) === true));

/** What the joined image holds beyond the parts, which is what an agent needs to work. */
const JOINED = 'ca-certificates git ripgrep';

/**
 * The Dockerfile of the one image ahpd publishes: a machine with every part in
 * it, at the path each is mounted at.
 *
 * Built only for a runtime that cannot mount image parts, which is why a profile
 * naming no image stays on `debian:bookworm-slim` with its parts mounted
 * instead - a fifteen-part build does not precede the first default machine.
 * The tags are handed in rather than spelled here, because the ahpd part's tag
 * carries the hash of its own source and only the build knows it.
 */
export const joinedDockerfile = (parts: Part[], tags: ReadonlyMap<string, string>): string => [
  'FROM debian:bookworm-slim',
  `RUN apt-get update \\
 && apt-get install --yes --no-install-recommends ${JOINED} \\
 && rm -rf /var/lib/apt/lists/*`,
  ...parts.map((part) => `COPY --from=${tags.get(part.id)} /opt/ahpd/${part.id} /opt/ahpd/${part.id}`),
  // Every part's launchers on the PATH, so `/opt/ahpd/codex/bin/codex-acp`
  // and the bare `codex-acp` are the same command.
  `ENV PATH="${parts.map((part) => `/opt/ahpd/${part.id}/bin`).join(':')}:${'${PATH}'}"`,
  // What it holds, so a machine it was built without can be told from one built
  // from a versions file that has since moved.
  `LABEL ahpd.parts="${parts.map((part) => part.id).join(',')}"`,
].join('\n');

/** The joined image: its tag, the parts it holds and the parts it does not. */
export interface Joined {
  /** The tag it was built at, `ahpd-agents:<hash of the file and the ahpd part's tag>`. */
  tag: string;
  /** Every part whose image was here, at the path it is mounted at. */
  parts: Part[];
  /** The parts whose image could not be built, in the order the file names them. */
  missing: string[];
}

/**
 * The joined image, every part in it and every part built on the way.
 *
 * A part that will not build does not stop the rest: the image is built without
 * it and the answer says which is missing, so a machine whose agent needs that
 * one is refused by name and every other machine is made. The alternative -
 * refusing the joined image over one CLI - would take thirteen working agents
 * down with a fourteenth that will not download.
 *
 * The hash is `hashOf`, so a version that moved or a checkout whose code moved
 * is a different image, and a daemon holding the old one does not reuse it.
 */
export const ensureJoined = async (options: EnsureOptions): Promise<Joined> => {
  const named = options.parts ?? readParts();
  const held: Part[] = [];
  const missing: string[] = [];
  const tags = new Map<string, string>();
  for (const part of named) {
    try {
      tags.set(part.id, await ensurePart(part.id, { ...options, parts: named }));
      held.push(part);
    }
    catch {
      missing.push(part.id);
    }
  }
  // The ahpd part's tag carries a hash of its own source, and the joined hash
  // folds that tag in.
  const hash = named.some((one) => one.kind === 'ahpd') ? (await ahpdSourceOf()).hash : undefined;
  const tag = `ahpd-agents:${hashOf(hash, named)}`;
  return once(tag, async () => {
    if (!await options.runtime.hasImage(tag)) {
      await options.runtime.buildImage(tag, contextOf(joinedDockerfile(held, tags)));
    }
    return { tag, parts: held, missing };
  });
};
