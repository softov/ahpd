/**
 * The tools a session is offered, as tools pi can call.
 *
 * A `BoundTool` from the host is a definition and, for the host's own, a
 * function to run. pi's custom tools are the same thing in pi's own shape, so
 * this is a conversion rather than a bridge: the model sees the tool the host
 * defined, and a call comes back to `run`.
 *
 * A client's tool has no function here. The host reports the call against the
 * client that provides it, and `client` is how this waits for that client's
 * answer.
 */

import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import type { BoundTool, ClientCallAnswer } from '@ahpd/sdk';
import { loadPi } from './pi.js';

/**
 * pi's own tool names.
 *
 * A custom tool with one of these would be offered beside pi's built-in of the
 * same name, and the model would have two answers to one name. pi's is the one
 * that owns the tools, so the shadowing one is dropped.
 */
const PI_TOOLS = new Set(['bash', 'edit', 'find', 'grep', 'ls', 'powershell', 'read', 'write']);

/** How a client-owned call waits for the client that provides it. */
export type RunByClient = (
  bound: BoundTool,
  toolCallId: string,
  params: Record<string, unknown>,
) => Promise<ClientCallAnswer>;

/**
 * A client's answer, as the content pi hands its model.
 *
 * An image goes as an image: pi's model takes one, and a screenshot a client
 * returned is the whole of what it had to say. Anything else - a PDF, an
 * archive - travels as a line naming what it is, because pi's content has no
 * inline form for one and a block silently dropped would be an answer that
 * lied about what the client sent. The answer's own words are the answer for
 * one that carried no blocks at all.
 */
const toPiContent = (answer: ClientCallAnswer): (TextContent | ImageContent)[] => {
  if (answer.content.length === 0) return [{ type: 'text', text: answer.text }];
  return answer.content.map((block): TextContent | ImageContent => {
    if (block.type === 'text') return { type: 'text', text: block.text };
    if (block.type === 'embeddedResource') {
      return block.contentType.startsWith('image/')
        ? { type: 'image', data: block.data, mimeType: block.contentType }
        : {
          type: 'text',
          text: `[${block.contentType}, ${Buffer.byteLength(block.data, 'base64')} bytes]`,
        };
    }
    return { type: 'text', text: JSON.stringify(block) };
  });
};

/** A promise that rejects when pi aborts the call, and never settles otherwise. */
const stopped = (signal: AbortSignal | undefined): Promise<never> => new Promise((_, reject) => {
  if (signal === undefined) return;
  const why = new Error('The turn was stopped');
  if (signal.aborted) { reject(why); return; }
  signal.addEventListener('abort', () => reject(why), { once: true });
});

/**
 * One bound tool as a pi definition, or nothing when pi already owns the name.
 *
 * A host tool's answer is its `run` return, and a `run` that throws rejects the
 * call, which is how pi's own tools report a failure. A client-owned tool's
 * answer is whatever `client` settles with, and a refusal rejects the call with
 * the client's words so the model reads what went wrong.
 */
export async function toPiTool(bound: BoundTool, client: RunByClient): Promise<ToolDefinition | undefined> {
  const { definition } = bound;
  if (PI_TOOLS.has(definition.name)) {
    console.warn(`@ahpd/agent-pi: dropping tool "${definition.name}", which is one of pi's own`);
    return undefined;
  }
  const { defineTool, Type } = await loadPi();
  return defineTool({
    name: definition.name,
    label: definition.title ?? definition.name,
    description: definition.description ?? definition.title ?? definition.name,
    // pi validates the call against this. The host's schema is already JSON
    // Schema, and pi's `Type.Unsafe` takes it as it is rather than restating it.
    parameters: Type.Unsafe(definition.inputSchema ?? { type: 'object' }),
    execute: async (toolCallId, params, signal) => {
      if (bound.run === undefined) {
        const answer = await client(bound, toolCallId, params as Record<string, unknown>);
        if (!answer.ok) throw new Error(answer.text);
        return { content: toPiContent(answer), details: undefined };
      }
      try {
        return {
          content: [{
            type: 'text' as const,
            // A `run` that never answers still ends when pi stops the turn.
            text: await Promise.race([
              Promise.resolve(bound.run(params as Record<string, unknown>)),
              stopped(signal),
            ]),
          }],
          details: undefined,
        };
      }
      catch (error: unknown) {
        throw error instanceof Error ? error : new Error(String(error));
      }
    },
  });
}
