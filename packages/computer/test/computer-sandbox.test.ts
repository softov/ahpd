import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { echo } from '../../../examples/echo/agent.js';
import { loadPlugins } from '../../server/src/plugins.js';
import {
  hostSandboxPlace, isSandboxSupported, sandboxedCommand, sandboxedServer, sandboxRunArgs, sandboxSecurityOptions, sandboxSettingsOf,
} from '../src/sandbox.js';
import { closeAll, keeping } from './support/closing.js';
import type { HostOptions } from '../../sdk/src/types/host.js';

/*
 * The sandbox as this plugin hosts it: the root `sandbox` property it
 * declares, a machine made to host the runtime and checked by its real Docker
 * settings, and a command and an MCP server started inside
 * `@vscode/sandbox-runtime` with a chat's settings.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/computer/src/index.ts';
const FIXTURE = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));

let loose: string | undefined;
afterEach(async () => {
  await closeAll();
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
});

const base = (): HostOptions => ({
  path: '/tmp/computer',
  agents: [{ ...echo({ path: '/tmp/computer', pace: 0 }), provider: 'base', displayName: 'Base backend' }],
});

const load = async (options: Record<string, unknown>) => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-computer-sandbox-'));
  const result = await loadPlugins([{ name: SOURCE, options }], { base: base(), configDir: loose, cwd: REPO, log: () => {} });
  keeping(result.options);
  return result;
};

it('declares the root sandbox property through a provider configuration, VS Code\'s own, and no other setting', async () => {
  const { options } = await load({ command: process.execPath, args: [FIXTURE], sessionSetting: false });
  const declared = options.providerConfigurations ?? [];
  expect(declared.map((one) => one.provider)).toEqual(['sandbox']);
  expect(Object.keys(declared[0]?.properties ?? {})).toEqual(['sandbox']);
  expect(declared[0]?.properties['sandbox']).toMatchObject({
    type: 'object',
    title: 'Agent Sandbox',
    properties: {
      enabled: { type: 'string', enum: ['off', 'on'] },
      sandboxMcpServers: { type: 'boolean' },
      'fileSystem.userConfiguredPaths': { type: 'object' },
      allowedNetworkDomains: { type: 'array' },
    },
  });
});

it('makes a machine for a sandboxed session to host the runtime, with VS Code\'s options, and one for any other session without them', async () => {
  const state = join(mkdtempSync(join(tmpdir(), 'ahpd-computer-sandbox-docker-')), 'docker.json');
  const { options } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
    profiles: { box: { image: 'node:22', disposable: true } },
  });
  const made = (): string[] => (JSON.parse(readFileSync(state, 'utf-8')) as { calls: string[][] })
    .calls.filter((one) => one[0] === 'run').at(-1) ?? [];
  await options.computers?.create?.({ source: 'disposable:box', session: 'ahp-session:/one', provider: 'base', sandbox: true });
  const sandboxed = made();
  for (const one of sandboxRunArgs) expect(sandboxed).toContain(one);
  expect(sandboxed.slice(sandboxed.indexOf('--device'), sandboxed.indexOf('--device') + 2)).toEqual(['--device', '/dev/net/tun']);
  await options.computers?.create?.({ source: 'disposable:box', session: 'ahp-session:/two', provider: 'base' });
  expect(made().includes('--security-opt')).toBe(false);
  rmSync(join(state, '..'), { recursive: true, force: true });
});

/*
 * Whether a container can host the runtime, read from its real Docker
 * settings: VS Code's own scenarios.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/test/node/devContainerSandbox.test.ts#L202-L234
 */
const supported = {
  AppArmorProfile: 'unconfined',
  HostConfig: {
    Privileged: false,
    SecurityOpt: [...sandboxSecurityOptions],
    MaskedPaths: [],
    ReadonlyPaths: [],
    Devices: [{ PathOnHost: '/dev/net/tun', PathInContainer: '/dev/net/tun', CgroupPermissions: 'rwm' }],
  },
};
const scenarios = [
  { name: 'all required options', container: supported, can: true },
  { name: 'colon-delimited security options', container: { ...supported, HostConfig: { ...supported.HostConfig, SecurityOpt: ['seccomp:unconfined'] } }, can: true },
  { name: 'host without AppArmor', container: { ...supported, AppArmorProfile: '' }, can: true },
  { name: 'default seccomp', container: { ...supported, HostConfig: { ...supported.HostConfig, SecurityOpt: null } }, can: false },
  { name: 'confined AppArmor', container: { ...supported, AppArmorProfile: 'docker-default' }, can: false },
  { name: 'masked proc paths', container: { ...supported, HostConfig: { ...supported.HostConfig, MaskedPaths: ['/proc/acpi'] } }, can: false },
  { name: 'read-only proc paths', container: { ...supported, HostConfig: { ...supported.HostConfig, ReadonlyPaths: ['/proc/sys'] } }, can: false },
  { name: 'missing TUN', container: { ...supported, HostConfig: { ...supported.HostConfig, Devices: null } }, can: false },
  { name: 'read-only TUN', container: { ...supported, HostConfig: { ...supported.HostConfig, Devices: [{ ...supported.HostConfig.Devices[0], CgroupPermissions: 'r' }] } }, can: false },
  { name: 'pre-existing privileged container', container: { ...supported, HostConfig: { ...supported.HostConfig, Privileged: true, SecurityOpt: null, Devices: null } }, can: true },
  { name: 'privileged container with explicit AppArmor confinement', container: { ...supported, AppArmorProfile: 'custom-confined', HostConfig: { ...supported.HostConfig, Privileged: true, SecurityOpt: null, Devices: null } }, can: false },
];

it('reads whether a container can host the sandbox runtime from its real Docker settings, as VS Code checks a dev container', () => {
  expect(scenarios.map((one) => [one.name, isSandboxSupported(JSON.stringify(one.container))]))
    .toEqual(scenarios.map((one) => [one.name, one.can]));
  expect(() => isSandboxSupported('{}')).toThrow('Invalid Docker sandbox configuration');
});

it('starts a command and an MCP server inside the runtime this plugin depends on, with the chat\'s settings', () => {
  const place = { ...hostSandboxPlace('ahp-chat:/one', '/tmp/ahpd-config'), home: '/home/me', platform: 'linux' as const };
  expect(place.srtPath?.endsWith(join('@vscode', 'sandbox-runtime', 'dist', 'cli.js'))).toBe(true);
  const settings = sandboxSettingsOf({
    enabled: 'on',
    allowedNetworkDomains: ['registry.npmjs.org'],
    'fileSystem.linux': { denyWrite: ['/work/.env'] },
  }, place, '/work', '/tmp/settings.json') as { network: unknown; filesystem: Record<string, string[]> };
  expect(settings.network).toEqual({ allowedDomains: ['registry.npmjs.org'], deniedDomains: [] });
  expect(settings.filesystem['allowWrite']).toEqual(['/work', place.tempDir]);
  expect(settings.filesystem['denyRead']).toEqual(['/tmp/settings.json', '/home/me']);
  expect(settings.filesystem['denyWrite']).toEqual(['/work/.env']);
  // The whole network allowed is no domain list at all.
  expect((sandboxSettingsOf({ enabled: 'on', allowNetwork: true }, place, '/work', '/tmp/s.json') as { network: unknown }).network)
    .toEqual({ allowedDomains: [], deniedDomains: [], enabled: false });

  const command = sandboxedCommand(place, '/tmp/settings.json', { command: 'ls', args: ['-la', 'a b'], cwd: '/work' }, false);
  expect(command).toMatchObject({
    command: process.execPath,
    args: [place.srtPath, '--settings', '/tmp/settings.json', '-c', 'cd \'/work\' && \'ls\' \'-la\' \'a b\''],
    env: { TMPDIR: place.tempDir, CLAUDE_TMPDIR: place.tempDir },
    cwd: place.tempDir,
  });
  // A command the person let leave the sandbox runs outside it.
  expect(sandboxedCommand(place, '/tmp/settings.json', { command: 'ls', cwd: '/work' }, true))
    .toMatchObject({ command: 'sh', args: ['-c', 'cd \'/work\' && \'ls\''] });

  const server = sandboxedServer(place, '/tmp/settings.json', { command: 'npx', args: ['-y', 'server'] });
  expect(server).toMatchObject({
    command: process.execPath,
    args: [place.srtPath, '--settings', '/tmp/settings.json', '--', '\'npx\'', '\'-y\'', '\'server\''],
    env: { TMPDIR: place.tempDir, NODE_USE_ENV_PROXY: '1' },
  });
});
