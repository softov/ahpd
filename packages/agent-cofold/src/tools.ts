/**
 * The host's tools as cofold tools, and a call's life as AHP actions.
 *
 * `Start.tools` are `BoundTool`s: a definition to offer the model and a
 * function to run when it calls. cofold wants a `Tool`, which is the same
 * thing with its effects resolved and its input schema checked, so this file
 * wraps one into the other. A tool call is reported to a client with its own
 * three actions, and those builders live here beside the wrapping because
 * both sides are about one tool.
 */

import { createTool } from '@cofold/agents';
import type { Tool } from '@cofold/agents';
import type { Bag, BoundTool } from '@ahpd/sdk';

/**
 * cofold's own input-schema type, read off its factory.
 *
 * The type belongs to `@cofold/sdk`, which this package does not depend on
 * directly, so it is named here by query rather than by a new import that
 * boundary would refuse.
 */
type CofoldInput = Parameters<typeof createTool>[0]['input'];

/** The host offered this tool's schema, or an empty object for one that has none. */
const inputOf = (bound: BoundTool): CofoldInput => {
  const schema = bound.definition.inputSchema;
  if (schema === undefined) return { type: 'object', properties: {} };
  /*
   * A cast, because the protocol's `inputSchema` is a loose `{ properties?:
   * Record<string, object> }` while cofold's `JsonSchema` checks each property
   * it will actually validate. Every host tool this host contributes is a
   * plain object schema; anything richer is refused by cofold's own
   * `assertSupportedSchema` when the tool is wrapped, rather than silently
   * accepted here.
   */
  return schema as unknown as CofoldInput;
};

/**
 * A call a client announced it can run, on its way out to that client.
 *
 * The session holds one of these from the moment cofold tries to execute an
 * owner-bound tool until the owning client answers or goes away. The fields
 * are what `completeToolCall` and `clientGone` need: the owner tells one
 * client's call from another's, and the name is what a call failed by a lost
 * client can say it was.
 */
export interface ClientToolCall {
  /** The model's own id for the call, which every chat action names. */
  callId: string;
  /** The client that announced the tool, and the only one that may answer. */
  owner: string;
  /** The offered name, for the result a client that went away earns. */
  name: string;
  /** The arguments, held for as long as the round trip lasts. */
  input: unknown;
}

/**
 * The session an owner-bound tool belongs to.
 *
 * A tool a client runs has no implementation here, so its `execute` cannot
 * answer on its own: it hands the call over and waits on the promise the
 * session settles. That promise resolves with the text the model reads, and
 * rejects with the client's message when the client reported a failure or is
 * no longer there.
 */
export interface ClientToolRelay {
  call(call: ClientToolCall): Promise<string>;
}

/**
 * One bound tool as cofold calls it.
 *
 * The result is handed back as the string `BoundTool.run` returned, because
 * that is the one shape every model reads. A tool that throws is answered
 * with the message rather than allowed to end the run: cofold catches it into
 * a failed `tool.completed`, and the model hears why.
 *
 * A tool a client runs carries an `owner` and no `run`. Its `execute` is the
 * round trip: it hands the call to the session, which reports it against the
 * client that provides it, and returns the promise that client's answer
 * settles. Nothing here executes it.
 */
export const cofoldTool = (bound: BoundTool, relay?: ClientToolRelay): Tool<Record<string, unknown>> => createTool<Record<string, unknown>>({
  name: bound.definition.name,
  description: bound.definition.description ?? bound.definition.title ?? bound.definition.name,
  input: inputOf(bound),
  // What the host says running it does, so cofold's own default policy asks a
  // person about a destructive tool rather than running it unchecked. A tool
  // that says nothing keeps cofold's defaults.
  ...(bound.effects !== undefined ? { effects: bound.effects } : {}),
  execute: async (input, ctx) => {
    if (bound.owner !== undefined) {
      if (relay === undefined) {
        // No session to wait on, so this call could only hang. `cofoldTools`
        // leaves such a tool out rather than offering it, and reaching here
        // means a caller wrapped one by hand.
        throw new Error(`${bound.definition.name} is ${bound.owner}'s to run, and no session is here to wait on it`);
      }
      return await relay.call({ callId: ctx.callId, owner: bound.owner, name: bound.definition.name, input });
    }
    if (bound.run === undefined) {
      throw new Error(`${bound.definition.name} has no implementation to run`);
    }
    return await bound.run(input);
  },
});

/**
 * Every tool a session was handed that something can run.
 *
 * A `BoundTool` with an `owner` is one a connected client executes: it is
 * wrapped like any other, and its `execute` hands the call to the session and
 * waits for that client. Without a session to hand it to - this export is
 * public, and a caller may have no relay - an owner-bound tool is still left
 * out, because wrapping it would offer the model a tool whose every call
 * hangs.
 *
 * A tool with neither an owner nor a `run` is left out always: nobody can
 * execute it, and a tool that always fails is worse than an absent one,
 * because the model calls it, spends a step and reports a failure that never
 * had a chance to happen.
 */
export const cofoldTools = (tools: BoundTool[], relay?: ClientToolRelay): Tool<Record<string, unknown>>[] =>
  tools
    .filter((bound) => bound.run !== undefined || (bound.owner !== undefined && relay !== undefined))
    .map((bound) => cofoldTool(bound, relay));

/*
 * How a call a client runs is reported, read from the protocol rather than
 * invented here.
 *
 * The protocol's `channels-chat/actions.d.ts` puts the owner on
 * `chat/toolCallStart` as `contributor: { kind: 'client', clientId }`, and
 * its docs say the named client is then responsible for executing the call
 * once it reaches `running` and for dispatching `chat/toolCallComplete`.
 * `chat/toolCallReady` may repeat the contributor - its docs say it MUST NOT
 * change the ownership the start established - so this bridge repeats it
 * unchanged rather than sending it only once; the client reducer keeps the
 * contributor on the call either way.
 *
 * `chat/toolCallReady` does belong for a client-run call, and it carries
 * `confirmed: 'not-needed'`. The protocol says so in as many words: for a
 * client-provided tool the server typically sets that flag "so the tool
 * transitions directly to `running`, where the owning client can begin
 * execution immediately". `not-needed` is about a person's approval, not
 * about who executes: without it the reducer parks the call in
 * `pending-confirmation` and the client that is supposed to run it never
 * starts.
 *
 * The call is closed by the same `tool.completed` every other tool call
 * takes. The client dispatches `chat/toolCallComplete`, the host routes it
 * to the session's `completeToolCall`, the waiting cofold tool resolves with
 * the client's text, and the mapping emits the completion action from that.
 * The host deliberately does not echo the client's action, because the row
 * would otherwise be finished twice.
 */

/** The contributor of a call a client runs, in the protocol's spelling. */
export const contributorOf = (owner: string | undefined): Bag =>
  owner === undefined ? {} : { contributor: { kind: 'client', clientId: owner } };

/**
 * The response part a tool call holds in a snapshot.
 *
 * The client's reducer builds the same part from `chat/toolCallStart`, so
 * this is what a subscription after the fact reads. The call opens
 * `streaming`, which is where a tool call starts even when its arguments
 * arrived whole. A client-run call carries its owner here too, because a
 * client that subscribes rather than watches the stream reads this part and
 * not the action that built it.
 */
export const toolCallPart = (callId: string, name: string, displayName: string, owner?: string): Bag => ({
  id: callId,
  kind: 'toolCall',
  toolCall: {
    toolCallId: callId,
    toolName: name,
    displayName,
    status: 'streaming',
    ...contributorOf(owner),
  },
});

/** The action that opens a tool-call row. It creates the part on the client. */
export const toolStartAction = (turnId: string, callId: string, name: string, displayName: string, owner?: string): Bag => ({
  type: 'chat/toolCallStart',
  turnId,
  toolCallId: callId,
  toolName: name,
  displayName,
  ...contributorOf(owner),
});

/**
 * The action that fills the arguments in.
 *
 * Nothing is being asked here. A question is an approval, so
 * `confirmed: 'not-needed'` moves the call straight to `running`; for a
 * client-run call that is also the state the owning client executes in.
 * Without it the reducer parks every call in `pending-confirmation` and
 * draws a question nobody asked.
 */
export const toolReadyAction = (turnId: string, callId: string, name: string, input: unknown, owner?: string): Bag => {
  const written = input === undefined ? undefined : JSON.stringify(input);
  return {
    type: 'chat/toolCallReady',
    turnId,
    toolCallId: callId,
    invocationMessage: name,
    confirmed: 'not-needed',
    ...contributorOf(owner),
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
