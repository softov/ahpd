import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { dockerfileOf, hashOf, lockOf, packageOf, partsLabel, partsSaid, readParts, tagOf, versionsPath } from '../src/parts.js';
import type { AhpdSource, Part } from '../src/parts.js';

/*
 * The versions file, and the tags it answers.
 *
 * The file that ships is read here as it is, because a file nothing reads is a
 * file nobody checks, and the refusals are driven through files written for the
 * case rather than through the shipped one: what a person would break by hand
 * is what the reader has to say no to.
 */

let loose: string | undefined;
afterEach(() => {
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
});

/** A versions file of the cases given, in a directory of its own. */
const file = (parts: unknown[]): string => {
  loose ??= mkdtempSync(join(tmpdir(), 'ahpd-parts-'));
  const path = join(loose, 'versions.json');
  writeFileSync(path, `${JSON.stringify(parts, null, 2)}\n`);
  return path;
};

/** The parts a file reads as, so a refusal is about one field rather than about spelling. */
const read = (parts: unknown[]): Part[] => readParts(file(parts));

/** One npm part, as the refusals below each start from. */
const npm = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'codex',
  name: 'Codex',
  kind: 'npm',
  version: '2.1.1',
  requires: ['node'],
  packages: ['@agentclientprotocol/codex-acp'],
  bin: ['codex-acp'],
  ...over,
});

/** One archive part, which is a download per platform rather than a package. */
const archive = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'goose',
  name: 'Goose',
  kind: 'archive',
  version: '1.53.0',
  archives: { 'linux-x64': { url: 'https://example.test/goose.tar.gz', sha256: 'ab'.repeat(32) } },
  bin: ['goose'],
  paths: { goose: 'goose' },
  ...over,
});

/** The `node` part every npm part requires, so a `requires` resolves. */
const node = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'node',
  name: 'Node',
  kind: 'node',
  version: '24.21.0',
  archives: {
    'linux-x64': { url: 'https://example.test/node-x64.tar.xz', sha256: 'ab'.repeat(32) },
    'linux-arm64': { url: 'https://example.test/node-arm64.tar.xz', sha256: 'cd'.repeat(32) },
  },
  bin: ['node', 'npm', 'npx'],
  ...over,
});

/** The `ahpd` part, which is the only one whose tag carries its source. */
const ahpd = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'ahpd',
  name: 'ahpd',
  kind: 'ahpd',
  version: '0.8.0',
  requires: ['node'],
  plugins: ['@ahpd/agent-cofold', '@ahpd/agent-pi'],
  bin: ['ahpd'],
  ...over,
});

it('reads the file that ships, and every part it names', () => {
  const parts = readParts(versionsPath());

  expect(parts.map((one) => one.id)).toEqual([
    'node', 'ahpd', 'claude', 'codex', 'gemini', 'copilot', 'opencode',
    'kilo', 'goose', 'pi', 'dsh', 'devin', 'cursor', 'amp', 'qwen',
  ]);
  expect(parts.map((one) => one.kind)).toEqual([
    'node', 'ahpd', 'npm', 'npm', 'npm', 'npm', 'archive',
    'npm', 'archive', 'npm', 'npm', 'archive', 'archive', 'archive', 'npm',
  ]);

  const codex = parts.find((one) => one.id === 'codex');
  // The version moves with each bump, so only its form is checked.
  expect(codex?.version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(codex?.packages).toEqual(['@agentclientprotocol/codex-acp']);
  expect(codex?.bin).toEqual(['codex-acp']);
  expect(codex?.requires).toEqual(['node']);

  // The two backends that run nested are named by the ahpd entry, because they
  // are the ones the ahpd part installs for itself.
  expect(parts.find((one) => one.id === 'ahpd')?.plugins).toEqual([
    '@ahpd/agent-cofold', '@ahpd/agent-pi',
  ]);

  // Every download carries the checksum the reader refuses without, and every
  // part that runs on Node says so.
  for (const part of parts) {
    if (part.archives === undefined) continue;
    expect(Object.keys(part.archives).sort()).toEqual(['linux-arm64', 'linux-x64']);
    for (const [platform, one] of Object.entries(part.archives)) {
      expect(one.sha256, `${part.id} ${platform}`).toMatch(/^[0-9a-f]{64}$/);
      expect(one.url, `${part.id} ${platform}`).toMatch(/^https:\/\//);
    }
  }
  for (const part of parts.filter((one) => one.kind === 'npm' || one.kind === 'ahpd')) {
    expect(part.requires, part.id).toContain('node');
  }
});

it('refuses a file with two parts of one id', () => {
  expect(() => read([npm(), npm({ name: 'Other' })])).toThrow(/names codex twice/);
});

it('refuses a version that is not one exact version, in VS Code\'s words', () => {
  for (const version of ['^2.1.1', '~2.1.1', '2.x', 'latest', '2.1', '2.1.1+build.5']) {
    expect(() => read([npm({ version })])).toThrow(`Refusing to use codex@${version} from ${versionsPath()}: must be an exact version (no ^ or ~ ranges)`);
  }
  expect(() => read([node(), npm({ packages: ['@openai/codex@0.1.0+build'] })]))
    .toThrow(`Refusing to use @openai/codex@0.1.0+build from ${versionsPath()}: must be an exact version (no ^ or ~ ranges)`);
  // A prerelease is one version, not a range, its own dashes included.
  expect(read([node(), npm({ version: '0.2.0-rc.2' })])[1]?.version).toBe('0.2.0-rc.2');
  expect(read([node(), npm({ version: '0.2.0-rc-2' })])[1]?.version).toBe('0.2.0-rc-2');
});

/*
 * An id, a command and an update variable land unquoted in the Dockerfile's
 * shell lines, so each is held to the alphabet VS Code holds such a value to,
 * and the id names an image as well.
 */
it('refuses an id, a command or an update that would reach a shell line as something else', () => {
  expect(() => read([npm({ id: 'codex;id' })])).toThrow('Unsafe part id value for shell interpolation: "codex;id"');
  expect(() => read([npm({ bin: ['codex acp'] })])).toThrow('Unsafe bin value for shell interpolation: "codex acp"');
  expect(() => read([npm({ updates: { 'NO UPDATE': '1' } })])).toThrow('Unsafe update variable value for shell interpolation: "NO UPDATE"');
  expect(() => read([npm({ updates: { NO_UPDATE: '1; id' } })])).toThrow('Unsafe update value value for shell interpolation: "1; id"');
  expect(() => read([npm({ id: 'Codex' })])).toThrow(/has the id Codex, which an image name cannot hold: invalid reference format/);
  expect(read([node(), npm({ updates: { CODEX_NO_UPDATE: '1' } })])[1]?.updates).toEqual({ CODEX_NO_UPDATE: '1' });
});

it('refuses a tag the reference grammar does not take', () => {
  const long = read([node(), npm({ version: `1.0.0-${'a'.repeat(130)}` })])[1] as Part;
  expect(() => tagOf(long)).toThrow(/invalid reference format/);
});

/*
 * The download is picked by the architecture BuildKit says the build is for,
 * and a build that says none is refused rather than given another one's.
 */
it('picks a download by TARGETARCH, and refuses a build that sets none', () => {
  const part = read([archive({
    archives: {
      'linux-x64': { url: 'https://example.test/goose-x64.tar.gz', sha256: 'ab'.repeat(32) },
      'linux-arm64': { url: 'https://example.test/goose-arm64.tar.gz', sha256: 'cd'.repeat(32) },
    },
  })])[0] as Part;
  const file = dockerfileOf(part);
  const picked = file.slice(file.indexOf('case "'), file.indexOf('esac;') + 'esac;'.length).replace(/\\\n/gu, '');
  const run = (env: Record<string, string>) =>
    spawnSync('sh', ['-c', `set -eu; ${picked} printf '%s' "$url"`], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } });

  expect(run({ TARGETARCH: 'arm64' }).stdout).toBe('https://example.test/goose-arm64.tar.gz');
  const unset = run({});
  expect(unset.status).not.toBe(0);
  expect(unset.stderr).toContain('TARGETARCH: is not set, which BuildKit sets to the architecture a build is for');
});

it('refuses an archive nothing can check', () => {
  expect(() => read([archive({ archives: { 'linux-x64': { url: 'https://example.test/goose.tar.gz' } } })]))
    .toThrow(/has no sha256 for linux-x64/);
  expect(read([archive()])[0]?.archives).toEqual({
    'linux-x64': { url: 'https://example.test/goose.tar.gz', sha256: 'ab'.repeat(32) },
  });
});

it('refuses a url or a sum that would reach the shell as something else', () => {
  const at = (url: string, sha256 = 'ab'.repeat(32)) => () => read([archive({ archives: { 'linux-x64': { url, sha256 } } })]);
  expect(at('https://example.test/a.tar.gz;id')).toThrow(/not a plain https url/);
  expect(at('https://example.test/$(id).tar.gz')).toThrow(/not a plain https url/);
  expect(at('http://example.test/goose.tar.gz')).toThrow(/not a plain https url/);
  expect(at('https://example.test/goose.tar.gz', 'AB'.repeat(32))).toThrow(/not 64 hex digits/);
  expect(at('https://example.test/goose.tar.gz', 'ab; id')).toThrow(/not 64 hex digits/);
});

it('refuses a part that requires one the file does not name', () => {
  expect(() => read([npm()])).toThrow(/codex requires node, which it does not name/);
  expect(read([node(), npm()])).toHaveLength(2);
});

it('refuses an entry that names no kind, no version or no command', () => {
  expect(() => read([npm({ kind: 'cargo' })])).toThrow(/names no kind this can build: cargo/);
  expect(() => read([npm({ version: undefined })])).toThrow(/has no version/);
  expect(() => read([npm({ bin: undefined })])).toThrow(/names no command/);
  expect(() => read(['codex'])).toThrow(/is not an entry/);
});

it('tags a part with its version, and the ahpd part with its source', () => {
  const parts = read([node(), npm()]);
  const codex = parts.find((one) => one.id === 'codex') as Part;
  const host = read([node(), ahpd()])[1] as Part;

  expect(tagOf(codex)).toBe('ahpd-part/codex:2.1.1');
  expect(tagOf(host, 'abcdef123456')).toBe('ahpd-part/ahpd:0.8.0-abcdef123456');

  // The same version and different code is a different image, which is the
  // whole reason the source is in the tag.
  expect(tagOf(host, '000000000000')).not.toBe(tagOf(host, 'abcdef123456'));
  // And a tag without it is a refusal rather than an image that reuses itself.
  expect(() => tagOf(host)).toThrow(/carries a hash of its own source/);

  // The Dockerfile is in the tag beside the version, so an upgrade that changes
  // how an image is written is a different image at the same versions.
  expect(tagOf(codex, undefined, 'FROM scratch\n')).toMatch(/^ahpd-part\/codex:2\.1\.1-[0-9a-f]{12}$/u);
  expect(tagOf(codex, undefined, 'FROM scratch\n')).not.toBe(tagOf(codex, undefined, 'FROM scratch\n\n'));
  expect(tagOf(host, 'abcdef123456', 'FROM scratch\n')).toMatch(/^ahpd-part\/ahpd:0\.8\.0-abcdef123456-[0-9a-f]{12}$/u);
});

it('hashes the file, the ahpd part and the joined Dockerfile together, so either moves the joined image', () => {
  const one = hashOf('abcdef123456');
  expect(one).toMatch(/^[0-9a-f]{12}$/);
  // The same file and the same source is the same image.
  expect(hashOf('abcdef123456')).toBe(one);
  // A checkout whose code moved rebuilds it even though no version changed.
  expect(hashOf('000000000000')).not.toBe(one);
  // And so does the text the joined image is written from, which names every
  // part's own tag - one of them moving is this image moving.
  expect(hashOf('abcdef123456', readParts(), [], 'FROM debian:bookworm-slim\n')).not.toBe(one);
});

/** One tarball as a build context carries it, with bytes no test reads. */
const tarball = (name: string): { name: string; bytes: Buffer } => ({ name, bytes: Buffer.from(name) });

/** A part's two files, as `lockOf` reads them, standing in for the ones npm writes. */
const lockWith = (text = '{}\n') => [
  { name: 'package.json', bytes: Buffer.from('{ "private": true }\n') },
  { name: 'package-lock.json', bytes: Buffer.from(text) },
];

/** The line a Dockerfile checks one file of a lock with. */
const checked = (one: { name: string; bytes: Buffer }): string =>
  `echo "${createHash('sha256').update(one.bytes).digest('hex')}  ${one.name}" | sha256sum --check --strict -`;

/**
 * The `node` tag a Dockerfile copies from.
 *
 * `dockerfileOf` names it out of the file that ships rather than out of the
 * parts a case handed it, so a case reading its own node part still copies the
 * shipped one - which is the same part in a daemon, and a stand-in only here.
 */
const nodeTag = (): string => {
  const one = readParts().find((part) => part.kind === 'node') as Part;
  return tagOf(one, undefined, dockerfileOf(one));
};

/** The ahpd part from a checkout, with the tarballs `pnpm pack` would have written. */
const workspace: AhpdSource = {
  from: 'workspace',
  hash: 'abcdef123456',
  tarballs: [tarball('ahpd-server.tgz'), tarball('ahpd-sdk.tgz')],
  plugins: [tarball('agent-cofold.tgz'), tarball('agent-pi.tgz')],
};

it('builds the node part as a download, with no launcher of its own', () => {
  const part = read([node()])[0] as Part;
  const file = dockerfileOf(part);

  // Both architectures are in the one Dockerfile, each with its own checksum.
  expect(file).toContain('ARG TARGETARCH');
  expect(file).toContain('node-x64.tar.xz');
  expect(file).toContain('node-arm64.tar.xz');
  expect(file).toContain('sha256sum --check --strict');
  // The tarball's one wrapping directory goes, so Node is at `/opt/ahpd/node/bin`,
  // where every part that copies it in puts it on the PATH.
  expect(file).toContain('tar "${how}" part -C /opt/ahpd/node --strip-components=1;');
  // A launcher for `node` would be a file that runs itself, so there is none.
  expect(file).not.toContain('bin/node');
  expect(file).toMatch(/FROM scratch\nCOPY --from=fetch \/opt\/ahpd\/node \/opt\/ahpd\/node$/);
});

it('builds an npm part on the node part, from its lock, each file checked by its sum', () => {
  const part = read([node(), npm()])[1] as Part;
  const lock = lockWith();
  const file = dockerfileOf(part, undefined, lock);

  // One Node serves them all, copied in rather than fetched a second time.
  expect(file).toContain(`COPY --from=${nodeTag()} /opt/ahpd/node /opt/ahpd/node`);
  expect(file).toContain('ENV PATH="/opt/ahpd/node/bin:${PATH}"');
  // The two files are copied in and checked, then `npm ci` installs what they lock.
  expect(file).toContain('COPY package.json package-lock.json /opt/ahpd/codex/');
  expect(file).toContain(`RUN cd /opt/ahpd/codex \\\n && ${checked(lock[0]!)} \\\n && ${checked(lock[1]!)} \\\n && npm ci --no-audit --no-fund --loglevel=error`);
  expect(file).not.toContain('npm install');
  // A lock that moves is a Dockerfile that moves, so the tag the image is built at moves too.
  expect(tagOf(part, undefined, file)).not.toBe(tagOf(part, undefined, dockerfileOf(part, undefined, lockWith('{ "moved": true }\n'))));
  // A part with npm packages is never written without its lock.
  expect(() => dockerfileOf(part)).toThrow(/installs its npm packages from its package\.json and package-lock\.json, which is what lockOf\(\) answers/);
  // A script bin runs on the part's Node; the launcher holds what the build found.
  expect(file).toContain(`run=/opt/ahpd/codex/node_modules/.bin/codex-acp; case "$(head -c 2 /opt/ahpd/codex/node_modules/.bin/codex-acp)" in '#!') run="/opt/ahpd/node/bin/node /opt/ahpd/codex/node_modules/.bin/codex-acp";; esac`);
  expect(file).toContain(`printf 'exec %s "$@"\\n' "$run" >> /opt/ahpd/codex/bin/codex-acp`);
  expect(file).toMatch(/FROM scratch\nCOPY --from=fetch \/opt\/ahpd\/codex \/opt\/ahpd\/codex$/);
});

it('installs a package pinned at its own version, and moves the tag with it', () => {
  const part = read([node(), npm({
    id: 'claude',
    name: 'Claude',
    version: '0.85.1',
    packages: ['@agentclientprotocol/claude-agent-acp', '@anthropic-ai/claude-code@2.1.291'],
    bin: ['claude-agent-acp', 'claude'],
  })])[1] as Part;
  const file = dockerfileOf(part, undefined, lockWith());

  // Each bin gets its launcher, the native `claude` included.
  expect(file).toContain('> /opt/ahpd/claude/bin/claude-agent-acp');
  expect(file).toContain('> /opt/ahpd/claude/bin/claude;');
  expect(tagOf(part)).toBe('ahpd-part/claude:0.85.1-2.1.291');
  // The tag the image is actually built at carries the Dockerfile too.
  expect(tagOf(part, undefined, file)).toMatch(/^ahpd-part\/claude:0\.85\.1-2\.1\.291-[0-9a-f]{12}$/u);

  expect(() => read([node(), npm({ packages: ['@anthropic-ai/claude-code@^2.1.291'] })]))
    .toThrow(`Refusing to use @anthropic-ai/claude-code@^2.1.291 from ${versionsPath()}: must be an exact version (no ^ or ~ ranges)`);
});

it('installs an archive part\'s npm packages beside its download, each at its own version', () => {
  const part = read([node(), archive({
    id: 'amp',
    name: 'Amp',
    version: '0.9.0',
    requires: ['node'],
    packages: ['@ampcode/cli@0.0.1791273659-g33d612'],
    archives: {
      'linux-x64': { url: 'https://example.test/amp-acp.tar.gz', sha256: 'ab'.repeat(32) },
      'linux-arm64': { url: 'https://example.test/amp-acp-arm64.tar.gz', sha256: 'cd'.repeat(32) },
    },
    bin: ['amp-acp', 'amp'],
    paths: { 'amp-acp': 'amp-acp' },
  })])[1] as Part;
  const file = dockerfileOf(part, undefined, lockWith());

  expect(file).toContain(`COPY --from=${nodeTag()} /opt/ahpd/node /opt/ahpd/node`);
  expect(file).toContain('COPY package.json package-lock.json /opt/ahpd/amp/');
  expect(file).toContain('npm ci --no-audit --no-fund --loglevel=error');
  // The packages are installed before the download unpacks beside them.
  expect(file.indexOf('npm ci')).toBeLessThan(file.indexOf('curl --fail'));
  // A command with no path is the one npm installed, written from
  // `node_modules/.bin`, and the other runs from its path in the download.
  expect(file).toContain('test -e /opt/ahpd/amp/node_modules/.bin/amp || { echo "the amp download holds no node_modules/.bin/amp to run" >&2; exit 1; }; run=/opt/ahpd/amp/node_modules/.bin/amp;');
  expect(file).toContain('test -x /opt/ahpd/amp/amp-acp || { echo "the amp download holds no amp-acp to run" >&2; exit 1; }');
  expect(file).toContain('"/opt/ahpd/amp/amp-acp" >> /opt/ahpd/amp/bin/amp-acp');
  expect(tagOf(part)).toBe('ahpd-part/amp:0.9.0-0.0.1791273659-g33d612');
  expect(tagOf(part, undefined, file)).toMatch(/^ahpd-part\/amp:0\.9\.0-0\.0\.1791273659-g33d612-[0-9a-f]{12}$/u);

  expect(() => read([node(), archive({ requires: ['node'], packages: ['@ampcode/cli'] })]))
    .toThrow(/the package @ampcode\/cli with no version of its own/);
  expect(() => read([node(), archive({ packages: ['@ampcode/cli@1.0.0'] })])).toThrow(/installs npm packages and does not require node/);
});

it('ships a claude part that holds the claude command next to the ACP adapter', () => {
  const claude = readParts(versionsPath()).find((one) => one.id === 'claude');
  expect(claude?.bin).toEqual(['claude-agent-acp', 'claude']);
  expect(claude?.packages?.[1]).toMatch(/^@anthropic-ai\/claude-code@\d+\.\d+\.\d+$/);
});

/** What a `package.json` and a `package-lock.json` hold that the check below reads. */
type Locked = {
  dependencies?: Record<string, string>;
  packages?: Record<string, { version?: string; dependencies?: Record<string, string> }>;
};

/*
 * Each shipped part that installs npm packages is installed from its lock, and
 * its `package.json` pins the versions the file names, as VS Code's build test
 * holds each agent SDK's pin and its lock in lockstep (build/agent-sdk/README.md
 * L96-L97 at 6b68d3fe).
 */
it('keeps each shipped part lock in step with the versions the file names', () => {
  const locked = readParts(versionsPath()).filter((one) => one.kind === 'ahpd' || one.packages !== undefined);
  expect(locked.length).toBeGreaterThan(0);
  for (const part of locked) {
    const [manifest, lock] = (lockOf(part) ?? []).map((one) => JSON.parse(one.bytes.toString('utf8')) as Locked);
    const pinned = part.kind === 'ahpd'
      ? { '@ahpd/sdk': part.version, '@ahpd/server': part.version }
      : Object.fromEntries((part.packages ?? []).map((one) => [packageOf(one).name, packageOf(one).version ?? part.version]));
    expect(manifest?.dependencies, part.id).toEqual(pinned);
    expect(lock?.packages?.['']?.dependencies, part.id).toEqual(pinned);
    for (const [name, version] of Object.entries(pinned)) {
      expect(lock?.packages?.[`node_modules/${name}`]?.version, `${part.id} ${name}`).toBe(version);
    }
  }
});

it('turns a CLI own update off in the launcher, not in the machine', () => {
  const one = read([node(), npm({
    id: 'copilot',
    name: 'GitHub Copilot',
    version: '1.0.91',
    packages: ['@github/copilot'],
    bin: ['copilot'],
    updates: { COPILOT_AUTO_UPDATE: 'false' },
  })])[1] as Part;

  // The launcher sets it, so every run of the part gets it and the machine's
  // own environment says nothing about this one CLI.
  expect(dockerfileOf(one, undefined, lockWith())).toContain(`'#!/bin/sh' 'export COPILOT_AUTO_UPDATE=false' > /opt/ahpd/copilot/bin/copilot`);
  expect(dockerfileOf(one, undefined, lockWith())).not.toContain('ENV COPILOT_AUTO_UPDATE');
});

/*
 * An archive part runs each command from the path its entry names in the
 * download, the publisher's layout for that version, as VS Code knows each
 * agent SDK's layout rather than searching it (build/agent-sdk/README.md L80
 * at 6b68d3fe).
 */
it('builds an archive part by downloading it, and runs each command from the path its entry names', () => {
  const one = read([archive({
    archives: {
      'linux-x64': { url: 'https://example.test/goose.tar.gz', sha256: 'ab'.repeat(32) },
      'linux-arm64': { url: 'https://example.test/goose-arm64.tar.bz2', sha256: 'cd'.repeat(32) },
    },
    paths: { goose: 'goose-x86_64/goose' },
  })])[0] as Part;
  const file = dockerfileOf(one);

  expect(file).toContain('url=https://example.test/goose.tar.gz; sum=' + 'ab'.repeat(32));
  expect(file).toContain('url=https://example.test/goose-arm64.tar.bz2; sum=' + 'cd'.repeat(32));
  // bzip2 for the arm64 one, gzip for the other: `tar` is told per build.
  expect(file).toContain('how=-xjf;;');
  expect(file).toContain('how=-xzf;;');
  expect(file).toContain('tar "${how}" part -C /opt/ahpd/goose');
  // The launcher runs the named path, and a download without it fails the build.
  expect(file).toContain('test -x /opt/ahpd/goose/goose-x86_64/goose || { echo "the goose download holds no goose-x86_64/goose to run" >&2; exit 1; }');
  expect(file).toContain('"/opt/ahpd/goose/goose-x86_64/goose" >> /opt/ahpd/goose/bin/goose');
  expect(file).not.toContain('find ');

  // A command the publisher put at `bin/<command>` is its own launcher, so
  // nothing is written over it.
  const devin = dockerfileOf(read([archive({
    id: 'devin',
    name: 'Devin',
    archives: {
      'linux-x64': { url: 'https://example.test/devin.tar.gz', sha256: 'ab'.repeat(32) },
      'linux-arm64': { url: 'https://example.test/devin-arm64.tar.gz', sha256: 'cd'.repeat(32) },
    },
    bin: ['devin'],
    paths: { devin: 'bin/devin' },
  })])[0] as Part);
  expect(devin).toContain('test -x /opt/ahpd/devin/bin/devin || { echo "the devin download holds no bin/devin to run" >&2; exit 1; }');
  expect(devin).not.toContain('> /opt/ahpd/devin/bin/devin');
});

it('refuses an archive part that names no path for a command, or a path outside its download', () => {
  expect(() => read([archive({ paths: undefined })])).toThrow(/names no path in its download for goose/);
  expect(() => read([archive({ paths: { goose: '../goose' } })])).toThrow(/has the path \.\.\/goose for goose, which is not a path in its download/);
  expect(() => read([archive({ paths: { goose: '/usr/bin/goose' } })])).toThrow(/which is not a path in its download/);
  expect(() => read([archive({ paths: { goose: 'goose', other: 'other' } })])).toThrow(/has a path for other, which its bin does not name/);
  expect(() => read([node(), npm({ paths: { 'codex-acp': 'codex-acp' } })])).toThrow(/names paths, which only an archive part's download has/);
});

it('refuses an archive part whose file gives no download for a platform', () => {
  const one = read([archive()])[0] as Part;
  expect(() => dockerfileOf(one)).toThrow(/has no linux-arm64 download for goose/);
});

it('builds the ahpd part from npm with its own plugins inside it', () => {
  const part = read([node(), ahpd()])[1] as Part;
  const file = dockerfileOf(part, { from: 'npm', version: '0.8.0', hash: 'abcdef123456' }, lockWith());

  // `@ahpd/sdk` and `@ahpd/server` at the part's version are what its lock holds.
  expect(file).toContain('COPY package.json package-lock.json /opt/ahpd/ahpd/');
  expect(file).toContain('npm ci --no-audit --no-fund --loglevel=error');
  // The nested backends are installed by the command they will be run through,
  // because an inner host resolves a package only under its own prefix.
  expect(file).toContain('AHPD_PLUGIN_ROOT=/opt/ahpd/ahpd/plugins /opt/ahpd/ahpd/node_modules/.bin/ahpd plugin install --no-enable @ahpd/agent-cofold@0.8.0 @ahpd/agent-pi@0.8.0');
  // And the launcher sets the root, because a `FROM scratch` stage keeps nothing
  // that is not under /opt/ahpd/ahpd - the config dir is not writable here.
  expect(file).toContain(`printf 'exec %s "$@"\\n' "/opt/ahpd/node/bin/node /opt/ahpd/ahpd/node_modules/.bin/ahpd" >> /opt/ahpd/ahpd/bin/ahpd`);
  // Nothing in the part names a config dir, which a machine sets for its own.
  expect(file).not.toContain('XDG_CONFIG_HOME');
});

it('builds the ahpd part of a checkout from the workspace own tarballs', () => {
  const part = read([node(), ahpd()])[1] as Part;
  const file = dockerfileOf(part, workspace);

  // A checkout holds what the working tree holds, not what npm publishes.
  expect(file).toContain('COPY ahpd-server.tgz ahpd-sdk.tgz agent-cofold.tgz agent-pi.tgz ./');
  expect(file).toContain('npm install --prefix /opt/ahpd/ahpd');
  expect(file).toContain('./ahpd-server.tgz ./ahpd-sdk.tgz');
  expect(file).toContain('npm install --prefix /opt/ahpd/ahpd/plugins');
  expect(file).toContain(`'export AHPD_PLUGIN_ROOT=/opt/ahpd/ahpd/plugins'`);
  // No `ahpd plugin install` here: the plugins of a checkout are tarballs
  // copied into the image, so they go in by npm, into the root the launcher
  // will point the command at.
  expect(file).not.toContain('plugin install');
});

it('refuses to build the ahpd part without being told where its code is', () => {
  const part = read([node(), ahpd()])[1] as Part;
  expect(() => dockerfileOf(part)).toThrow(/which is what ahpdSourceOf\(\) answers/);
});

/** The instructions a Dockerfile is, which are its lines joined where a line ends in a backslash. */
const instructionsOf = (file: string): string[] => {
  const held: string[] = [];
  for (const line of file.split('\n')) {
    const last = held[held.length - 1];
    if (last !== undefined && last.endsWith('\\')) held[held.length - 1] = `${last}\n${line}`;
    else held.push(line);
  }
  return held.filter((one) => one !== '');
};

it('writes every Dockerfile as instructions docker would accept', () => {
  const known = ['FROM', 'ARG', 'RUN', 'COPY', 'ENV', 'WORKDIR', 'LABEL'];
  const both = {
    'linux-x64': { url: 'https://example.test/goose.tar.gz', sha256: 'ab'.repeat(32) },
    'linux-arm64': { url: 'https://example.test/goose-arm64.tar.bz2', sha256: 'cd'.repeat(32) },
  };
  const cases = [
    [node()], [node(), npm()], [archive({ archives: both })],
    // Two launchers, because a part may name more than one, and one of them the
    // publisher's own at `bin/<command>`.
    [archive({ archives: both, bin: ['goose', 'goose-helper'], paths: { goose: 'goose', 'goose-helper': 'bin/goose-helper' } })],
  ] as const;
  const ahpdPart = read([node(), ahpd()])[1] as Part;

  const files = [
    ...cases.map((parts) => dockerfileOf(read([...parts])[parts.length - 1] as Part, undefined, lockWith())),
    dockerfileOf(ahpdPart, { from: 'npm', version: '0.8.0', hash: 'abcdef123456' }, lockWith()),
    dockerfileOf(ahpdPart, workspace),
  ];

  for (const file of files) {
    for (const instruction of instructionsOf(file)) {
      const word = instruction.split(' ')[0];
      // A `RUN` whose second line lost its backslash arrives here as an
      // instruction of its own, beginning `&&`, and docker answers
      // `unknown instruction: &&`. Text assertions never see it.
      expect(known, instruction).toContain(word);
    }
  }
});

/*
 * A machine's parts label is JSON, as the dev container tooling writes its
 * structured label and VS Code reads a container's labels as JSON
 * (devContainerAgentHostService.ts L967-L976 at 6b68d3fe); a label an older
 * daemon wrote, a comma list, is read too, as VS Code reads a container's
 * older folder label beside the current one (L977-L981).
 */
it('writes the parts label as JSON, and reads it and an older daemon\'s comma list back', () => {
  const written = partsLabel([{ id: 'codex', tag: 'ahpd-part/codex:2.1.1', version: '2.1.1' }], ['claude']);
  expect(JSON.parse(written)).toEqual([{ id: 'codex', version: '2.1.1' }, { id: 'claude', version: 'host' }]);
  expect(partsSaid(written)).toEqual(['codex', 'claude']);
  expect(partsSaid('codex@2.1.1,claude@host')).toEqual(['codex', 'claude']);
  expect(partsSaid(JSON.stringify([{ id: 'node' }]))).toEqual(['node']);
  expect(partsSaid(undefined)).toEqual([]);
});
