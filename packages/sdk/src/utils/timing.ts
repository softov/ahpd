import type { Bag } from '../types/common.js';

/**
 * How long a tool call ran, on the call's `_meta` under VS Code's key.
 *
 * The protocol gives a tool call no time of its own. VS Code's host puts the
 * milliseconds from a call's start to its completion on the call's `_meta` as
 * `vscode.toolCallDurationMs` when the call completes, and VS Code's client
 * draws the duration from that key. So the plugin that ran a call says it
 * there, at the call's completion: the harness's own measure where it has one,
 * and otherwise the span between the times the plugin held for the start and
 * the end.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/meta/vscode/agentToolCallMeta.ts#L26-L28
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L9866-L9868
 */
const DURATION = 'vscode.toolCallDurationMs';

/**
 * A time in epoch milliseconds, whether it was given as that or as an ISO
 * string, and nothing when it is neither.
 */
const epochOf = (at: unknown): number | undefined => {
  if (typeof at === 'number' && Number.isFinite(at)) return at;
  if (typeof at !== 'string') return undefined;
  const parsed = Date.parse(at);
  return Number.isNaN(parsed) ? undefined : parsed;
};

/**
 * The milliseconds from a call's start to its completion, as VS Code's
 * `getToolCallDurationMs` measures them: nothing where either time is unknown
 * or the completion comes before the start.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/meta/agentToolCallMeta.ts#L29-L33
 */
export function toolCallDurationMs(startedAt: number | string | undefined, completedAt: number | string | undefined): number | undefined {
  const from = epochOf(startedAt);
  const to = epochOf(completedAt);
  if (from === undefined || to === undefined || to < from) return undefined;
  return to - from;
}

/**
 * A completed call's bag with its duration merged in, so `toolKind` and the
 * reference's `subagent*` keys stay: an action carrying a `_meta` replaces the
 * call's whole bag. A duration nobody measured leaves the bag as it was.
 */
export function withToolCallDuration(meta: Bag | undefined, durationMs: number | undefined): Bag | undefined {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return meta;
  return { ...meta, [DURATION]: durationMs };
}
