/**
 * The host's tools as facio tools, and a call's life as AHP actions.
 *
 * `Start.tools` are `BoundTool`s: a definition to offer the model and a
 * function to run when it calls. facio wants a `Tool`, which is the same
 * thing with its effects resolved and its input schema checked, so this file
 * wraps one into the other. A tool call is reported to a client with its own
 * three actions, and those builders live here beside the wrapping because
 * both sides are about one tool.
 */

import { createTool } from '@facio/agents';
import type { Tool } from '@facio/agents';
import type { Bag, BoundTool } from '@ahpd/sdk';

/**
 * facio's own input-schema type, read off its factory.
 *
 * The type belongs to `@facio/sdk`, which this package does not depend on
 * directly, so it is named here by query rather than by a new import that
 * boundary would refuse.
 */
type FacioInput = Parameters<typeof createTool>[0]['input'];

/** The host offered this tool's schema, or an empty object for one that has none. */
const inputOf = (bound: BoundTool): FacioInput => {
  const schema = bound.definition.inputSchema;
  if (schema === undefined) return { type: 'object', properties: {} };
  /*
   * A cast, because the protocol's `inputSchema` is a loose `{ properties?:
   * Record<string, object> }` while facio's `JsonSchema` checks each property
   * it will actually validate. Every host tool this host contributes is a
   * plain object schema; anything richer is refused by facio's own
   * `assertSupportedSchema` when the tool is wrapped, rather than silently
   * accepted here.
   */
  return schema as unknown as FacioInput;
};

/**
 * One bound tool as facio calls it.
 *
 * The result is handed back as the string `BoundTool.run` returned, because
 * that is the one shape every model reads. A tool that throws is answered
 * with the message rather than allowed to end the run: facio catches it into
 * a failed `tool.completed`, and the model hears why.
 *
 * A tool a client runs carries an `owner` and no `run`, and it is never
 * wrapped: see `facioTools`, which leaves one out. A tool that always fails
 * is worse than an absent tool, because the model calls it, spends a step and
 * reports a failure the client never had a chance to run.
 */
export const facioTool = (bound: BoundTool): Tool<Record<string, unknown>> => createTool<Record<string, unknown>>({
  name: bound.definition.name,
  description: bound.definition.description ?? bound.definition.title ?? bound.definition.name,
  input: inputOf(bound),
  execute: async (input) => {
    if (bound.run === undefined) {
      throw new Error(`${bound.definition.name} has no implementation to run`);
    }
    return await bound.run(input);
  },
});

/**
 * Every tool a session was handed that this backend can run.
 *
 * A `BoundTool` with an `owner` is one a connected client executes, and the
 * round trip that offers it to the model and waits for that client's result
 * is not built yet. It is left out rather than offered-and-failing, so the
 * model is never given a tool nothing here can answer.
 */
export const facioTools = (tools: BoundTool[]): Tool<Record<string, unknown>>[] =>
  tools.filter((bound) => bound.owner === undefined).map(facioTool);

/**
 * The response part a tool call holds in a snapshot.
 *
 * The client's reducer builds the same part from `chat/toolCallStart`, so
 * this is what a subscription after the fact reads. The call opens
 * `streaming`, which is where a tool call starts even when its arguments
 * arrived whole.
 */
export const toolCallPart = (callId: string, name: string, displayName: string): Bag => ({
  id: callId,
  kind: 'toolCall',
  toolCall: {
    toolCallId: callId,
    toolName: name,
    displayName,
    status: 'streaming',
  },
});

/** The action that opens a tool-call row. It creates the part on the client. */
export const toolStartAction = (turnId: string, callId: string, name: string, displayName: string): Bag => ({
  type: 'chat/toolCallStart',
  turnId,
  toolCallId: callId,
  toolName: name,
  displayName,
});

/**
 * The action that fills the arguments in.
 *
 * Nothing is being asked here. A question is an approval, which this task
 * does not raise, so `confirmed: 'not-needed'` moves the call straight to
 * `running`. Without it the reducer parks every call in
 * `pending-confirmation` and draws a question nobody asked.
 */
export const toolReadyAction = (turnId: string, callId: string, name: string, input: unknown): Bag => {
  const written = input === undefined ? undefined : JSON.stringify(input);
  return {
    type: 'chat/toolCallReady',
    turnId,
    toolCallId: callId,
    invocationMessage: name,
    confirmed: 'not-needed',
    ...(written !== undefined ? { toolInput: written } : {}),
  };
};

/**
 * The action that closes a tool-call row.
 *
 * `success` is the failure flag, and the content is the one block a client
 * reads. A failed call keeps its content in `error.message` as well, because
 * that is where a client looks for the reason.
 */
export const toolCompleteAction = (turnId: string, callId: string, name: string, content: string, isError: boolean): Bag => ({
  type: 'chat/toolCallComplete',
  turnId,
  toolCallId: callId,
  result: {
    success: !isError,
    pastTenseMessage: name,
    ...(content !== '' ? { content: [{ type: 'text', text: content }] } : {}),
    ...(isError ? { error: { message: content === '' ? 'The tool failed' : content } } : {}),
  },
});
