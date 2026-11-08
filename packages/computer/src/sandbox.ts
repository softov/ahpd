import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import type { ProviderConfiguration, SandboxConfigValue, Spawn, SpawnOptions } from '@ahpd/sdk';

/*
 * The agent sandbox as this plugin hosts it: the root `sandbox` property it
 * declares, how a machine is made to host the sandbox runtime and checked,
 * and how a command and an MCP server are started inside
 * `@vscode/sandbox-runtime`, the runtime VS Code's terminal sandbox runs.
 */

/**
 * VS Code's root `sandbox` property, by its own schema: one object of
 * prefix-free keys, which VS Code's window forwards only to a host whose root
 * config declares it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/sandboxConfigSchema.ts#L71-L184
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/agentHostSandboxForwarder.ts#L118-L136
 */
export const SANDBOX_PROPERTY = {
  type: 'object',
  title: 'Agent Sandbox',
  properties: {
    enabled: { type: 'string', title: 'Sandbox Enabled', enum: ['off', 'on'] },
    allowNetwork: { type: 'boolean', title: 'Allow Network' },
    allowLocalNetwork: { type: 'boolean', title: 'Allow Local Network' },
    allowUnsandboxedCommands: { type: 'boolean', title: 'Allow Unsandboxed Commands' },
    sandboxMcpServers: { type: 'boolean', title: 'Sandbox MCP Servers' },
    sandboxLspServers: { type: 'boolean', title: 'Sandbox LSP Servers' },
    authenticateGit: { type: 'boolean', title: 'Authenticate git' },
    authenticateGh: { type: 'boolean', title: 'Authenticate gh' },
    credentials: {
      type: 'object',
      title: 'Masked environment variables',
      properties: {
        envVars: {
          type: 'object',
          title: 'Environment Variables',
          description: 'Maps environment variable names to objects with an injectHosts array of HTTPS destinations. Credential entries are validated by the runtime.',
        },
      },
    },
    allowDevToolAccess: { type: 'boolean', title: 'Allow Dev Tool Access' },
    addCurrentWorkingDirectory: { type: 'boolean', title: 'Add Current Working Directory' },
    'fileSystem.linux': { type: 'object', title: 'Linux Sandbox Filesystem' },
    'fileSystem.userConfiguredPaths': {
      type: 'object',
      title: 'User-Configured Paths',
      properties: {
        readwritePaths: { type: 'array', title: 'Read/Write', items: { type: 'string', title: 'Path' } },
        readonlyPaths: { type: 'array', title: 'Read-Only', items: { type: 'string', title: 'Path' } },
        deniedPaths: { type: 'array', title: 'Denied', items: { type: 'string', title: 'Path' } },
      },
    },
    'fileSystem.mac': { type: 'object', title: 'macOS Sandbox Filesystem' },
    'fileSystem.windows': { type: 'object', title: 'Windows Sandbox Filesystem' },
    'advanced.runtime': { type: 'object', title: 'Advanced Sandbox Runtime' },
    allowedNetworkDomains: { type: 'array', title: 'Allowed Network Domains', items: { type: 'string', title: 'Domain' } },
    deniedNetworkDomains: { type: 'array', title: 'Denied Network Domains', items: { type: 'string', title: 'Domain' } },
  },
} as const;

/**
 * The plugin's provider configuration: the root `sandbox` property and the
 * entry a client draws its page from, the one sandbox setting the plugin
 * declares. A chat's switch is the SDK's `SANDBOX_ENABLED_PROPERTY`, which a
 * backend whose commands start through `Start.computers.sandboxed` declares.
 */
export const sandboxConfiguration: ProviderConfiguration = {
  provider: 'sandbox',
  title: 'Agent Sandbox',
  description: 'The sandbox an agent\'s commands and MCP servers run in, wherever its session runs.',
  settings: [{ key: 'sandbox', group: 'Agent Sandbox' }],
  properties: { sandbox: SANDBOX_PROPERTY },
};

/**
 * What a container needs to host the sandbox runtime, VS Code's dev container
 * options: seccomp, AppArmor and the system paths unconfined, and a tun device.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/devContainerSandbox.ts#L15-L16
 */
export const sandboxSecurityOptions = ['seccomp=unconfined', 'apparmor=unconfined', 'systempaths=unconfined'] as const;
export const sandboxRunArgs = [...sandboxSecurityOptions.flatMap((option) => ['--security-opt', option]), '--device', '/dev/net/tun'];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((one) => typeof one === 'string');

/**
 * Whether a container can host the sandbox runtime, read from its real Docker
 * settings, which a container made earlier holds whatever it is asked for
 * now: privileged, or seccomp unconfined with nothing masked or read-only and
 * the tun device readable and writable, and AppArmor unconfined either way.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/devContainerSandbox.ts#L154-L185
 */
export const isSandboxSupported = (output: string): boolean => {
  const container: unknown = JSON.parse(output);
  if (!isObject(container) || !isObject(container['HostConfig'])) throw new Error('Invalid Docker sandbox configuration');
  const host = { ...container['HostConfig'] };
  for (const key of ['SecurityOpt', 'MaskedPaths', 'ReadonlyPaths', 'Devices']) {
    if (host[key] === null) host[key] = [];
  }
  const devices = host['Devices'];
  if (typeof container['AppArmorProfile'] !== 'string' || typeof host['Privileged'] !== 'boolean'
    || !isStrings(host['SecurityOpt']) || !isStrings(host['MaskedPaths']) || !isStrings(host['ReadonlyPaths'])
    || !Array.isArray(devices) || !devices.every((one) => isObject(one) && typeof one['PathOnHost'] === 'string'
      && typeof one['PathInContainer'] === 'string' && typeof one['CgroupPermissions'] === 'string')) {
    throw new Error('Invalid Docker sandbox configuration');
  }
  const profile = container['AppArmorProfile'];
  if (profile !== '' && profile !== 'unconfined') return false;
  if (host['Privileged'] === true) return true;
  const options = host['SecurityOpt'].map((option) => option.replace(':', '='));
  return options.includes('seccomp=unconfined')
    && host['MaskedPaths'].length === 0
    && host['ReadonlyPaths'].length === 0
    && (devices as Record<string, string>[]).some((device) => device['PathOnHost'] === '/dev/net/tun'
      && device['PathInContainer'] === '/dev/net/tun'
      && device['CgroupPermissions']?.includes('r') === true
      && device['CgroupPermissions'].includes('w'));
};

/** Where the sandbox runtime runs: its program, the CLI, the home it denies, and the folder its settings and sockets go in. */
export interface SandboxPlace {
  /** The Node the CLI runs on. */
  execPath: string;
  /** The runtime's CLI, `dist/cli.js` of `@vscode/sandbox-runtime`, or `srt` where it is on the `PATH`. */
  srtPath?: string;
  /** The folder holding the runtime's package, which a sandboxed command reads. */
  appRoot?: string;
  /** The user's home, which a sandboxed command does not read. */
  home?: string;
  /** The folder the runtime's settings and its sockets go in. */
  tempDir: string;
  /** The OS the runtime runs on. */
  platform: NodeJS.Platform;
}

/** This host's runtime: the package this plugin depends on, run with this daemon's Node. */
export const hostSandboxPlace = (scope: string, configDir: string): SandboxPlace => {
  const appRoot = dirname(createRequire(import.meta.url).resolve('@vscode/sandbox-runtime/package.json'));
  return {
    execPath: process.execPath,
    srtPath: join(appRoot, 'dist', 'cli.js'),
    appRoot,
    home: homedir(),
    tempDir: sandboxTempDir(configDir, scope),
    platform: process.platform,
  };
};

/**
 * The folder one chat's sandbox keeps its settings and sockets in: short and
 * bounded, because the runtime makes its network bridge's sockets directly in
 * it and a socket's path holds 108 bytes at most.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/agentHostSandboxEngine.ts#L79-L95
 */
export const sandboxTempDir = (root: string, scope: string): string =>
  join(root, 'tmp', `agenthost_${createHash('sha256').update(scope).digest('hex').substring(0, 16)}`);

/** Shell quoting, so a wrapped command cannot break out of the line it is put in. */
const quoted = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * The runtime's settings for one chat's sandbox, as VS Code's terminal
 * sandbox engine writes them: writes allowed in the working folder and the
 * sandbox's own folder, reads allowed there and in the runtime's own files,
 * the user's home and the settings file denied, the platform's filesystem
 * lists, the network's domains unless the network is allowed whole, and the
 * advanced runtime settings over all of it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/sandbox/common/terminalSandboxEngine.ts#L623-L679
 */
export const sandboxSettingsOf = (sandbox: SandboxConfigValue, place: SandboxPlace, cwd: string | undefined, configPath: string): Record<string, unknown> => {
  const fileSystem = place.platform === 'darwin' ? sandbox['fileSystem.mac'] ?? {}
    : place.platform === 'linux' ? sandbox['fileSystem.linux'] ?? {} : {};
  const unique = (paths: (string | undefined)[]): string[] => [...new Set(paths.filter((one): one is string => one !== undefined))];
  const expand = (path: string): string => (place.platform === 'linux' && place.home !== undefined
    ? path === '~' ? place.home : path.startsWith('~/') ? posix.join(place.home, path.slice(2)) : path
    : path);
  const runtimeReads = place.appRoot === undefined ? [] : [place.appRoot, place.execPath, dirname(place.execPath)];
  const allowWrite = unique([cwd, place.tempDir, ...(fileSystem.allowWrite ?? []).map(expand)]).filter((one) => one !== configPath);
  const allowRead = unique([...(fileSystem.allowRead ?? []).map(expand), ...runtimeReads, ...allowWrite]);
  const denyRead = unique([...(fileSystem.denyRead ?? []).map(expand), configPath, place.platform === 'win32' ? undefined : place.home]);
  const denyWrite = fileSystem.denyWrite === undefined ? undefined : unique(fileSystem.denyWrite.map(expand));
  const settings: Record<string, unknown> = {
    network: sandbox.allowNetwork === true
      ? { allowedDomains: [], deniedDomains: [], enabled: false }
      : { allowedDomains: sandbox.allowedNetworkDomains ?? [], deniedDomains: sandbox.deniedNetworkDomains ?? [] },
    filesystem: { denyRead, allowRead, allowWrite, ...(denyWrite === undefined ? {} : { denyWrite }) },
  };
  const merge = (target: Record<string, unknown>, added: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(added)) {
      const held = target[key];
      if (!Object.hasOwn(target, key)) target[key] = value;
      else if (isObject(held) && isObject(value)) merge(held, value);
    }
  };
  merge(settings, sandbox['advanced.runtime'] ?? {});
  if (place.platform === 'darwin') settings['allowPty'] ??= true;
  return settings;
};

/** The settings file a sandboxed start reads, written owner-only into the sandbox's folder. */
export const writeSandboxSettings = (place: SandboxPlace, settings: (configPath: string) => Record<string, unknown>): string => {
  mkdirSync(place.tempDir, { recursive: true, mode: 0o700 });
  const configPath = join(place.tempDir, `vscode-sandbox-settings-${randomUUID()}.json`);
  writeFileSync(configPath, JSON.stringify(settings(configPath), null, '\t'), { mode: 0o600 });
  return configPath;
};

/**
 * A command run inside the runtime, as VS Code's terminal sandbox wraps one:
 * the runtime started from its own folder with its settings, the command's
 * folder kept on Linux by a `cd` inside, and `TMPDIR` the sandbox's folder.
 * A command the person let leave the sandbox, where the settings allow
 * unsandboxed commands, runs outside it with `TMPDIR` still the sandbox's.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/sandbox/common/terminalSandboxEngine.ts#L198-L290
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/sandbox/common/terminalSandboxEngine.ts#L451-L481
 */
export const sandboxedCommand = (place: SandboxPlace, configPath: string, options: SpawnOptions, unsandboxed: boolean): Spawn => {
  const line = [options.command, ...(options.args ?? [])].map(quoted).join(' ');
  const inFolder = place.platform === 'linux' && options.cwd !== undefined && options.cwd !== place.tempDir
    ? `cd ${quoted(options.cwd)} && ${line}`
    : line;
  const env = { ...options.env, TMPDIR: place.tempDir, CLAUDE_TMPDIR: place.tempDir };
  if (unsandboxed) {
    return { command: 'sh', args: ['-c', inFolder], env, ...(options.cwd === undefined ? {} : { cwd: options.cwd }) };
  }
  const runtime = runtimeOf(place);
  return {
    command: runtime.command,
    args: [...runtime.args, '--settings', configPath, '-c', inFolder],
    env,
    cwd: place.platform === 'linux' ? place.tempDir : options.cwd ?? place.tempDir,
  };
};

/** The runtime's CLI as a program and its first arguments: this host's run with its Node, a machine's `srt` from its `PATH`. */
const runtimeOf = (place: SandboxPlace): { command: string; args: string[] } =>
  (place.srtPath === undefined ? { command: 'srt', args: [] } : { command: place.execPath, args: [place.srtPath] });

/**
 * An MCP server started inside the runtime, as VS Code's MCP sandbox starts
 * one: the runtime given the settings and, after `--`, the server's own
 * command and arguments, with `TMPDIR` the sandbox's folder and Node's own
 * fetch told to take the runtime's proxy.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/workbench/contrib/mcp/common/mcpSandboxService.ts#L108-L150
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/workbench/contrib/mcp/common/mcpSandboxService.ts#L321-L346
 */
export const sandboxedServer = (place: SandboxPlace, configPath: string, options: SpawnOptions): Spawn => {
  const runtime = runtimeOf(place);
  return {
    command: runtime.command,
    args: [...runtime.args, '--settings', configPath, '--', quoted(options.command), ...(options.args ?? []).map(quoted)],
    env: { ...options.env, TMPDIR: place.tempDir, SRT_DEBUG: 'true', NODE_USE_ENV_PROXY: '1' },
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  };
};

/**
 * Why this host cannot run the sandbox runtime, or nothing when it can: the
 * runtime's own dependency check, in its words, and on Linux VS Code's check
 * that bubblewrap can make the namespace the sandbox needs, in VS Code's.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/sandbox/node/sandboxHelper.ts#L96-L113
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/tools/runInTerminalTool.ts#L1001-L1005
 */
export const hostSandboxRefusal = async (): Promise<string | undefined> => {
  const { SandboxManager } = await import('@vscode/sandbox-runtime');
  const { errors } = SandboxManager.checkDependencies();
  if (errors.length > 0) return `Sandbox dependencies not available: ${errors.join(', ')}`;
  if (process.platform !== 'linux') return undefined;
  const usable = await new Promise<boolean>((done) => {
    execFile('bwrap', ['--unshare-net', '--dev-bind', '/', '/', 'echo', 'ok'], { encoding: 'utf8', timeout: 5000 }, (error, stdout) => {
      done(error === null && stdout.trim() === 'ok');
    });
  });
  return usable ? undefined : 'Bubblewrap is installed but cannot create the required sandbox namespace on this system.';
};

/**
 * The check a machine is asked, run inside it by `sh -c`: the runtime's own
 * start with a command that does nothing, which checks the runtime's
 * dependencies and runs the command under bubblewrap, so what stops the
 * sandbox there is printed in the runtime's own words. Where it runs, the
 * machine's home is printed, which a sandboxed command there does not read.
 */
export const MACHINE_SANDBOX_CHECK = 'out=$(srt -c true 2>&1) || { printf "%s\\n" "$out"; exit 1; }; printf "%s" "$HOME"';

/**
 * How a sandboxed start runs inside a machine, by `sh -c` with the sandbox's
 * folder, its settings and the start itself as arguments: the folder made
 * owner-only, the settings written into it, and the start run from it.
 */
export const MACHINE_SANDBOX_START = 'umask 077; mkdir -p "$1" && printf "%s" "$2" > "$1/settings.json" && cd "$1" && shift 2 && exec "$@"';
