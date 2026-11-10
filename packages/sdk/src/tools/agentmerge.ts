import type { AgentMergeCIRequest, AgentMergeOverridesInput, AgentMergeToolAccessor, HostTool, ToolCall } from '../types/host.js';

/**
 * The four tools Agent Merge is given, under VS Code's names and text.
 *
 * Every name, title, description, schema and refusal below is
 * `agentMergeServerTools.ts` at 171e90619, word for word, so a skill written
 * against the reference host works here. What the group does not have is the
 * controller's evidence machinery: the work is in `host/agentmerge.ts`, which
 * holds the repair turn's authorization, and this file is the model's door to
 * it. The last three are only answered inside a turn Agent Merge started.
 * https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/shared/agentMergeServerTools.ts
 */

export const setAgentMergeEnabledToolName = 'setAgentMergeEnabled';
export const readAgentMergeCIToolName = 'readAgentMergeCI';
export const replyToAgentMergeReviewThreadToolName = 'replyToAgentMergeReviewThread';
export const rerunAgentMergeWorkflowToolName = 'rerunAgentMergeWorkflow';

const MERGE_PULL_REQUEST_VALUES = ['always', 'ifUnchanged', 'never'] as const;

/** What the four tools are, as the model and a client's row read them. */
const definitions = [
  {
    name: setAgentMergeEnabledToolName,
    title: 'Configure Agent Merge',
    description: 'Enable, disable, or configure Agent Merge for the current chat\'s folder when the user asks to start, stop, or configure Agent Merge, keep a pull request green, or merge it when ready. Not for one-off pull request inspection or repair. This does not change the global Agent Merge setting or GitHub auto-merge. Enablement and supplied options persist for this folder within the session; other folders are unchanged. Only change options the user requests. Enabling monitoring alone does not enable automatic merging: for an explicit "merge when green" request, set mergePullRequest to "always", or "ifUnchanged" if the user wants to review agent-made changes first. Use the returned effective configuration when explaining what will happen. Initial enablement captures the current Git branch and returns target.branchName; autonomous work starts after the current turn ends. Calling again updates the configuration even when already enabled without changing the target; omitted options stay unchanged. The current tool-approval policy applies.',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'Whether Agent Merge should monitor and act on the pull request for this chat\'s folder. Pass true to update options while keeping it enabled.' },
        addressReviews: { type: 'boolean', description: 'Whether to address new pull request review comments. Omit to preserve the current option.' },
        fixCI: { type: 'boolean', description: 'Whether to fix failing CI checks. Omit to preserve the current option.' },
        resolveConflicts: { type: 'boolean', description: 'Whether to resolve merge conflicts and update a behind branch. Omit to preserve the current option.' },
        mergePullRequest: { type: 'string', enum: [...MERGE_PULL_REQUEST_VALUES], description: 'When to merge automatically once ready: always, only while unchanged by Agent Merge, or never. Omit to preserve the current option.' },
      },
      required: ['enabled'] as string[],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: readAgentMergeCIToolName,
    title: 'Read Agent Merge CI',
    description: 'Read CI diagnostics for failed required checks authorized for the active Agent Merge turn. Defaults to a bounded summary of checks, annotations, jobs, failed steps, and failure excerpts. Use a returned evidenceId for a line-numbered tail, range, or literal search with context; pass a returned cursor alone to continue. Responses are capped at 48 KB and job downloads at 16 MiB/30 seconds. Summary pages also respect cache capacity; inspect a page before continuing. Cached evidence expires five minutes after its last summary or on eviction; use summary with jobId to reacquire just that job. Evidence is scoped to this turn, pull request head, workflow attempt, and job. A tail is the real end only when complete is true; a download limit is terminal, not evidence that the unseen log succeeded. Concurrent reads are queued, with waiting included in the three-minute call limit. Follow the returned operations rather than repeating the summary or using other GitHub tools.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['summary', 'tail', 'range', 'search'], description: 'Diagnostic operation. Defaults to summary.' },
        evidenceId: { type: 'string', description: 'Host-owned job evidence ID returned by a summary.' },
        jobId: { type: 'string', description: 'Select one authorized failed job in summary mode, including to reacquire expired or evicted evidence.' },
        cursor: { type: 'string', description: 'Continuation returned by this tool. Pass alone; expired or stale cursors fail explicitly.' },
        startLine: { type: 'integer', minimum: 1, description: 'First line for range or search, inclusive. Defaults to 1.' },
        startColumn: { type: 'integer', minimum: 1, description: 'First column of a range, for continuing a long line. Defaults to 1.' },
        endLine: { type: 'integer', minimum: 1, description: 'Last range line, inclusive. At most 200 lines per requested range.' },
        lineCount: { type: 'integer', minimum: 1, maximum: 200, description: 'Number of tail lines. Defaults to 100; response budget may return fewer.' },
        query: { type: 'string', minLength: 1, maxLength: 200, description: 'Case-insensitive literal search text, not a regular expression.' },
        contextLines: { type: 'integer', minimum: 0, maximum: 5, description: 'Lines surrounding each search match. Defaults to 2.' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: replyToAgentMergeReviewThreadToolName,
    title: 'Reply to Agent Merge Review Thread',
    description: 'Reply to an unresolved review thread authorized for the active Agent Merge turn and optionally resolve it only after publication is confirmed. A reply added to an existing pending review remains unpublished and the thread is not resolved. A pending reply stops this folder\'s monitoring when the turn ends; the user must explicitly re-enable Agent Merge to resume. Do not retry a pending or indeterminate reply, or submit, discard, or replace the user\'s pending review; ask the user how to proceed.',
    inputSchema: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'GraphQL node ID of an authorized unresolved review thread.' },
        body: { type: 'string', description: 'Concise reply describing how the feedback was addressed.' },
        resolve: { type: 'boolean', description: 'Whether to resolve the thread after confirming the reply is published. Defaults to true.' },
      },
      required: ['threadId', 'body'] as string[],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: rerunAgentMergeWorkflowToolName,
    title: 'Rerun Agent Merge Workflow',
    description: 'Rerun a GitHub Actions workflow associated with a failed required check in the active Agent Merge turn. If its current attempt is still running, Agent Merge defers the rerun until it finishes, provided CI repair remains enabled and the pull request head is unchanged. Continue other actionable work; do not poll or repeat a deferred request.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'GitHub Actions workflow run ID.' },
        failedJobsOnly: { type: 'boolean', description: 'Whether to rerun only failed jobs. Defaults to true.' },
      },
      required: ['runId'] as string[],
    },
    annotations: { readOnlyHint: false },
  },
] as const;

/** The four tools, as this host contributes them. */
export const agentMergeTools = (): HostTool[] => definitions.map((definition): HostTool => ({
  definition,
  deferLoading: true,
  run: async (input: Record<string, unknown>, at: ToolCall): Promise<string> => {
    const accessor = accessorAt(at);
    switch (definition.name) {
      case setAgentMergeEnabledToolName: {
        const args = asRecord(input, definition.name);
        if (Object.keys(args).some((key) => !['enabled', 'addressReviews', 'fixCI', 'resolveConflicts', 'mergePullRequest'].includes(key))) {
          throw new Error(`Invalid ${definition.name} input: unsupported configuration option.`);
        }
        const mergePullRequest = args.mergePullRequest;
        if (mergePullRequest !== undefined && !isMergePullRequest(mergePullRequest)) {
          throw new Error(`Invalid ${definition.name} input: mergePullRequest must be always, ifUnchanged, or never.`);
        }
        const overrides: AgentMergeOverridesInput = {
          ...(args.addressReviews !== undefined ? { addressReviews: requiredBoolean(args.addressReviews, 'addressReviews', definition.name) } : {}),
          ...(args.fixCI !== undefined ? { fixCI: requiredBoolean(args.fixCI, 'fixCI', definition.name) } : {}),
          ...(args.resolveConflicts !== undefined ? { resolveConflicts: requiredBoolean(args.resolveConflicts, 'resolveConflicts', definition.name) } : {}),
          ...(mergePullRequest !== undefined ? { mergePullRequest } : {}),
        };
        return await accessor.setEnabled(requiredBoolean(args.enabled, 'enabled', definition.name), overrides);
      }
      case readAgentMergeCIToolName:
        return await accessor.readFailedCI(parseAgentMergeCIRequest(input));
      case replyToAgentMergeReviewThreadToolName: {
        const args = asRecord(input, definition.name);
        return await accessor.replyToReviewThread(
          requiredString(args.threadId, 'threadId', definition.name),
          requiredString(args.body, 'body', definition.name),
          optionalBoolean(args.resolve, 'resolve', definition.name) ?? true,
        );
      }
      case rerunAgentMergeWorkflowToolName: {
        const args = asRecord(input, definition.name);
        return await accessor.rerunFailedWorkflow(
          requiredString(args.runId, 'runId', definition.name),
          optionalBoolean(args.failedJobsOnly, 'failedJobsOnly', definition.name) ?? true,
        );
      }
      default:
        throw new Error('Unknown Agent Merge server tool.');
    }
  },
}));

/** The accessor for the chat the call came from, or VS Code's refusal when the host has none. */
const accessorAt = (at: ToolCall): AgentMergeToolAccessor => {
  const accessor = at.agentMerge?.();
  if (accessor === undefined) throw new Error('Agent Merge tools are not available without an Agent Merge controller.');
  return accessor;
};

/** `parseAgentMergeCIRequest`, with each mode's fields the only ones it takes. */
export const parseAgentMergeCIRequest = (value: unknown): AgentMergeCIRequest => {
  const args = asRecord(value, readAgentMergeCIToolName);
  const mode = args.mode ?? 'summary';
  const fields = args.cursor !== undefined ? ['cursor']
    : mode === 'summary' ? ['mode', 'jobId']
      : mode === 'tail' ? ['mode', 'evidenceId', 'lineCount']
        : mode === 'range' ? ['mode', 'evidenceId', 'startLine', 'startColumn', 'endLine']
          : mode === 'search' ? ['mode', 'evidenceId', 'query', 'startLine', 'contextLines'] : undefined;
  if (fields === undefined || Object.keys(args).some((key) => !fields.includes(key))) {
    throw new Error('Invalid readAgentMergeCI input: unsupported fields or mode. Pass a cursor alone.');
  }
  if (args.cursor !== undefined) return { cursor: requiredString(args.cursor, 'cursor', readAgentMergeCIToolName) };
  if (mode === 'summary') {
    return { mode, ...(args.jobId !== undefined ? { jobId: requiredString(args.jobId, 'jobId', readAgentMergeCIToolName) } : {}) };
  }
  const evidenceId = requiredString(args.evidenceId, 'evidenceId', readAgentMergeCIToolName);
  if (mode === 'tail') {
    const lineCount = boundedInteger(args.lineCount, 'lineCount', 1, 200);
    return { mode, evidenceId, ...(lineCount === undefined ? {} : { lineCount }) };
  }
  const startLine = boundedInteger(args.startLine, 'startLine', 1, Number.MAX_SAFE_INTEGER) ?? 1;
  if (mode === 'range') {
    const endLine = boundedInteger(args.endLine, 'endLine', startLine, startLine + 199) ?? startLine + 199;
    const startColumn = boundedInteger(args.startColumn, 'startColumn', 1, Number.MAX_SAFE_INTEGER);
    return { mode, evidenceId, startLine, endLine, ...(startColumn === undefined ? {} : { startColumn }) };
  }
  const query = requiredString(args.query, 'query', readAgentMergeCIToolName);
  if (query.length > 200 || /[\r\n]/.test(query)) {
    throw new Error('Invalid readAgentMergeCI input: query must be a single line of at most 200 characters.');
  }
  const contextLines = boundedInteger(args.contextLines, 'contextLines', 0, 5);
  return { mode: 'search', evidenceId, startLine, query, ...(contextLines === undefined ? {} : { contextLines }) };
};

const boundedInteger = (value: unknown, field: string, minimum: number, maximum: number): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid readAgentMergeCI input: ${field} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
};

const isMergePullRequest = (value: unknown): value is AgentMergeOverridesInput['mergePullRequest'] =>
  value === 'always' || value === 'ifUnchanged' || value === 'never';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asRecord = (value: unknown, toolName: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error(`Invalid ${toolName} input: expected an object.`);
  return value;
};

const requiredString = (value: unknown, field: string, toolName: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${toolName} input: ${field} must be a non-empty string.`);
  }
  return value;
};

const requiredBoolean = (value: unknown, field: string, toolName: string): boolean => {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${toolName} input: ${field} must be a boolean.`);
  return value;
};

const optionalBoolean = (value: unknown, field: string, toolName: string): boolean | undefined =>
  value === undefined ? undefined : requiredBoolean(value, field, toolName);
