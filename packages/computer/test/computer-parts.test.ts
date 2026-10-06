import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { dockerfileOf, hashOf, readParts, tagOf, versionsPath } from '../src/parts.js';
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
  expect(codex?.version).toBe('2.1.1');
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

it('refuses a version that is a range rather than one version', () => {
  for (const version of ['^2.1.1', '~2.1.1', '2.x', 'latest', '2.1']) {
    expect(() => read([npm({ version })])).toThrow(/a range rather than one version/);
  }
  // A prerelease is one version, not a range.
  expect(read([node(), npm({ version: '0.2.0-rc.2' })])[1]?.version).toBe('0.2.0-rc.2');
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
  expect(file).toContain('tar "${how}" part -C /opt/ahpd/node');
  // A launcher for `node` would be a file that runs itself, so there is none.
  expect(file).not.toContain('bin/node');
  expect(file).toMatch(/FROM scratch\nCOPY --from=fetch \/opt\/ahpd\/node \/opt\/ahpd\/node$/);
});

it('builds an npm part on the node part, at the version the file pins', () => {
  const part = read([node(), npm()])[1] as Part;
  const file = dockerfileOf(part);

  // One Node serves them all, copied in rather than fetched a second time.
  expect(file).toContain(`COPY --from=${nodeTag()} /opt/ahpd/node /opt/ahpd/node`);
  expect(file).toContain('ENV PATH="/opt/ahpd/node/bin:${PATH}"');
  expect(file).toContain('npm install --prefix /opt/ahpd/codex');
  expect(file).toContain('@agentclientprotocol/codex-acp@2.1.1');
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
  const file = dockerfileOf(part);

  expect(file).toContain('@agentclientprotocol/claude-agent-acp@0.85.1 @anthropic-ai/claude-code@2.1.291');
  expect(file).not.toContain('claude-code@2.1.291@');
  // Each bin gets its launcher, the native `claude` included.
  expect(file).toContain('> /opt/ahpd/claude/bin/claude-agent-acp');
  expect(file).toContain('> /opt/ahpd/claude/bin/claude;');
  expect(tagOf(part)).toBe('ahpd-part/claude:0.85.1-2.1.291');
  // The tag the image is actually built at carries the Dockerfile too.
  expect(tagOf(part, undefined, file)).toMatch(/^ahpd-part\/claude:0\.85\.1-2\.1\.291-[0-9a-f]{12}$/u);

  expect(() => read([node(), npm({ packages: ['@anthropic-ai/claude-code@^2.1.291'] })]))
    .toThrow(/the package @anthropic-ai\/claude-code@\^2.1.291, whose version is a range/);
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
  })])[1] as Part;
  const file = dockerfileOf(part);

  expect(file).toContain(`COPY --from=${nodeTag()} /opt/ahpd/node /opt/ahpd/node`);
  expect(file).toContain('RUN npm install --prefix /opt/ahpd/amp --no-audit --no-fund --loglevel=error @ampcode/cli@0.0.1791273659-g33d612');
  // A bin npm installed is written from `node_modules/.bin`, and the rest found in the archive.
  expect(file).toContain('elif test -e /opt/ahpd/amp/node_modules/.bin/amp; then run=/opt/ahpd/amp/node_modules/.bin/amp;');
  expect(file).toContain('found=$(find /opt/ahpd/amp -name amp-acp');
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
  expect(dockerfileOf(one)).toContain(`'#!/bin/sh' 'export COPILOT_AUTO_UPDATE=false' > /opt/ahpd/copilot/bin/copilot`);
  expect(dockerfileOf(one)).not.toContain('ENV COPILOT_AUTO_UPDATE');
});

it('builds an archive part by downloading it, and finds its binary wherever it sits', () => {
  const one = read([archive({
    archives: {
      'linux-x64': { url: 'https://example.test/goose.tar.gz', sha256: 'ab'.repeat(32) },
      'linux-arm64': { url: 'https://example.test/goose-arm64.tar.bz2', sha256: 'cd'.repeat(32) },
    },
  })])[0] as Part;
  const file = dockerfileOf(one);

  expect(file).toContain('url=https://example.test/goose.tar.gz; sum=' + 'ab'.repeat(32));
  expect(file).toContain('url=https://example.test/goose-arm64.tar.bz2; sum=' + 'cd'.repeat(32));
  // bzip2 for the arm64 one, gzip for the other: `tar` is told per build.
  expect(file).toContain('how=-xjf;;');
  expect(file).toContain('how=-xzf;;');
  expect(file).toContain('tar "${how}" part -C /opt/ahpd/goose');
  // The publisher's own layout is the build's problem, not this file's: the
  // launcher holds the path the find found.
  expect(file).toContain("found=$(find /opt/ahpd/goose -name goose \\( -type f -o -type l \\) -perm -u+x");
  expect(file).toContain(`echo "the goose archive holds no goose to run" >&2`);
  // devin ships `bin/devin`, which is where its launcher goes, so an executable
  // already at that path is left alone rather than exec'd into itself.
  expect(file).toContain('if test -x /opt/ahpd/goose/bin/goose; then :; else found=$(find');
});

it('refuses an archive part whose file gives no download for a platform', () => {
  const one = read([archive()])[0] as Part;
  expect(() => dockerfileOf(one)).toThrow(/has no linux-arm64 download for goose/);
});

it('builds the ahpd part from npm with its own plugins inside it', () => {
  const part = read([node(), ahpd()])[1] as Part;
  const file = dockerfileOf(part, { from: 'npm', version: '0.8.0', hash: 'abcdef123456' });

  expect(file).toContain('@ahpd/sdk@0.8.0 @ahpd/server@0.8.0');
  // Decision `a-nested-host-image-installs-its-plugins-with-ahpd-plugin-install`:
  // the nested backends are installed by the command they will be run through.
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
  // No `ahpd plugin install` here: it names a package, and `isPackageName` in the
  // installer refuses a path - so a tarball has to go in by npm, into the root
  // the launcher will point the command at.
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
    // Two launchers, because a part may name more than one.
    [archive({ archives: both, bin: ['goose', 'goose-helper'] })],
  ] as const;
  const ahpdPart = read([node(), ahpd()])[1] as Part;

  const files = [
    ...cases.map((parts) => dockerfileOf(read([...parts])[parts.length - 1] as Part)),
    dockerfileOf(ahpdPart, { from: 'npm', version: '0.8.0', hash: 'abcdef123456' }),
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
