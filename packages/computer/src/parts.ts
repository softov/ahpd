import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { partTarget } from '@ahpd/sdk';
import type { ComputerRuntime } from './runtime.js';

/**
 * The parts a machine is made of, and the one file that says what they are.
 *
 * A part is one agent CLI, or ahpd itself, at an exact version, built into an
 * image of its own by the release workflow, pulled by a host that needs it,
 * and mounted or copied at `/opt/ahpd/<id>`. This is the file, what it is
 * allowed to say, the Dockerfiles that build them and the tags they answer,
 * so a version move is a pull request and whether an image is already there
 * is one `docker image inspect`.
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
  /** The exact version, never a range. */
  version: string;
  /**
   * The npm packages it is, each at this part's version, or at its own exact
   * version where the entry is written `<package>@<version>`. An archive part
   * may carry them beside its download, each with its own version.
   */
  packages?: string[];
  /** One download per platform, each checked by sha256. */
  archives?: Record<string, { url: string; sha256: string }>;
  /** The commands in its own `bin`, which is what a machine puts on its `PATH`. */
  bin: string[];
  /**
   * For an archive part, where each command is in its download, by the
   * command's name: the publisher's own layout for this version, as VS Code
   * knows each agent SDK's layout rather than searching it. A command it names
   * no path for is the one the part's `packages` install.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/build/agent-sdk/README.md#L80
   */
  paths?: Record<string, string>;
  /** The parts that have to be there first; `node` is one of them for everything installed by npm. */
  requires?: string[];
  /** The environment that switches this CLI's own update off, set by its launcher. */
  updates?: Record<string, string>;
  /** The backends that run nested inside a machine, which the `ahpd` part installs for itself. */
  plugins?: string[];
}

/** Where the file is, in a checkout and in an installed package alike. */
export const versionsPath = (): string => fileURLToPath(new URL('../images/versions.json', import.meta.url));

/**
 * Where the release workflow publishes the parts and a host pulls them from:
 * the GitHub container registry namespace of the repository this package
 * names, `ghcr.io/<owner>`, lowercase as the registry's names are.
 * https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
 */
export const registryOf = (): string => {
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
    repository?: string | { url?: string };
  };
  const said = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url ?? '';
  const url = URL.canParse(said) ? new URL(said) : undefined;
  const owner = url?.hostname === 'github.com' ? url.pathname.split('/')[1] ?? '' : '';
  if (owner === '') {
    throw new Error(`@ahpd/computer names ${said === '' ? 'no repository' : `the repository ${said}`}, and its parts are pulled from the GitHub container registry of a GitHub repository`);
  }
  return `ghcr.io/${owner.toLowerCase()}`;
};

/** The kinds an entry may say, so a typo is a refusal rather than a part nothing can build. */
const KINDS = ['npm', 'archive', 'ahpd', 'node'] as const;

/**
 * An exact version, which is what the file has to hold: VS Code's check of a
 * pinned agent SDK, major.minor.patch with a prerelease and nothing more.
 *
 * A range would let two hosts building the same tag run different agents, which
 * is the whole thing pinning is against.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/build/agent-sdk/common.ts#L104-L106
 */
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * A value written unquoted into a shell line of a Dockerfile, as VS Code checks
 * one: letters, digits, `.`, `_` and `-`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sshRemoteAgentHostHelpers.ts#L14-L25
 */
const SHELL_TOKEN = /^[a-zA-Z0-9._-]+$/;

/**
 * A part's id as an image name holds it, `ahpd-part/<id>`: a path component
 * of the reference grammar, lowercase letters and digits with `.`, `_`, `__`
 * or dashes between them.
 * https://github.com/distribution/reference/blob/0965666a6ade2e06035fe352e38344be1e68951a/regexp.go#L41-L68
 */
const PATH_COMPONENT = /^[a-z0-9]+(?:(?:[._]|__|[-]+)[a-z0-9]+)*$/;

/** A tag of the reference grammar, which a part's image tag has to be. */
const TAG = /^[\w][\w.-]{0,127}$/;

/** A download url, which lands unquoted in a shell line in the Dockerfile. */
const URL_SAFE = /^https:\/\/[A-Za-z0-9._~\/%+-]+$/;

/** A sha256 as `sha256sum` prints it. */
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * A package of an npm part as its name and the exact version it names of its
 * own, or no version where it is installed at the part's.
 *
 * The `@` of a scope is the first character, so the version is what follows an
 * `@` after it.
 */
export const packageOf = (spec: string): { name: string; version?: string } => {
  const at = spec.lastIndexOf('@');
  return at > 0 ? { name: spec.slice(0, at), version: spec.slice(at + 1) } : { name: spec };
};

/** One error, as the one line a person reads. */
const said = (problem: string): never => { throw new Error(`${versionsPath()}: ${problem}`); };

/**
 * One entry, read as an entry or refused as one.
 *
 * Everything a part cannot be is refused here rather than at build: a version
 * that is not one exact version, a value that would reach a shell line as
 * something else, an id no image can be named by, an archive nobody can check,
 * a `requires` naming a part that is not in the file. The file is small and
 * read on every build, so a refusal here is a refusal that costs nothing.
 */
const entryOf = (value: unknown, where: string): Part => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return said(`${where} is not an entry`);
  const held = value as Record<string, unknown>;
  const text = (key: string): string => (typeof held[key] === 'string' ? held[key] : said(`${where} has no ${key}`));
  // What lands unquoted in a Dockerfile's shell lines, refused in VS Code's words.
  const token = (one: string, label: string): string => {
    if (!SHELL_TOKEN.test(one)) throw new Error(`Unsafe ${label} value for shell interpolation: ${JSON.stringify(one)}`);
    return one;
  };
  // An exact version, refused as VS Code refuses a pinned SDK's that is not one.
  const exact = (name: string, one: string): string => {
    if (!EXACT.test(one)) throw new Error(`Refusing to use ${name}@${one} from ${versionsPath()}: must be an exact version (no ^ or ~ ranges)`);
    return one;
  };
  const id = token(text('id'), 'part id');
  if (!PATH_COMPONENT.test(id)) return said(`${where} has the id ${id}, which an image name cannot hold: invalid reference format`);
  const kind = text('kind');
  if (!KINDS.includes(kind as Part['kind'])) return said(`${where} names no kind this can build: ${kind}`);
  const version = exact(id, text('version'));
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
  const bin = (list('bin') ?? said(`${where} names no command`)).map((one) => token(one, 'bin'));
  for (const spec of list('packages') ?? []) {
    const { name, version: own } = packageOf(spec);
    if (own !== undefined) exact(name, own);
    // An archive's version is its download's, so a package in one names its own.
    if (kind === 'archive' && own === undefined) {
      return said(`${where} has the package ${spec} with no version of its own, which an archive part has to give`);
    }
  }
  if (kind === 'archive' && list('packages') !== undefined && !(list('requires') ?? []).includes('node')) {
    return said(`${where} installs npm packages and does not require node`);
  }
  // Each a path in the download, of segments a shell line takes unquoted.
  const paths = ((): Part['paths'] => {
    if (held.paths === undefined) return undefined;
    if (kind !== 'archive') return said(`${where} names paths, which only an archive part's download has`);
    if (typeof held.paths !== 'object' || held.paths === null || Array.isArray(held.paths)) {
      return said(`${where} has paths that are not one per command`);
    }
    const per: Record<string, string> = {};
    for (const [command, one] of Object.entries(held.paths as Record<string, unknown>)) {
      if (!bin.includes(command)) return said(`${where} has a path for ${command}, which its bin does not name`);
      const path = typeof one === 'string' ? one : said(`${where} has the path of ${command}, which is not text`);
      if (path.split('/').some((segment) => segment === '.' || segment === '..' || !SHELL_TOKEN.test(segment))) {
        return said(`${where} has the path ${path} for ${command}, which is not a path in its download`);
      }
      per[command] = path;
    }
    return per;
  })();
  const pathless = kind === 'archive' && list('packages') === undefined ? bin.find((command) => paths?.[command] === undefined) : undefined;
  if (pathless !== undefined) return said(`${where} names no path in its download for ${pathless}`);
  const updates = typeof held.updates === 'object' && held.updates !== null && !Array.isArray(held.updates)
    ? Object.fromEntries(Object.entries(held.updates as Record<string, unknown>).map(([key, one]) =>
      [token(key, 'update variable'), token(typeof one === 'string' ? one : said(`${where} has the update ${key}, which is not text`), 'update value')]))
    : undefined;
  return {
    id,
    name: text('name'),
    kind: kind as Part['kind'],
    version,
    ...(list('packages') === undefined ? {} : { packages: list('packages') as string[] }),
    ...(archives === undefined ? {} : { archives }),
    bin,
    ...(paths === undefined ? {} : { paths }),
    ...(list('requires') === undefined ? {} : { requires: list('requires') as string[] }),
    ...(updates === undefined ? {} : { updates }),
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
 * What the tag of a part other than `ahpd` says after its name: its version,
 * then the version of each package that pins its own, each after a `-`.
 *
 * So moving a package pinned apart from its part moves the part's image and
 * its fill volume, as moving the part's own version does.
 */
export const pinnedOf = (part: Part): string =>
  [part.version, ...(part.packages ?? []).flatMap((spec) => packageOf(spec).version ?? [])].join('-');

/** A short hash of the Dockerfile text that builds an image, which its tag carries. */
const fileHashOf = (dockerfile: string): string => createHash('sha256').update(dockerfile).digest('hex').slice(0, 12);

/**
 * The image a part is built as, and the one place that is spelled: the tag the
 * release workflow pushes it at and a host pulls it at.
 *
 * The tag is the version, so whether a part is here is one `docker image
 * inspect`. The `ahpd` part carries a hash of its own source beside the
 * version, because a checkout that changed its code has not changed its
 * version and would otherwise reuse the image built from the code before it -
 * the thing that hash is there for. And the Dockerfile's own text is in the tag
 * with them, because an upgrade that changes how an image is written changes
 * what is in it while the versions stand still, and the tag is the whole of
 * what makes `ensurePart` reuse the image the older code made.
 */
export const tagOf = (part: Part, sourceHash?: string, dockerfile?: string): string => {
  const built = dockerfile === undefined ? '' : `-${fileHashOf(dockerfile)}`;
  if (part.kind === 'ahpd' && (sourceHash === undefined || sourceHash === '')) {
    throw new Error('the tag of the ahpd part carries a hash of its own source, and none was given to tag it with');
  }
  const tag = part.kind === 'ahpd' ? `${part.version}-${String(sourceHash)}${built}` : `${pinnedOf(part)}${built}`;
  // The tag of the reference grammar, which the exact versions it is made of
  // keep it in; its length is the one thing they do not bound.
  if (!TAG.test(tag)) throw new Error(`ahpd-part/${part.id}:${tag}: invalid reference format`);
  return `ahpd-part/${part.id}:${tag}`;
};

/**
 * What the joined image's tag is a hash of: the file's own bytes, the ahpd
 * part's tag beside them, the ids of the parts the image holds, and the
 * Dockerfile the joined image is written from.
 *
 * So a version move and a change to this repository's own code both move the
 * joined image, and so does a part that built this time and did not the last -
 * an image made without one is not the image the file stands for, and reusing
 * it would answer `missing: []` for a part it does not hold. The Dockerfile is
 * there because it is what the image is: an upgrade that changes
 * `joinedDockerfile`, or a part whose own Dockerfile moved and so is copied in
 * under a new tag, is a different image at the same versions. The parts are
 * taken as an argument so a caller that read its own file is hashed beside its
 * own ahpd tag rather than the one that ships, and the held ids are sorted so
 * the same image is the same tag whatever order they were built in.
 *
 * An ahpd part the file names and the image does not hold is folded in as
 * `<id> unbuilt` and not by its tag: there is no source hash to write a tag
 * with - that is why it is not in the image - and `unbuilt` is not a tag
 * `tagOf` can produce, so an image made without the part cannot hash the same
 * as one made with it. The held ids say that too; this says it in the term that
 * otherwise names the part's own code.
 */
export const hashOf = (
  sourceHash?: string,
  parts: Part[] = readParts(),
  held: readonly string[] = [],
  dockerfile = '',
): string => {
  const ahpd = parts.find((one) => one.kind === 'ahpd');
  const ahpdTerm = ahpd === undefined
    ? ''
    : sourceHash === undefined || sourceHash === '' ? `${ahpd.id} unbuilt` : tagOf(ahpd, sourceHash);
  const hash = createHash('sha256')
    .update(readFileSync(versionsPath()))
    .update(`\n${ahpdTerm}`)
    .update(`\n${[...held].sort().join(',')}`)
    .update(`\n${dockerfile}`)
    .digest('hex');
  return hash.slice(0, 12);
};

/**
 * Where the ahpd part's own code comes from: the version the versions file
 * names, from npm, or the packed packages of the checkout the part's override
 * variable names, so a developer tests the code they are editing. The answer
 * is made once, in `ahpdSourceOf`, so the choice is one place to change.
 */
export type AhpdSource =
  | { from: 'workspace'; hash: string; tarballs: Tarball[]; plugins: Tarball[] }
  | { from: 'npm'; hash: string; version: string };

/** A packed workspace package, as the build context carries it. */
export type Tarball = { name: string; bytes: Buffer };

/**
 * One entry of an archive: a file, or with `directory` a directory and its
 * bytes empty, owned by `uid` and `gid`, root's when absent.
 */
export type ArchiveEntry = Tarball & { uid?: number; gid?: number; directory?: boolean };

/** What `ensurePart` needs to answer, and loads with. */
export interface EnsureOptions {
  /** The runtime the image is pulled to or built on, which is the Docker that mounts it. */
  runtime: ComputerRuntime;
  /** The parts to read, which is the shipped file unless a caller says otherwise. */
  parts?: Part[];
  /** Where a line the load says goes: the override in use. */
  log?: (line: string) => void;
}

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

/**
 * One packed workspace package, named as the Dockerfile will name it.
 *
 * Written where `--out` names it, which is pnpm's own way to say where a
 * tarball goes.
 * https://pnpm.io/cli/pack
 */
const packOf = (root: string, name: string, into: string): { name: string; bytes: Buffer } => {
  const at = workspaceDir(root, name);
  if (at === undefined) throw new Error(`${root} has no ${name}, so the ahpd part cannot be built from this checkout`);
  const file = `${name.replace(/^@/, '').replace('/', '-')}.tgz`;
  const packed = spawnSync('pnpm', ['pack', '--out', join(into, file)], { cwd: at, encoding: 'utf8', windowsHide: true });
  if (packed.status !== 0) {
    const said = (packed.stderr.trim() || packed.stdout.trim()).split('\n').slice(-3).join(' ');
    throw new Error(`pnpm pack could not pack ${name}, which the release workflow runs after pnpm build: ${said}`);
  }
  return { name: file, bytes: readFileSync(join(into, file)) };
};

/** The tarballs a checkout builds the ahpd part from, and the hash their bytes make. */
const packedOf = (root: string, part: Part): { tarballs: { name: string; bytes: Buffer }[]; plugins: { name: string; bytes: Buffer }[]; hash: string } => {
  const into = mkdtempSync(join(tmpdir(), 'ahpd-pack-'));
  try {
    const tarballs = workspacePackages(root).map((name) => packOf(root, name, into));
    const plugins = (part.plugins ?? []).map((name) => packOf(root, name, into));
    const hash = createHash('sha256');
    for (const one of [...tarballs, ...plugins]) hash.update(one.name).update(one.bytes);
    return { tarballs, plugins, hash: hash.digest('hex').slice(0, 12) };
  }
  finally {
    /*
     * The bytes are in memory by now, so the directory is removed the same way
     * whether the pack worked: a machine that packed once per restart would
     * otherwise leave a scratch directory per pack in the temp directory, and
     * one that failed would leave one per attempt.
     */
    rmSync(into, { recursive: true, force: true });
  }
};

/** The answer, packed once per process however many builds ask for it. */
let answered: Promise<AhpdSource> | undefined;

/**
 * What the ahpd part is built from: the version the versions file names, from
 * npm, unless `AHPD_PART_<ID>_ROOT` names a checkout of this repository, whose
 * own packages are packed instead, as VS Code takes an agent SDK's local code
 * only from the SDK's override variable and otherwise its pinned download, and
 * says the override it uses.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSdkDownloader.ts#L364-L370
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentService.ts#L226
 *
 * Packing is a `pnpm pack` per package and it is done once and remembered: the
 * bytes are what the build context carries and what the tag's hash covers, and
 * two builds in one process have to agree on them.
 */
export const ahpdSourceOf = async (log?: (line: string) => void): Promise<AhpdSource> => {
  if (answered === undefined) {
    const asked: Promise<AhpdSource> = (async () => {
      const part = readParts().find((one) => one.kind === 'ahpd');
      if (part === undefined) throw new Error(`${versionsPath()} names no ahpd part`);
      const variable = `AHPD_PART_${part.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_ROOT`;
      const root = process.env[variable];
      if (root === undefined || root === '') {
        return { from: 'npm', version: part.version, hash: createHash('sha256').update(part.version).digest('hex').slice(0, 12) };
      }
      log?.(`the ${part.id} part is built from the checkout at ${root}, which ${variable} names`);
      return { from: 'workspace', ...packedOf(resolve(root), part) };
    })();
    answered = asked;
    /*
     * A pack that failed is not kept here: `ensurePart` refuses the part for
     * the time VS Code holds a failed load, and the ask after that packs again.
     */
    void asked.catch(() => { if (answered === asked) answered = undefined; });
  }
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

/**
 * The tag of the `node` part, which every part installed by npm copies in.
 *
 * It is the tag the `node` part is at, Dockerfile hash and all, because a
 * `COPY --from` naming anything else is a stage Docker cannot resolve; the
 * release workflow builds against the registry's image of that tag.
 */
const nodeTag = (): string => {
  const node = readParts().find((one) => one.kind === 'node');
  if (node === undefined) throw new Error(`${versionsPath()} names no node part, so nothing that needs Node can be built`);
  return tagOf(node, undefined, dockerfileOf(node));
};

/**
 * The `case` a build runs to pick the download for the architecture it is for.
 *
 * `TARGETARCH` is BuildKit's own, so one Dockerfile builds both images and a
 * build for anything else says which architecture it was rather than downloading
 * the wrong one. A build that sets none, which a builder without BuildKit is,
 * says that, for the same reason.
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
    '    case "${TARGETARCH:?is not set, which BuildKit sets to the architecture a build is for}" in \\',
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
 * what it needs to run, and not the Debian it was fetched in is about the joined image, and
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
 * runs and a symlink sets nothing. `before` is shell run ahead of each
 * launcher's write, for a command `exec` names by a variable it sets.
 */
const launchers = (
  part: Part,
  exec: (bin: string) => string,
  extra: Record<string, string> = {},
  before?: (bin: string) => string,
): string => {
  const steps = [`mkdir -p /opt/ahpd/${part.id}/bin`];
  for (const bin of part.bin) {
    if (before !== undefined) steps.push(before(bin));
    steps.push(writes(`/opt/ahpd/${part.id}/bin/${bin}`, part, exec(bin), extra));
    steps.push(`chmod +x /opt/ahpd/${part.id}/bin/${bin}`);
  }
  // One `RUN`, joined by the backslash every line but the last needs.
  return [`RUN ${steps[0]}`, ...steps.slice(1).map((one) => ` && ${one}`)].join(' \\\n');
};

/**
 * The `case`, `curl` and `tar` a part installed by download runs, as one `RUN`.
 *
 * `strip` drops the archive's one wrapping directory, for a part that other
 * parts name by path rather than find.
 */
const download = (part: Part, after: string[], strip = false): string => [
  'RUN set -eu; \\',
  byPlatform(part),
  ' curl --fail --silent --show-error --location --output part "${url}"; \\',
  ' echo "${sum}  part" | sha256sum --check --strict -; \\',
  ` mkdir -p /opt/ahpd/${part.id}; \\`,
  // Unstripped for an archive part, so a path its entry names is the
  // publisher's own path in the download.
  ` tar "${'${how}'}" part -C /opt/ahpd/${part.id}${strip ? ' --strip-components=1' : ''}; \\`,
  // Each is a statement of its own, and the semicolon is added here rather than
  // left to the caller: docker joins a continued `RUN` into one line with
  // nothing between the lines, so `mkdir x` followed by `found=$(...)` is a
  // `mkdir` with an argument the shell already ran.
  ...after.map((one) => `${one.replace(/;?$/, ';')} \\`),
].join('\n').replace(/; \\$/, ';');

/**
 * The launcher of each command of a part installed by download.
 *
 * Each runs the path the entry names for it in the download, the publisher's
 * own layout for this version, as VS Code knows each agent SDK's layout rather
 * than searching it; a build whose download holds nothing executable there
 * fails, naming the path. A command the publisher put at `bin/<command>` is
 * its own launcher, since one written over it would exec itself. A command
 * with no path is the one the part's npm packages installed, in
 * `node_modules/.bin`, and is written as an npm part's is.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/build/agent-sdk/README.md#L80
 */
const launchersIn = (part: Part): string[] => [`mkdir -p /opt/ahpd/${part.id}/bin`, ...part.bin.map((bin) => {
  const launcher = `/opt/ahpd/${part.id}/bin/${bin}`;
  const path = part.paths?.[bin];
  const missing = (said: string): string => `{ echo "the ${part.id} download holds no ${said} to run" >&2; exit 1; }`;
  if (path === `bin/${bin}`) return `test -x ${launcher} || ${missing(path)}`;
  if (path !== undefined) {
    return `test -x /opt/ahpd/${part.id}/${path} || ${missing(path)}; `
      + `${writes(launcher, part, `/opt/ahpd/${part.id}/${path}`)}; chmod +x ${launcher}`;
  }
  const npm = `/opt/ahpd/${part.id}/node_modules/.bin/${bin}`;
  return `test -e ${npm} || ${missing(`node_modules/.bin/${bin}`)}; ${scriptOrNative(npm)}; `
    + `${writes(launcher, part, '$run')}; chmod +x ${launcher}`;
})];

/** The `npm install` a part installed by npm runs, and the launcher it leaves. */
const byNpm = (part: Part): string => [
  fetching(true, 'ca-certificates'),
  `RUN npm install --prefix /opt/ahpd/${part.id} --no-audit --no-fund --loglevel=error ${
    (part.packages ?? []).map((one) => (packageOf(one).version === undefined ? `${one}@${part.version}` : one)).join(' ')}`,
  launchers(part, () => '$run', {}, (bin) => scriptOrNative(`/opt/ahpd/${part.id}/node_modules/.bin/${bin}`)),
  only(part.id),
].join('\n\n');

/**
 * The shell that sets `run` to the command a launcher execs for an npm bin.
 *
 * A bin that starts with `#!` is a script and is run by the part's Node, since
 * the machine has no `node` of its own for its shebang to find; anything else is
 * an executable the package installed for the platform, `claude` among them,
 * and is run as it is.
 */
const scriptOrNative = (path: string): string =>
  `run=${path}; case "$(head -c 2 ${path})" in '#!') run="/opt/ahpd/node/bin/node ${path}";; esac`;

/** The download a part made of one tarball fetches, unpacked into the part. */
const byDownload = (part: Part): string => [
  fetching(part.packages !== undefined, 'ca-certificates curl bzip2 xz-utils'),
  // An archive part's npm packages, each at the version it pins of its own,
  // installed before the download unpacks beside them.
  ...(part.packages === undefined ? [] : [`RUN npm install --prefix /opt/ahpd/${part.id} --no-audit --no-fund --loglevel=error ${part.packages.join(' ')}`]),
  download(part, launchersIn(part)),
  only(part.id),
].join('\n\n');

/**
 * The download of the `node` part, which needs no launcher of its own.
 *
 * A Node tarball lays out `bin/node`, `bin/npm` and `bin/npx` under one
 * `node-v<version>-linux-<arch>` directory. It is stripped, because every part
 * that copies Node in puts `/opt/ahpd/node/bin` on its PATH. A launcher for
 * `node` would be a file that runs itself.
 */
const byNode = (part: Part): string => [
  fetching(false, 'ca-certificates curl bzip2 xz-utils'),
  download(part, [], true),
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
      //
      // `ahpd plugin install` is what installs them, and not a plain `npm
      // install`: the installer is also what reads the package's `"ahpd"`
      // field and refuses one that is not a plugin. `AHPD_PLUGIN_ROOT` makes
      // the part's own root the plugin root. `--no-enable` installs the plugin
      // into that root without naming it in a configuration, because the
      // profile that names it is written when a session starts.
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
    // The plugins of a checkout are tarballs, and what resolves a bare name is
    // the plugin root, so npm installs them into the same root the launcher
    // points `AHPD_PLUGIN_ROOT` at.
    `RUN npm install --prefix ${PLUGIN_ROOT} ${flags} ${[...source.plugins, ...source.tarballs]
      .map((one) => `./${one.name}`).join(' ')}`,
    ahpdLauncher(part),
    only(part.id),
  ].join('\n\n');
};

/** One entry of a tar archive: 512 bytes of header, then the bytes themselves, with its owner and type. */
const tarEntry = (entry: ArchiveEntry): Buffer => {
  const { name: path, bytes } = entry;
  const header = Buffer.alloc(512);
  // A path longer than the 100 bytes of the name field is split at a slash,
  // its directories in the 155 bytes of the ustar prefix field.
  let name = path;
  let prefix = '';
  if (Buffer.byteLength(path) > 100) {
    const at = path.indexOf('/', Buffer.byteLength(path) - 101);
    if (at <= 0 || at > 155) throw new Error(`${path} is too long a path for a tar entry`);
    prefix = path.slice(0, at);
    name = path.slice(at + 1);
  }
  // A tar header is a fixed layout of fields, each padded to its own width, and
  // the checksum is the sum of the header's bytes with its own field read as
  // spaces - which is what a reader adds up to decide the header is honest.
  header.write(name, 0, 100, 'utf8');
  header.write(prefix, 345, 155, 'utf8');
  header.write(entry.directory === true ? '0000755\0' : '0000644\0', 100, 8, 'utf8');
  header.write(`${(entry.uid ?? 0).toString(8).padStart(7, '0')}\0`, 108, 8, 'utf8');
  header.write(`${(entry.gid ?? 0).toString(8).padStart(7, '0')}\0`, 116, 8, 'utf8');
  header.write(`${bytes.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8');
  // A fixed mtime, the epoch, so the same entries are the same bytes every time
  // they are written, as VS Code writes its SDK tarballs.
  // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/build/agent-sdk/package.ts#L312-L328
  header.write('00000000000\0', 136, 12, 'utf8');
  header.write('        ', 148, 8, 'utf8');
  header.write(entry.directory === true ? '5' : '0', 156, 1, 'utf8');
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
export const archiveOf = (files: ArchiveEntry[]): Buffer =>
  Buffer.concat([...files.map((one) => tarEntry(one)), Buffer.alloc(1024)]);

/**
 * The bytes of the first regular file in a tar archive, which is what `docker
 * cp <container>:<file> -` writes for one file; nothing for an archive with none.
 */
export const firstFileOf = (archive: Buffer): Buffer | undefined => {
  for (let at = 0; at + 512 <= archive.length;) {
    const header = archive.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) return undefined;
    const size = Number.parseInt(header.subarray(124, 136).toString('latin1').replace(/\0.*$/s, '').trim() || '0', 8);
    const type = String.fromCharCode(header[156] ?? 0);
    if (type === '0' || type === '\0') return archive.subarray(at + 512, at + 512 + size);
    at += 512 + ((size + 511) & ~511);
  }
  return undefined;
};

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
 * How long a part that failed to load is refused before it is asked for again,
 * as VS Code holds a failed SDK load: long enough that every machine asking in
 * the meantime is not one more failed build.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSdkDownloader.ts#L230-L231
 */
const LOAD_FAILURE_HELD_MS = 30_000;

/**
 * The last failed load of each part, with when it may be asked again, kept per
 * runtime: the runtime is where a part loads, as VS Code's downloader keeps
 * its own, so a failure on one Docker refuses nothing on another.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSdkDownloader.ts#L277-L289
 */
const failedLoads = new WeakMap<ComputerRuntime, Map<string, { error: Error; until: number }>>();

/**
 * One part's tag, its image pulled the first time anything asks for it: the
 * image the release workflow built from the same Dockerfile and pushed to
 * `registryOf()` at the same tag, as VS Code's build produces each agent SDK
 * once per release and a host downloads it at first use. A checkout's own
 * ahpd part, which no release holds, is built here.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/build/agent-sdk/README.md#L1-L5
 *
 * A part's `requires` are here first: a part installed by npm runs on the
 * `node` part's Node, and a checkout's ahpd part is built on it. A part whose
 * load failed is refused with that failure until `LOAD_FAILURE_HELD_MS` has
 * passed, and loaded again after it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSdkDownloader.ts#L372-L395
 */
export const ensurePart = async (id: string, options: EnsureOptions): Promise<string> => {
  const failures = failedLoads.get(options.runtime) ?? new Map<string, { error: Error; until: number }>();
  failedLoads.set(options.runtime, failures);
  const held = failures.get(id);
  if (held !== undefined && held.until > Date.now()) throw held.error;
  try {
    const parts = options.parts ?? readParts();
    const part = parts.find((one) => one.id === id);
    if (part === undefined) throw new Error(`${versionsPath()} names no ${id} part`);
    for (const need of part.requires ?? []) {
      await ensurePart(need, { ...options, parts });
    }
    const source = part.kind === 'ahpd' ? await ahpdSourceOf(options.log) : undefined;
    // The Dockerfile is what the image is, so it is written once and is both what
    // the tag hashes and what is built: an upgrade that changes how a part is
    // written changes the image while the versions stand still.
    const file = dockerfileOf(part, source);
    const tag = tagOf(part, source?.hash, file);
    await once(tag, async () => {
      if (await options.runtime.hasImage(tag)) return;
      if (source?.from === 'workspace') await options.runtime.buildImage(tag, contextOf(file, [...source.tarballs, ...source.plugins]));
      else await options.runtime.pullImage(`${registryOf()}/${tag}`, tag);
    });
    failures.delete(id);
    return tag;
  }
  catch (error) {
    const failed = error instanceof Error ? error : new Error(String(error));
    failures.set(id, { error: failed, until: Date.now() + LOAD_FAILURE_HELD_MS });
    throw failed;
  }
};

/** One part a machine is made with: its id, the image it comes from, and the version that image is. */
export interface MadePart {
  /** The part's id, which is the directory it is mounted at under `/opt/ahpd`. */
  id: string;
  /** The image it is mounted or filled from. */
  tag: string;
  /**
   * What the tag says after its name: the version, the ahpd part's source hash
   * and the hash of the Dockerfile that wrote the image, whichever of them the
   * tag carries.
   */
  version: string;
  /** The parts it cannot run without, which a machine leaving one out leaves this out with it. */
  requires?: string[];
}

/**
 * The label a machine carries naming the parts it has, as JSON: an array of
 * `{ id, version }`, as the dev container tooling writes its structured label,
 * `devcontainer.metadata`, and VS Code reads a container's labels as JSON.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/devContainerAgentHostService.ts#L967-L976
 *
 * Only the parts it was made with: a part whose load failed is not on it, and
 * that absence is what refuses a session needing that part. The joined image
 * carries the same label with ids alone, so a machine made from it reads the
 * same way.
 */
export const MACHINE_PARTS = 'ahpd.parts';

/**
 * The label value for a machine made with these parts, and with `host` mounted
 * from this host in place of parts that could not be loaded, each of those at
 * the version `host`.
 */
export const partsLabel = (parts: readonly MadePart[], host: readonly string[] = []): string =>
  JSON.stringify([...parts.map(({ id, version }) => ({ id, version })), ...host.map((id) => ({ id, version: 'host' }))]);

/**
 * The part ids a label value names: the `id` of each entry in its JSON, and
 * for a label an older daemon wrote, `<id>@<version>` joined by commas, the id
 * before each `@`. A machine outlives the daemon that made it, and a label
 * cannot change on a container that runs, so both are read, as VS Code reads
 * a container's older folder label, `vsch.local.folder`, beside the current one.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/devContainerAgentHostService.ts#L977-L981
 */
export const partsSaid = (value: unknown): string[] => {
  if (typeof value !== 'string') return [];
  let said: unknown;
  try {
    said = JSON.parse(value);
  }
  catch {
    return value.split(',').map((one) => one.trim().split('@')[0] ?? '').filter((one) => one !== '');
  }
  if (!Array.isArray(said)) return [];
  return said
    .map((one: unknown) => (typeof one === 'object' && one !== null ? (one as Record<string, unknown>)['id'] : undefined))
    .filter((id): id is string => typeof id === 'string' && id !== '');
};

/** The `PATH` Docker gives a container whose image sets none. */
export const IMAGE_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

/**
 * The volume a part is copied into where an image mount is refused,
 * `ahpd-part-<id>-<version>`.
 *
 * The version is in the name, so a bump makes a new volume, and the old one is
 * removed once no machine has used it for a week (`PART_VOLUME_KEPT_MS`). So
 * is the Dockerfile's own hash, since a rebuild under a new tag fills a volume
 * of its own rather than the one the older image filled. A character Docker
 * refuses in a volume name - the `+` of a build suffix - is written `_`.
 */
export const volumeOf = (part: MadePart): string =>
  `ahpd-part-${part.id}-${part.version.replace(/[^A-Za-z0-9_.-]/g, '_')}`;

/**
 * The file written into a part volume once it is filled, and last, holding
 * the image it was filled from and when a machine last used it.
 *
 * A volume without it is a fill that stopped half way, which is removed and
 * filled again rather than mounted. Its time is the volume's last use, as VS
 * Code's sentinel in a cached SDK records the SDK's last use.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSdkCache.ts#L11-L15
 */
export const FILLED_MARKER = '.ahpd-filled';

/** The marker's text: the image's tag, then the time of the last use. */
export const markerText = (tag: string, used: number): string => `${tag}\n${new Date(used).toISOString()}\n`;

/** The last use a marker's text records, or nothing for one that records none. */
export const markerUsed = (text: string): number | undefined => {
  const used = Date.parse(text.split('\n')[1] ?? '');
  return Number.isNaN(used) ? undefined : used;
};

/**
 * How long a part volume of a version the versions file does not name is kept
 * after a machine last used it, as VS Code keeps a cached SDK version the
 * product does not ask for: another daemon on the same Docker may still run
 * that version.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSdkCache.ts#L17-L22
 */
export const PART_VOLUME_KEPT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The least time between two writes of a volume's last use while machines keep
 * using it, as VS Code refreshes a cached SDK's.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSdkDownloader.ts#L244-L245
 */
export const PART_VOLUME_USE_REFRESH_MS = 60 * 60 * 1000;

/**
 * Whether a part volume is of a version the versions file names, kept however
 * long ago a machine used it: the volume of each of that version's Dockerfiles,
 * as VS Code keeps every target of a version the product asks for.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSdkCache.ts#L30-L36
 */
export const requestedVolume = (volume: string, parts: readonly Part[]): boolean =>
  parts.some((part) => volume.startsWith(`${volumeOf({ id: part.id, tag: '', version: pinnedOf(part) })}-`));

/**
 * How long after the plugin starts its part volumes are swept, as VS Code
 * waits before it cleans its SDK cache, so the sweep stays out of the way of
 * startup's own work.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSdkDownloader.ts#L241-L242
 */
export const PART_VOLUME_SWEEP_DELAY_MS = 30_000;

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
 * Every part a machine asks for, loaded where it is not already, with what each
 * requires.
 *
 * A part whose load fails, or whose requirement's load fails, is answered
 * among `failed` with the load's own reason rather than thrown: the machine is
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
  catch { /* each load below says why the file could not be read */ }
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
export const JOINED_PACKAGES = 'ca-certificates git ripgrep';

/**
 * The Dockerfile of the joined image: a machine with every part in it, at the
 * path each is mounted at, copied from the part images this host has.
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
 && apt-get install --yes --no-install-recommends ${JOINED_PACKAGES} \\
 && rm -rf /var/lib/apt/lists/*`,
  ...parts.map((part) => `COPY --from=${tags.get(part.id)} /opt/ahpd/${part.id} /opt/ahpd/${part.id}`),
  // Every part's launchers on the PATH, so `/opt/ahpd/codex/bin/codex-acp`
  // and the bare `codex-acp` are the same command.
  `ENV PATH="${parts.map((part) => `/opt/ahpd/${part.id}/bin`).join(':')}:${'${PATH}'}"`,
  // What it holds, so a machine it was built without can be told from one built
  // from a versions file that has since moved: the machine's own label, ids alone.
  `LABEL ${MACHINE_PARTS}=${JSON.stringify(JSON.stringify(parts.map((part) => ({ id: part.id }))))}`,
].join('\n');

/** The joined image: its tag, the parts it holds and the parts it does not. */
export interface Joined {
  /** The tag it was built at, `ahpd-agents:<hash of the file and the ahpd part's tag>`. */
  tag: string;
  /** Every part whose image was here, at the path it is mounted at. */
  parts: Part[];
  /** The parts whose image could not be loaded, in the order the file names them. */
  missing: string[];
}

/**
 * The joined image, every part in it and every part loaded on the way.
 *
 * A part that will not load does not stop the rest: the image is built without
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
  // folds that tag in - beside the ids of the parts that built, so an image
  // made without one is a different image rather than this one reused. The
  // Dockerfile is folded in too: it names the tag of every part it copies from,
  // so a part whose own Dockerfile moved is written into the joined image under
  // a tag this text now names, and the image is a different one at the same
  // versions.
  //
  // Asked for only when the ahpd part is one of the parts that built. Its build
  // asks for it too, so an ahpd part in the image has already answered it and
  // this is the remembered answer. An ahpd part that did not build - from a
  // checkout with no `pnpm build`, which is what `prepack`'s `tsc -p .` needs -
  // is in `missing` with its reason, and asking again here would throw the same
  // refusal out of the whole join: no machine at all would be made, where the
  // point of `missing` is that every machine not needing that part still is.
  const hash = held.some((one) => one.kind === 'ahpd') ? (await ahpdSourceOf(options.log)).hash : undefined;
  const file = joinedDockerfile(held, tags);
  const tag = `ahpd-agents:${hashOf(hash, named, held.map((part) => part.id), file)}`;
  return once(tag, async () => {
    if (!await options.runtime.hasImage(tag)) {
      await options.runtime.buildImage(tag, contextOf(file));
    }
    return { tag, parts: held, missing };
  });
};
