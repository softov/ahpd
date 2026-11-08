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
 * it persisted the whole output to, then a preview of its start - and names the
 * file in the result's structured output. The call keeps the notice as its
 * text, and the whole output is kept by the host for the call's chat, through
 * `Start.terminalOutputs`: the call's content names a terminal the host answers
 * for, exited, for as long as the chat lasts. A call read back from Claude's
 * transcript names it again. Every other result stays as Claude returned it.
 *
 * The reference's Claude agent does the same, keeping the output with its turn
 * in its chat's database, and names the output persisted:
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts
 */

/**
 * Claude's shell tool, which a `pwsh` command runs through as well. Claude's
 * `PowerShell` tool is another, which the reference leaves out.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L20
 */
const CLAUDE_SHELL_TOOL_NAME = 'Bash';

/**
 * The largest file read, in bytes, unless the record's `maxTerminalOutputBytes`
 * says otherwise.
 *
 * The reference's limit on a terminal's output, which its agent host sets at
 * 10 MB, and the host's limit on an output it keeps. A larger file leaves the
 * call as it is, so the run loop is never held while one is read.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/sessionDataService.ts#L19
 */
export const MAX_TERMINAL_OUTPUT_BYTES = 10 * 1024 * 1024;

/** One block of a user message, as the SDK types it. */
type Block = Exclude<SDKUserMessage['message']['content'], string>[number];

/** A tool's result, which is the block a persisted output arrives with. */
type ResultBlock = Extract<Block, { type: 'tool_result' }>;

/**
 * The file one result's whole output was persisted to, read off the result's
 * structured output under the SDK's own names for its fields: the reference's
 * `getPersistedOutputPath`.
 *
 * The SDK types the structured output as unknown, so each field is checked as
 * it is read. A backgrounded command persists a snapshot while it goes on
 * running, which is a part of its output, so a result that names a background
 * task has none.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L151-L157
 */
export const getPersistedOutputPath = (result: unknown): string | undefined => {
  const output = bag(result) as Partial<Pick<BashOutput, 'persistedOutputPath' | 'backgroundTaskId'>>;
  return typeof output.persistedOutputPath === 'string' && output.backgroundTaskId === undefined
    ? output.persistedOutputPath
    : undefined;
};

/**
 * The notice Claude returns to the model in place of an output too large to
 * send: the line naming the file, then a preview of the output's start.
 *
 * The reference's own pattern, read for the preview, which is in this text
 * alone: the structured output's `stdout` is a longer start of the output
 * than the preview the model was given.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L27
 */
const PERSISTED_OUTPUT_NOTICE = /^<persisted-output>\n[^\n]*\n\nPreview \(first [^)\n]*\):\n(?<preview>[\s\S]*?)\n(?:\.\.\.\n)?<\/persisted-output>/;

/** The preview a notice carries, or nothing for a notice the pattern does not read. */
export const previewOf = (notice: string | undefined): string | undefined =>
  notice === undefined ? undefined : PERSISTED_OUTPUT_NOTICE.exec(notice)?.groups?.preview;

/**
 * The text a result's notice is read from: the string, or the first text
 * block, as the reference's `getText` reads it from a live result and a
 * restored call.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L159-L165
 */
const getText = (content: unknown): string | undefined => {
  if (typeof content === 'string') return content;
  const first = (Array.isArray(content) ? content : []).map(bag).find((part) => part.type === 'text');
  return str(first?.text);
};

/**
 * The whole output, from a regular file of at most `most` bytes.
 *
 * Node's own `stat` and `readFile`, with the same check `customizations.ts`
 * makes before it reads an agent's file: a device or a pipe would hold the read
 * for ever, and a file over the limit is left unread. Nothing for a read that
 * failed: a file Claude has since removed is a call that keeps its notice, and
 * the turn goes on.
 */
const readOutput = async (path: string, most: number): Promise<string | undefined> => {
  try {
    const file = await stat(path);
    if (!file.isFile() || file.size > most) return undefined;
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
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L167-L185
 */
const buildTerminalContent = (
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
 * reference's `ClaudeTerminalOutputs.restore`.
 *
 * A transcript records what the model was sent, which is the notice, so a call
 * comes back with that text alone. Each completed one whose output the host
 * still keeps gets its terminal again, after the text.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L117-L143
 */
export function restore(turns: WireTurn<Turn>[], outputs: TerminalOutputs): void {
  for (const turn of turns as unknown as Bag[]) {
    for (const part of Array.isArray(turn.responseParts) ? turn.responseParts : []) {
      if (bag(part).kind !== 'toolCall') continue;
      const call = bag(bag(part).toolCall);
      const id = str(call.toolCallId);
      if (call.status !== 'completed' || call.toolName !== CLAUDE_SHELL_TOOL_NAME || id === undefined || !outputs.has(id)) continue;
      const content = Array.isArray(call.content) ? call.content : [];
      call.content = [...content, buildTerminalContent(outputs, id, str(call.displayName) ?? CLAUDE_SHELL_TOOL_NAME, getText(content), call.success === true)];
    }
  }
}

/** What this area offers the rest of the session: the reference's `ClaudeTerminalOutputs`. */
export interface ClaudeTerminalOutputs {
  /**
   * The terminal content each persisted output became, by its call's id, until
   * the result is mapped: the reference's retained terminal outputs.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L78
   */
  retainedTerminalOutputs: Map<string, OnWire<ToolResultTerminalContent>>;
  /**
   * Read the output Claude persisted for one `user` message, before its result
   * is mapped.
   *
   * Nothing for a message that names no persisted output, so every other
   * result is mapped at once, waiting on nothing.
   */
  capture: (message: SDKUserMessage) => Promise<void> | undefined;
}

export function createClaudeTerminalOutputs(ctx: SessionContext): ClaudeTerminalOutputs {
  const retainedTerminalOutputs = new Map<string, OnWire<ToolResultTerminalContent>>();

  /**
   * One result's persisted output, kept for its chat and held for the result:
   * the reference's `capture`.
   *
   * With the same refusals: a subagent's result, a message with more than one
   * result, and a call of another tool than `Bash`. Two more are this host's. A
   * host that keeps no outputs has nowhere to put one, and a session in a
   * machine names a file inside the machine, which this host's folders hold
   * none of.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L47-L94
   */
  const capture = (message: SDKUserMessage): Promise<void> | undefined => {
    const outputs = ctx.options.terminalOutputs;
    if (outputs === undefined || ctx.options.spawn !== undefined) return undefined;
    const path = getPersistedOutputPath(message.tool_use_result);
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
    if (result === undefined || str(call.toolName) !== CLAUDE_SHELL_TOOL_NAME) return undefined;
    // A result for a call outside the running turn answers a turn that was
    // stopped, whether or not a later one runs, and the reference publishes
    // nothing for one of those.
    const turn = ctx.mainScope.turn;
    if (turn === undefined || !list(turn.responseParts).includes(part)) return undefined;
    const most = ctx.values['maxTerminalOutputBytes'];
    return (async () => {
      const output = await readOutput(path, typeof most === 'number' ? most : MAX_TERMINAL_OUTPUT_BYTES);
      // A turn stopped while the file was read publishes nothing, and nor
      // does a session that closed: neither has a result left to carry it.
      if (output === undefined || ctx.disposed || ctx.mainScope.turn !== turn) return;
      const success = result.is_error !== true;
      // Under the call's id, as the reference keeps it, and in the chat's
      // keeping, so it goes with its turn, its chat and its session. A host
      // that could not keep it leaves the call its notice.
      if (!outputs.keep(result.tool_use_id, output, success ? 0 : undefined)) return;
      const title = str(call.displayName) ?? CLAUDE_SHELL_TOOL_NAME;
      retainedTerminalOutputs.set(result.tool_use_id, buildTerminalContent(outputs, result.tool_use_id, title, getText(result.content), success));
    })();
  };

  return { retainedTerminalOutputs, capture };
}
