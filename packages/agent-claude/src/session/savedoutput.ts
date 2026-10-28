import { readFile, stat } from 'node:fs/promises';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { BashOutput } from '@anthropic-ai/claude-agent-sdk/sdk-tools';
import type { ToolResultTerminalContent, Turn } from '@microsoft/agent-host-protocol';
import type { Bag, OnWire, TerminalOutputs, WireTurn } from '@ahpd/sdk';
import { bag, list, str } from './common.js';
import type { SessionContext } from './context.js';

/**
 * A `Bash` result too large to send, as a terminal on its call.
 *
 * Claude answers the model with a notice in place of such an output - the file
 * it saved the whole output to, then a preview of its start - and names the
 * file in the result's structured output. The call keeps the notice as its
 * text, and the whole output is kept by the host for the call's chat, through
 * `Start.terminalOutputs`: the call's content names a terminal the host answers
 * for, exited, for as long as the chat lasts. A call read back from Claude's
 * transcript names it again. Every other result stays as Claude returned it.
 *
 * The reference's Claude agent does the same, keeping the output with its turn
 * in its chat's database:
 * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts
 */

/**
 * Claude's shell tool, which a `pwsh` command runs through as well. Claude's
 * separate `PowerShell` tool is not this one, and the reference leaves it out.
 */
const SHELL = 'Bash';

/**
 * The largest file read, in bytes.
 *
 * The reference's limit on a terminal's output, which its agent host sets at
 * 10 MB, and the host's limit on an output it keeps. A larger file leaves the
 * call as it is rather than holding the run loop while it is read.
 * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/common/sessionDataService.ts#L19
 */
export const SAVED_BYTES = 10 * 1024 * 1024;

/** One block of a user message, as the SDK types it. */
type Block = Exclude<SDKUserMessage['message']['content'], string>[number];

/** A tool's result, which is the block a saved output arrives with. */
type ResultBlock = Extract<Block, { type: 'tool_result' }>;

/**
 * The file one result's whole output was saved to, read off the result's
 * structured output under the SDK's own names for its fields.
 *
 * The SDK types the structured output as unknown, so each field is checked as
 * it is read. A backgrounded command saves a snapshot while it goes on
 * running, which is not its whole output, so a result that names a background
 * task has none.
 */
export const savedPathOf = (result: unknown): string | undefined => {
  const output = bag(result) as Partial<Pick<BashOutput, 'persistedOutputPath' | 'backgroundTaskId'>>;
  return typeof output.persistedOutputPath === 'string' && output.backgroundTaskId === undefined
    ? output.persistedOutputPath
    : undefined;
};

/**
 * The notice Claude returns to the model in place of an output too large to
 * send: the line naming the file, then a preview of the output's start.
 *
 * The reference's own pattern, read only for the preview, because the preview
 * is in this text and nowhere else: the structured output's `stdout` is a
 * longer start of the output, not the preview the model was given.
 */
const NOTICE = /^<persisted-output>\n[^\n]*\n\nPreview \(first [^)\n]*\):\n(?<preview>[\s\S]*?)\n(?:\.\.\.\n)?<\/persisted-output>/;

/** The preview a notice carries, or nothing for a notice the pattern does not read. */
export const previewOf = (notice: string | undefined): string | undefined =>
  notice === undefined ? undefined : NOTICE.exec(notice)?.groups?.preview;

/**
 * The text a result's notice is read from: the string, or the first text
 * block, as the reference reads it from a live result and a restored call.
 */
const noticeIn = (content: unknown): string | undefined => {
  if (typeof content === 'string') return content;
  const first = (Array.isArray(content) ? content : []).map(bag).find((part) => part.type === 'text');
  return str(first?.text);
};

/**
 * The whole output, from a regular file of at most `SAVED_BYTES`.
 *
 * Node's own `stat` and `readFile`, with the same check `customizations.ts`
 * makes before it reads an agent's file: a device or a pipe would hold the read
 * for ever, and a file over the limit is not read at all. Nothing for a read
 * that failed: a file Claude has since removed is a call that keeps its notice,
 * not a turn that fails.
 */
const readOutput = async (path: string): Promise<string | undefined> => {
  try {
    const file = await stat(path);
    if (!file.isFile() || file.size > SAVED_BYTES) return undefined;
    return await readFile(path, 'utf8');
  }
  catch {
    return undefined;
  }
};

/**
 * The content a call names its kept output in: the reference's
 * `buildTerminalContent`, for a live result and a restored call alike.
 *
 * Exited with 0 for a result that succeeded, and with no code for one that
 * failed: Claude says whether a command failed and not what it exited with.
 * `truncated` always, preview or none, because the output goes on past what
 * the call shows.
 * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L166-L184
 */
const terminalOf = (
  outputs: TerminalOutputs,
  toolCallId: string,
  title: string,
  notice: string | undefined,
  success: boolean,
): OnWire<ToolResultTerminalContent> => {
  const preview = previewOf(notice);
  return {
    type: 'terminal',
    resource: outputs.uri(toolCallId),
    title,
    // Plain text from a file, which is what the field is for: a client reads it
    // to decide whether the output needs VT parsing.
    isPty: false,
    result: {
      ...(success ? { exitCode: 0 } : {}),
      ...(preview === undefined ? {} : { preview }),
      truncated: true,
    },
  };
};

/**
 * Name the kept output on each `Bash` call read back from a transcript: the
 * reference's `restore`.
 *
 * A transcript records what the model was sent, which is the notice, so a call
 * comes back with that text alone. Each completed one whose output the host
 * still keeps gets its terminal again, after the text.
 * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L117-L142
 */
export function restoreSavedOutputs(turns: WireTurn<Turn>[], outputs: TerminalOutputs): void {
  for (const turn of turns as unknown as Bag[]) {
    for (const part of Array.isArray(turn.responseParts) ? turn.responseParts : []) {
      if (bag(part).kind !== 'toolCall') continue;
      const call = bag(bag(part).toolCall);
      const id = str(call.toolCallId);
      if (call.status !== 'completed' || call.toolName !== SHELL || id === undefined || !outputs.has(id)) continue;
      const content = Array.isArray(call.content) ? call.content : [];
      call.content = [...content, terminalOf(outputs, id, str(call.displayName) ?? SHELL, noticeIn(content), call.success === true)];
    }
  }
}

/** What this area offers the rest of the session. */
export interface SavedOutputs {
  /** The terminal content each saved output became, by its call's id, until the result is mapped. */
  savedTerminals: Map<string, OnWire<ToolResultTerminalContent>>;
  /**
   * Read the output Claude saved for one `user` message, before its result is
   * mapped.
   *
   * Nothing for a message that names no saved output, so every other result
   * is mapped at once, without waiting on anything.
   */
  readSavedOutput: (message: SDKUserMessage) => Promise<void> | undefined;
}

export function createSavedOutputs(ctx: SessionContext): SavedOutputs {
  const savedTerminals = new Map<string, OnWire<ToolResultTerminalContent>>();

  /**
   * One result's saved output, kept for its chat and held for the result: the
   * reference's `capture`.
   *
   * With the same refusals: a subagent's result, a message with more than one
   * result, and a call that is not `Bash`. Two more are this host's. A host
   * that keeps no outputs has nowhere to put one, and a session in a machine
   * names a file inside the machine, which is not a folder this host has.
   * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L47-L94
   */
  const readSavedOutput = (message: SDKUserMessage): Promise<void> | undefined => {
    const outputs = ctx.options.terminalOutputs;
    if (outputs === undefined || ctx.options.spawn !== undefined) return undefined;
    const path = savedPathOf(message.tool_use_result);
    if (path === undefined || message.parent_tool_use_id !== null) return undefined;
    // Read only now, so a frame that is not the SDK's shape is passed over
    // rather than thrown at inside the run loop.
    const blocks = message.message?.content;
    if (!Array.isArray(blocks)) return undefined;
    // The structured output is the output of the message's one result.
    const results = blocks.filter((block): block is ResultBlock => block.type === 'tool_result');
    const result = results.length === 1 ? results[0] : undefined;
    const part = result === undefined ? undefined : ctx.mainScope.parts.get(result.tool_use_id);
    const call = bag(part?.toolCall);
    if (result === undefined || str(call.toolName) !== SHELL) return undefined;
    // A result for a call outside the running turn answers a turn that was
    // stopped, whether or not a later one runs, and the reference publishes
    // nothing for one of those.
    const turn = ctx.mainScope.turn;
    if (turn === undefined || !list(turn.responseParts).includes(part)) return undefined;
    return (async () => {
      const output = await readOutput(path);
      // A turn stopped while the file was read publishes nothing, and nor
      // does a session that closed: neither has a result left to carry it.
      if (output === undefined || ctx.closed || ctx.mainScope.turn !== turn) return;
      const success = result.is_error !== true;
      // Under the call's id, as the reference keeps it, and in the chat's
      // keeping, so it goes with its turn, its chat and its session. A host
      // that could not keep it leaves the call its notice.
      if (!outputs.keep(result.tool_use_id, output, success ? 0 : undefined)) return;
      const title = str(call.displayName) ?? SHELL;
      savedTerminals.set(result.tool_use_id, terminalOf(outputs, result.tool_use_id, title, noticeIn(result.content), success));
    })();
  };

  return { savedTerminals, readSavedOutput };
}
