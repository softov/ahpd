import { expect, it } from 'vitest';
import {
  readChatSandboxState, readSessionSandboxPolicy, resolveSandboxEnabled, sandboxResolution, sessionSandboxConfig,
  withChatSandboxState, withSessionSandboxPolicy,
} from '../src/sandbox.js';

/*
 * A chat's sandbox resolved as VS Code's agent host resolves one. The first
 * cases are VS Code's own, for its `SandboxSettingsResolutionHelper`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/sandbox/test/common/sandboxSettingsResolutionHelper.test.ts#L14-L124
 */

it('forces enablement only by a managed true', () => {
  for (const local of [undefined, 'off', 'on'] as const) {
    expect([undefined, false, true].map((managed) => sandboxResolution.resolveEnabled(local, managed))).toEqual([local, local, 'on']);
  }
});

it('denies access by a managed false and never widens a local restriction', () => {
  for (const local of [undefined, false, true]) {
    expect([undefined, false, true].map((managed) => sandboxResolution.resolveAllowAccess(local, managed))).toEqual([local, false, local]);
  }
});

it('takes a managed allow list over the local one, an empty managed list included, and joins the block lists', () => {
  expect([
    sandboxResolution.resolveNetworkHosts(undefined, undefined, undefined, undefined),
    sandboxResolution.resolveNetworkHosts([], [], [], []),
    sandboxResolution.resolveNetworkHosts(undefined, undefined, ['example.com'], ['malicious.com']),
    sandboxResolution.resolveNetworkHosts(['example.com'], ['malicious.com'], undefined, undefined),
    sandboxResolution.resolveNetworkHosts(['example.com'], ['malicious.com'], [], []),
  ]).toEqual([
    { allowedHosts: [], blockedHosts: [] },
    { allowedHosts: [], blockedHosts: [] },
    { allowedHosts: ['example.com'], blockedHosts: ['malicious.com'] },
    { allowedHosts: ['example.com'], blockedHosts: ['malicious.com'] },
    { allowedHosts: [], blockedHosts: ['malicious.com'] },
  ]);
});

it('takes managed path grants and joins the denied paths', () => {
  expect(sandboxResolution.resolveFileSystemPaths(
    { readwritePaths: ['/local-write'], readonlyPaths: ['/local-read'], deniedPaths: ['/local-denied', '/shared-denied'] },
    { readwritePaths: ['/managed-write', '/managed-write'], readonlyPaths: [], deniedPaths: ['/shared-denied', '/managed-denied'] },
  )).toEqual({
    readwritePaths: ['/managed-write'],
    readonlyPaths: [],
    deniedPaths: ['/local-denied', '/shared-denied', '/managed-denied'],
  });
});

it('allows bypass under a forced sandbox only by a managed true, never widening the local choice', () => {
  for (const local of [undefined, false, true]) {
    for (const enabled of [undefined, false, true]) {
      expect([undefined, false, true].map((managed) => sandboxResolution.resolveAllowBypass(local, managed, enabled)))
        .toEqual([enabled === true ? false : local, false, local]);
    }
  }
});

/*
 * A chat's selection within its floor: a floor that requires the sandbox
 * keeps it on whatever the chat selects, unless the floor allows bypass and
 * an off was applied, as VS Code's `resolveSandboxEnabled` reads it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionSandbox.ts#L98-L110
 */
it('keeps the sandbox on under a floor that requires it, unless an applied off is authorized by bypass', () => {
  expect(resolveSandboxEnabled('off', undefined, undefined)).toBe('off');
  expect(resolveSandboxEnabled('default', undefined, undefined)).toBeUndefined();
  expect(resolveSandboxEnabled('off', { enabled: true }, undefined)).toBe('on');
  expect(resolveSandboxEnabled('default', { enabled: true }, undefined)).toBe('on');
  expect(resolveSandboxEnabled('off', { enabled: true, allowBypass: true }, false)).toBe('off');
  expect(resolveSandboxEnabled('off', { enabled: true, allowBypass: true }, true)).toBe('on');
});

it('resolves a chat\'s sandbox from the root settings, its selection over them, within the floor', () => {
  const root = {
    enabled: 'off' as const,
    allowNetwork: true,
    allowedNetworkDomains: ['local.example'],
    deniedNetworkDomains: ['local.blocked'],
    'fileSystem.linux': { allowWrite: ['/a/b'], denyRead: ['/secret'] },
  };
  // The chat's selection over the root's.
  expect(sessionSandboxConfig(root, 'on', undefined, undefined, 'linux')).toMatchObject({ enabled: 'on', allowNetwork: true });
  // The floor over both: the sandbox on, the network and bypass taken away,
  // the managed allow list taking the local one's place and the blocks joined.
  const resolved = sessionSandboxConfig(root, 'off', {
    enabled: true, allowOutbound: false, allowedHosts: ['managed.example'], blockedHosts: ['managed.blocked'],
  }, undefined, 'linux');
  expect(resolved).toMatchObject({
    enabled: 'on',
    allowNetwork: false,
    allowUnsandboxedCommands: false,
    allowedNetworkDomains: ['managed.example'],
    deniedNetworkDomains: ['local.blocked', 'managed.blocked'],
  });
  // And each path the executing OS's: a Windows host writes its own separators.
  expect(sessionSandboxConfig({ 'fileSystem.windows': { allowWrite: ['C:/work'] } }, 'on', undefined, undefined, 'win32')['fileSystem.windows'])
    .toEqual({ allowWrite: ['C:\\work'] });
});

it('reads back the floor and a chat\'s state it writes into a session\'s _meta, and drops the older host\'s slot', () => {
  const meta = withSessionSandboxPolicy({ 'vscode.sandboxPolicy': { enabled: true }, other: 1 }, { enabled: true, failClosed: true });
  expect(meta).toEqual({ other: 1, 'vscode.resolvedSandboxPolicy': { enabled: true, failClosed: true } });
  expect(readSessionSandboxPolicy({ _meta: meta })).toEqual({ enabled: true, failClosed: true });
  const stated = withChatSandboxState(meta, 'ahp-chat:/one', { enabled: false, rejectedSelection: true, error: { clientId: 'c', clientSeq: 2, message: 'no' } });
  expect(readChatSandboxState({ _meta: stated }, 'ahp-chat:/one')).toEqual({ enabled: false, rejectedSelection: true, error: { clientId: 'c', clientSeq: 2, message: 'no' } });
  // An error with client attribution and no enablement is malformed, and absent.
  expect(readChatSandboxState({ _meta: withChatSandboxState({}, 'x', { error: { clientId: 'c', clientSeq: 1, message: 'no' } }) }, 'x')).toBeUndefined();
});
