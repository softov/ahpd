import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { StringOrMarkdown } from '@microsoft/agent-host-protocol';
import { z } from 'zod';
import { createClientCalls, toMcpContent } from '@ahpd/sdk';
import type { Bag, BoundTool, ClientCallAnswer, ClientCalls } from '@ahpd/sdk';
import { str } from './common.js';
import type { SessionContext } from './context.js';

/**
 * One property of a tool's input schema, as the zod the SDK asks for.
 *
 * `createSdkMcpServer` takes a zod raw shape and turns it back into JSON
 * Schema for the model, so a definition written as JSON Schema - which is
 * what the protocol declares - has to make the round trip. `fromJSONSchema`
 * reads that whole schema, so a nested object, an array of objects and an
 * enum reach the model as the client wrote them rather than as a string. A
 * property the reader refuses becomes a string, which is what every argument
 * used to be. A description the reader drops is put back, because the model
 * reads it.
 */
const shaped = (property: object): z.ZodTypeAny => {
  let read: z.ZodTypeAny;
  try { read = z.fromJSONSchema(property as never); }
  catch { return z.string(); }
  const said = str((property as Bag).description);
  if (said !== undefined && read.description === undefined) return read.describe(said);
  return read;
};

/**
 * Where the CLI names the call it is running, on a handler's `extra`.
 *
 * The key VS Code reads, and the one thing that says which call a handler
 * was invoked for: a client's answer is keyed by that id. It rides under the
 * CLI's own namespace because the SDK passes the request's `_meta` through
 * without promising anything about what is in it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/clientTools/claudeClientToolMcpServer.ts#L12-L20
 */
const TOOL_USE_ID = 'claudecode/toolUseId';

/** The call the CLI said this handler was running, when it said one. */
const namedBy = (extra: unknown): string | undefined => {
  const meta = (extra as { _meta?: Record<string, unknown> } | undefined)?._meta;
  const id = meta?.[TOOL_USE_ID];
  return typeof id === 'string' && id !== '' ? id : undefined;
};

/**
 * The host's tools, as an in-process MCP server the CLI can call.
 *
 * In-process: `createSdkMcpServer` registers the handlers here rather than
 * spawning anything, so a host tool is a function call. The result is handed
 * back as MCP content, because that is the one shape that carries a client's
 * image and its file as well as its words.
 */
export const contributed = (
  tools: BoundTool[],
  /** Hand the call the CLI named to the client that provides it, and wait for what it says. */
  byClient: (tool: BoundTool, toolUseId: string) => Promise<ClientCallAnswer>,
): unknown => createSdkMcpServer({
  name: 'ahp',
  version: '1.0.0',
  tools: tools.map((one) => {
    const schema = one.definition.inputSchema;
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, property] of Object.entries(schema?.properties ?? {})) {
      const value = shaped(property);
      shape[key] = (schema?.required ?? []).includes(key) ? value : value.optional();
    }
    return {
      name: one.definition.name,
      description: one.definition.description ?? one.definition.title ?? one.definition.name,
      inputSchema: shape,
      /*
       * A raw SDK definition, not the SDK's `tool()` helper, so the eager flag
       * rides `_meta`. Passed only when the host defined it: `false` is the
       * SDK's own default, and an undefined one must pass nothing so every
       * other host and client tool keeps that default.
       */
      ...(one.deferLoading !== undefined ? { _meta: { 'anthropic/alwaysLoad': !one.deferLoading } } : {}),
      ...(one.definition.annotations ? { annotations: one.definition.annotations } : {}),
      handler: async (input: Record<string, unknown>, extra: unknown) => {
        /*
         * Somebody else's tool, run where it lives.
         *
         * A client that announced this one is the only thing that can run it -
         * it is the editor's own command, or a plugin's - so the call goes out
         * against that client and this waits. The wait is what makes the model
         * see a tool at all: an MCP handler that returned before the answer
         * came back would be answering on the client's behalf.
         *
         * `extra` is where the CLI names the call, and the call is what the
         * client's answer is keyed by. A handler handed no id answers that it
         * could not run, in VS Code's words, since it has no call to wait on.
         * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/clientTools/claudeClientToolMcpServer.ts#L41-L56
         */
        if (one.owner !== undefined) {
          const toolUseId = namedBy(extra);
          if (toolUseId === undefined) {
            return {
              content: [{
                type: 'text' as const,
                text: `Client tool "${one.definition.name}" could not run: SDK omitted tool_use_id (expected at extra._meta["${TOOL_USE_ID}"]).`,
              }],
              isError: true,
            };
          }
          const answer = await byClient(one, toolUseId);
          /*
           * The client's whole answer, in the vocabulary an agent reads.
           *
           * A text block is a text block, an image is an image, and a file is
           * a resource blob.
           */
          return {
            // MCP's own shapes, built from the protocol's - the SDK's union is
            // narrower than the protocol's and this is where the two meet.
            content: toMcpContent(answer, toolUseId) as never,
            ...(answer.ok ? {} : { isError: true }),
          };
        }
        try {
          return { content: [{ type: 'text' as const, text: await one.run?.(input) ?? '' }] };
        }
        catch (error: unknown) {
          // The message, not a throw: an MCP tool that rejects is a transport
          // failure, and a tool that could not do the thing is an answer.
          return {
            content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
            isError: true,
          };
        }
      },
    };
  }),
}) as unknown;

/**
 * The host's tools this backend takes, out of the ones it was given.
 *
 * `ask_user` is not one of them. This backend has its own question tool, and
 * a session offered both would put two tools that ask the person in front of
 * the model. The plan `host/20261103-1620-an-agent-asks-the-person` leaves
 * Claude on its own tool for now, and its *deferred.md* says what would have
 * to change before this backend takes the host's.
 */
export const takes = (tools: BoundTool[]): BoundTool[] =>
  tools.filter((one) => one.definition.name !== 'ask_user');

/** What this area offers the rest of the session, and its `Session` methods. */
export interface ClientTools {
  /**
   * The tool of a client's the CLI is calling, and the name the client
   * announced it under.
   *
   * Nothing for a tool this session does not offer, or one no client provides -
   * a call the harness runs itself, which is nobody else's to answer.
   */
  clientToolOf: (toolName: string) => { owner: string; name: string } | undefined;
  /** The host's own tool the CLI is calling, as this session offers it: nothing for a client's tool or the harness's. */
  hostToolOf: (toolName: string) => BoundTool | undefined;
  /**
   * The call the CLI has just reported running, held for the client that owns it.
   *
   * Opened where the running ready goes out, and not where the call is first
   * announced: a call `canUseTool` asks about is not running until it is
   * approved, and an entry raised for one would tell a client to run a tool
   * the person has not allowed yet.
   *
   * This is also where a handler waiting on the call's id goes on, whichever
   * of the two arrived first - so it is called from the frame that reports the
   * call and from the approval of one the person was asked about.
   */
  openCall: (toolName: string, turnId: string, id: string, line: StringOrMarkdown, input: string | undefined) => void;
  /**
   * A person is being asked about this call, so it is not a client's yet.
   *
   * The frame that reports a call can be read before the question is put and
   * after it - the CLI decides - so this is what makes the two orders one: an
   * entry that is already up comes down, and one that is raised afterwards is
   * not raised at all.
   */
  holdCall: (id: string) => void;
  /** The person allowed the call: it is the owning client's to run now. */
  allowCall: (toolName: string, turnId: string, id: string, line: StringOrMarkdown, input: string | undefined) => void;
  /** The person refused the call: nothing runs it, and nothing goes on waiting. */
  refuseCall: (id: string, why: string) => void;
  /** Every outstanding client call, answered the same way and forgotten. */
  releaseCalls: (why: string) => void;
  /** Run the call the CLI named where the client that provides its tool lives, and wait for it. */
  ranByClient: (tool: BoundTool, toolUseId: string) => Promise<ClientCallAnswer>;
  /**
   * The tools handed since the CLI was last given a set, taken into what a
   * new CLI is built with, as VS Code's rebuild consumes its client-tool diff
   * into the options it starts the query with.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkOptions.ts#L222-L233
   */
  buildClientMcpServers: () => void;
  /**
   * The tools handed since the CLI was last given a set, given to the running
   * CLI before a turn's prompt; a refusal rejects, the set kept for the next.
   *
   * `ahp` goes out in two declarations, because the SDK connects only a server
   * name it has not registered yet and `ahp` was registered when the session
   * started: the first call leaves it out, which is what makes the SDK
   * disconnect it, and the second carries the new one, which is what makes the
   * SDK connect that. A list with nothing in it is the first call alone, there
   * being no server to add back, and a session with no `ahp` yet is the second
   * alone. Each declaration is kept only once the SDK has taken it, so a
   * removal that took and an add that did not leaves the session holding the
   * set without `ahp`.
   */
  rebindForClientTools: () => Promise<void>;
  /** The one place this chat's client calls are held, for the snapshot and above. */
  calls: ClientCalls;
  methods: {
    setTools: (tools: BoundTool[]) => Promise<boolean>;
    toolCallOwner: (toolCallId: string) => string | undefined;
    completeToolCall: (toolCallId: string, clientId: string, result: ClientCallAnswer) => boolean;
    clientGone: (clientId: string) => void;
  };
}

export function createClientTools(ctx: SessionContext): ClientTools {
  /** The full name the CLI calls a contributed tool by. */
  const called = (name: string): string => `mcp__ahp__${name}`;
  /** The tool of a client's this session has on offer, as it is offered. */
  const offered = (toolName: string): BoundTool | undefined =>
    ctx.offering.find((one) => called(one.definition.name) === toolName);

  /**
   * The tools the session's clients provide now: the set the host handed last,
   * which the CLI is given at the next send.
   */
  const live = (): BoundTool[] => ctx.toolDiff ?? ctx.offering;

  const clientToolOf = (toolName: string): { owner: string; name: string } | undefined => {
    const tool = offered(toolName);
    /*
     * The client that provides the tool now, as VS Code's stream mapper reads
     * its live model's owner of a call's tool: the CLI keeps the tools it was
     * given until the next send, and a client that left since runs nothing.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L663
     */
    const owner = tool === undefined ? undefined : live().find((one) => one.definition.name === tool.definition.name)?.owner;
    if (tool === undefined || owner === undefined) return undefined;
    /*
     * `<clientId>__<name>` is what the model is offered, because two clients
     * in one session may both provide `openFile`. The client itself knows its
     * tool by the name it announced, and that is the name the entry carries
     * and every sentence about the call uses.
     */
    return { owner, name: tool.definition.name.slice(owner.length + 2) };
  };

  const hostToolOf = (toolName: string): BoundTool | undefined => {
    const tool = offered(toolName);
    return tool?.owner === undefined ? tool : undefined;
  };

  /*
   * The calls this session has out with its clients, held in one place.
   *
   * The holder raises each call's entry on the session under the chat the
   * call is in, keeps the answer that arrives before the harness asks for it,
   * times a call out and fails the calls of a client that goes.
   */
  const calls = createClientCalls({
    chat: ctx.options.chatUri,
    emit: ctx.emit,
    // Absent only where a session is built by hand, and then the holder's own
    // ten minutes apply - the same answer the host resolves an unset one to.
    ...(ctx.options.clientToolTimeoutMs === undefined ? {} : { timeoutMs: ctx.options.clientToolTimeoutMs }),
    // Asked only when a client goes: the model is the one that has to know
    // that somebody else provides the tool its call was for.
    providers: (name) => live()
      .filter((one) => one.owner !== undefined && one.definition.name.endsWith(`__${name}`))
      .map((one) => String(one.owner)),
  });

  /** How a handler's wait for its call ends: with the call, or with why there is none. */
  type Joined = { id: string } | { refused: string };

  /*
   * Which calls the frames have reported, for a handler waiting on its id.
   *
   * The handler and the frame that reports its call reach this session apart,
   * and either can be read first, so there is something to wait for: a handler
   * that arrives before the frame waits in `asked`, and one that arrives after
   * is answered from `framed`. Only ids no handler has come for yet are kept
   * there, and past the cap the oldest goes, so an aborted call of a long
   * session does not pile up for ever.
   */
  const framed = new Set<string>();
  const asked = new Map<string, { tool: string; go: (joined: Joined) => void }[]>();
  const KEEP_FRAMED = 64;

  /*
   * The calls no entry may be raised for, by the CLI's id for them.
   *
   * A call a person is being asked about, and one a person has refused: neither
   * is one a client runs. The frame that reports a call can be read on either
   * side of the question, so the id is what says so to the frame that comes
   * after - and the person allowing the call is what takes it out again.
   */
  const noEntry = new Set<string>();

  /** A call that will not run, in the shape an answer to the model takes. */
  const refusedAnswer = (text: string): ClientCallAnswer => ({ ok: false, text, content: [{ type: 'text', text }] });

  /** The frame has opened this call: whoever is waiting on it may go on. */
  const opened = (id: string): void => {
    const waiting = asked.get(id) ?? [];
    asked.delete(id);
    if (waiting.length > 0) {
      for (const one of waiting) one.go({ id });
      return;
    }
    framed.add(id);
    if (framed.size > KEEP_FRAMED) framed.delete(framed.values().next().value as string);
  };

  /**
   * Wait for the frame to report the call this handler was handed the id of.
   *
   * The tool the call is for is kept with the wait, because the call's id says
   * nothing about it: a client that goes has to be able to end the wait, and it
   * knows its own tools by name and not the ids the CLI gave their calls.
   */
  const untilOpen = (id: string, toolName: string): Promise<Joined> => {
    if (framed.delete(id)) return Promise.resolve({ id });
    return new Promise((resolve) => { asked.set(id, [...(asked.get(id) ?? []), { tool: toolName, go: resolve }]); });
  };

  /**
   * One call's wait taken back, and whoever waits on it told.
   *
   * A handler parked on a call that will never open, one the person refused,
   * is a tool call the model never gets back, so it is answered with the
   * reason instead.
   */
  const withdraw = (id: string, why: string): void => {
    for (const one of asked.get(id) ?? []) one.go({ refused: why });
    asked.delete(id);
    framed.delete(id);
  };

  /** Every wait there is, ended at once: a turn that was stopped, or a chat that closed. */
  const refuseAll = (why: string): void => {
    for (const waiting of asked.values()) for (const one of waiting) one.go({ refused: why });
    asked.clear();
    framed.clear();
    noEntry.clear();
  };

  const openCall = (toolName: string, turnId: string, id: string, line: StringOrMarkdown, input: string | undefined): void => {
    const tool = clientToolOf(toolName);
    if (tool === undefined) {
      // Nothing offers this tool, so nothing will open this call: a handler
      // already waiting on it is told that rather than left until the turn is
      // stopped.
      withdraw(id, `Nothing here offers ${toolName}.`);
      return;
    }
    // A call a person is deciding about, or has refused, is not one any client
    // runs: no entry, and nothing for a handler to wait for.
    if (noEntry.has(id)) return;
    /*
     * The call exists now, and this is the one place that says so: a handler
     * waiting on this id is waiting for exactly this. Registered here rather
     * than where the frame is first read, because a call a person approved is
     * one the frame has already skipped.
     */
    opened(id);
    // A worker's call is in the worker's chat, which its entry names.
    const chat = ctx.scopeOfCall(id)?.chat?.uri;
    calls.open({
      turnId,
      owner: tool.owner,
      ...(chat === undefined ? {} : { chat }),
      toolCall: {
        toolCallId: id,
        // The name the client announced, not the `<clientId>__<name>` the
        // model was offered.
        toolName: tool.name,
        displayName: tool.name,
        invocationMessage: line,
        // Nothing is being asked here: a call that runs at all has cleared its
        // confirmation gate.
        confirmed: 'not-needed',
        ...(input !== undefined ? { toolInput: input } : {}),
      },
    });
  };

  const holdCall = (id: string): void => {
    noEntry.add(id);
    calls.hold(id);
  };

  const allowCall = (toolName: string, turnId: string, id: string, line: StringOrMarkdown, input: string | undefined): void => {
    noEntry.delete(id);
    openCall(toolName, turnId, id, line, input);
  };

  const refuseCall = (id: string, why: string): void => {
    noEntry.add(id);
    const owner = calls.owner(id);
    // The owner was never asked, so this session answers for it: the call ends
    // here rather than being left open for a client that will not run it.
    if (owner !== undefined) calls.complete(id, owner, refusedAnswer(why));
    withdraw(id, why);
  };

  const releaseCalls = (why: string): void => {
    calls.release(why);
    // The waits as well as the calls: a handler waiting for a frame that will
    // not come is the other half of a turn left hanging.
    refuseAll(why);
  };

  const ranByClient = async (tool: BoundTool, toolUseId: string): Promise<ClientCallAnswer> => {
    // The call this handler is for, by the CLI's own name for it, so it waits
    // for that call to be opened and never for somebody else's.
    const joined = await untilOpen(toolUseId, called(tool.definition.name));
    /*
     * Nothing to wait on: the call was refused, or the turn it was in stopped.
     * An answer rather than a throw, because a handler that rejects is a
     * transport failure and the model is never told what happened.
     */
    if ('refused' in joined) return refusedAnswer(joined.refused);
    return calls.wait(joined.id);
  };

  /** Two sets of tools offered alike: the same names, run by the same clients. */
  const same = (a: BoundTool[], b: BoundTool[]): boolean =>
    a.map((one) => `${one.definition.name}\u0000${one.owner ?? ''}`).join('\n')
    === b.map((one) => `${one.definition.name}\u0000${one.owner ?? ''}`).join('\n');

  /** The declared servers with `ahp` carrying `tools`, or without it for none. */
  const declaring = (tools: BoundTool[]): Record<string, Bag> => {
    const declared: Record<string, Bag> = { ...ctx.declared };
    delete declared.ahp;
    if (tools.length > 0) declared.ahp = contributed(tools, ranByClient) as Bag;
    return declared;
  };

  const buildClientMcpServers = (): void => {
    const handed = ctx.toolDiff;
    if (handed === undefined) return;
    ctx.toolDiff = undefined;
    ctx.offering = takes(handed);
    ctx.declared = declaring(ctx.offering);
  };

  const rebindForClientTools = async (): Promise<void> => {
    const handed = ctx.toolDiff;
    if (handed === undefined) return;
    ctx.toolDiff = undefined;
    const next = takes(handed);
    if (same(ctx.offering, next)) return;
    // Without `ahp`: the declaration the SDK disconnects the old one on.
    const removed = declaring([]);
    const declared = declaring(next);
    try {
      if (ctx.declared.ahp !== undefined) {
        await ctx.handle.setMcpServers(removed as never);
        // Gone from the CLI now, so what this session holds is the set
        // without it, whatever the second declaration answers.
        ctx.offering = [];
        ctx.declared = removed;
      }
      if (next.length > 0) await ctx.handle.setMcpServers(declared as never);
    }
    catch (error: unknown) {
      // The CLI holds what it held, so the set waits for the next send, as
      // VS Code marks its diff dirty again when a rebuild fails; a set handed
      // since is the newer one.
      ctx.toolDiff ??= handed;
      throw error;
    }
    ctx.offering = [...next];
    ctx.declared = declared;
  };

  const methods: ClientTools['methods'] = {
    /**
     * The tools on offer, replaced whole, from the next send on.
     *
     * Whole because that is what the SDK takes: `setMcpServers` replaces the
     * set it is given, so a server rebuilt from one tool would take the others
     * away. Called when a client announces what it provides or stops being
     * active, which is the only thing that moves this list after a session is
     * built.
     *
     * Held until the next send and given to the CLI before that turn's prompt,
     * as VS Code's Claude marks its client-tool diff dirty and rebinds its
     * query with the new tools at the next send: a running turn keeps the
     * tools it started with, and a turn a client sends after announcing its
     * tools is a turn of a session that has them. The last set handed is the
     * one given.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1072-L1080
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/clientTools/claudeSessionClientToolsModel.ts#L73-L127
     */
    setTools: async (next) => {
      ctx.toolDiff = [...next];
      return true;
    },

    /*
     * The three the holder answers, spread on unchanged.
     *
     * Who owns a call, which client may settle it, and what happens to the
     * calls of a client that goes: all of it is the holder's, and none of it
     * is about this harness. Nothing is emitted from `completeToolCall`: the
     * answer goes back to the CLI, the CLI writes the tool result, and the
     * session reports the completion to everybody from that - which is the
     * same path every other tool call takes.
     */
    ...calls.methods,

    /**
     * A client left the session, with the tools it was offering.
     *
     * The holder's own `clientGone` ends the calls already open, which is what
     * a call the model made and the client was running gets. What it does not
     * reach is the half a handler is stuck on: a call the CLI has not reported
     * yet, so a handler is still waiting on its id for a client that is no
     * longer there to answer. Those are ended here, with the sentence the
     * holder uses for the same news, so both halves of one call read the same.
     *
     * Every tool whose name is this client's, by the prefix the model is
     * offered under. The tools may already be gone from `offering` - the host
     * takes them out in the same breath - so the waits are asked, not the list:
     * each carries the tool it is for.
     */
    clientGone: (clientId) => {
      const why = `The client ${clientId} that was running the tool is no longer here`;
      for (const [id, waiting] of asked) {
        const here = waiting.filter((one) => one.tool.startsWith(called(`${clientId}__`)));
        if (here.length === 0) continue;
        for (const one of here) one.go({ refused: why });
        const rest = waiting.filter((one) => !here.includes(one));
        if (rest.length === 0) asked.delete(id);
        else asked.set(id, rest);
      }
      calls.methods.clientGone(clientId);
    },
  };

  return {
    clientToolOf, hostToolOf, openCall, holdCall, allowCall, refuseCall, releaseCalls, ranByClient,
    buildClientMcpServers, rebindForClientTools, calls, methods,
  };
}
