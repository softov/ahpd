import { expect, it } from 'vitest';
import { toolCallDurationMs, withToolCallDuration } from '../src/utils/timing.js';

/*
 * How long a tool call ran, on the call's `_meta` under VS Code's key.
 *
 * VS Code's host puts the milliseconds from a call's start to its completion
 * on the call's `_meta` as `vscode.toolCallDurationMs` when the call completes,
 * and VS Code's client draws the duration from that key. An action carrying a
 * `_meta` replaces the call's whole bag, which is why the duration is merged
 * into what a call already has.
 */

const START = Date.UTC(2026, 8, 29, 12, 0, 0);

it('measures a call from its start to its completion, as VS Code does', () => {
  expect(toolCallDurationMs(START, START + 1500)).toBe(1500);
  expect(toolCallDurationMs('2026-09-29T12:00:00.000Z', '2026-09-29T12:00:01.500Z')).toBe(1500);
  expect(toolCallDurationMs(START, '2026-09-29T12:00:00.250Z')).toBe(250);
});

it('measures nothing when a time is unknown or the completion comes first', () => {
  expect(toolCallDurationMs(undefined, START)).toBeUndefined();
  expect(toolCallDurationMs(START, undefined)).toBeUndefined();
  expect(toolCallDurationMs(START, START - 40)).toBeUndefined();
  expect(toolCallDurationMs('not a time', START)).toBeUndefined();
});

it('says the duration on the key VS Code reads, keeping the keys the bag had', () => {
  expect(withToolCallDuration({ toolKind: 'terminal', subagentChatUri: 'ahp-chat://default/d29ya2Vy' }, 17)).toEqual({
    toolKind: 'terminal',
    subagentChatUri: 'ahp-chat://default/d29ya2Vy',
    'vscode.toolCallDurationMs': 17,
  });
  expect(withToolCallDuration(undefined, 0)).toEqual({ 'vscode.toolCallDurationMs': 0 });
});

it('leaves the bag as it was for a duration nobody measured', () => {
  expect(withToolCallDuration({ toolKind: 'terminal' }, undefined)).toEqual({ toolKind: 'terminal' });
  expect(withToolCallDuration(undefined, undefined)).toBeUndefined();
  expect(withToolCallDuration(undefined, -1)).toBeUndefined();
});
