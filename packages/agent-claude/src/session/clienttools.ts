import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { StringOrMarkdown } from '@microsoft/agent-host-protocol';
import { z } from 'zod';
import { createClientCalls, toMcpContent } from '@ahpd/sdk';
import type { Bag, BoundTool, ClientCallAnswer, ClientCalls } from '@ahpd/sdk';
import { bag, str } from './common.js';
import type { SessionContext } from './context.js';

/**
 * One property of a tool's input schema, as the zod the SDK asks for.
 *
 * `createSdkMcpServer` takes a zod raw shape and turns it back into JSON
 * Schema for the model, so a definition written as JSON Schema - which is
 * what the protocol declares - has to make the round trip. Only the shapes a
 * tool argument is: everything else is a string, which is what an unschema'd
 * argument would have been anyway.
 */
const shaped = (property: object): z.ZodTypeAny => {
  const kind = str((property as Bag).type);
  const of = (property as Bag).items;
  if (kind === 'number' || kind === 'integer') return z.number();
  if (kind === 'boolean') return z.boolean();
  if (kind === 'array') return z.array(of === undefined ? z.string() : shaped(bag(of)));
  return z.string();
};

/**
 * Where the CLI names the call it is running, on a handler's `extra`.
 *
 * The same key VS Code reads, and the only thing that says which of two
 * identical concurrent calls a handler was invoked for. It rides under the
 * CLI's own namespace because the SDK passes the request's `_meta` through
 * without promising anything about what is in it.
 */
const TOOL_USE_ID = 'claudecode/toolUseId';

/** The call the CLI said this handler was running, when it said one. */
const namedBy = (extra: unknown): string | undefined => {
  const meta = (extra as { _meta?: Record<string, unknown> } | undefined)?._meta;
  const id = meta?.[TOOL_USE_ID];
  return typeof id === 'string' && id !== '' ? id : undefined;
};

/** A client's answer, and the call it answers. */
export interface Claimed {
  answer: ClientCallAnswer;
  /** The CLI's id for the call, which is what the entry is held under. */
  callId: string;
}

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
  /** Hand a call to the client that provides it, and wait for what it says. */
  byClient: (tool: BoundTool, input: Bag, extra: unknown) => Promise<Claimed>,
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
         * `extra` is where the CLI names the call, which is the only thing that
         * tells two identical concurrent calls of one tool apart.
         */
        if (one.owner !== undefined) {
          const { answer, callId } = await byClient(one, input, extra);
          /*
           * The client's whole answer, in the vocabulary an agent reads.
           *
           * A text block is a text block, an image is an image, and a file is
           * a resource blob - where this used to hand the model the joined
           * words and drop everything else the client sent.
           */
          return {
            // MCP's own shapes, built from the protocol's - the SDK's union is
            // narrower than the protocol's and this is where the two meet.
            content: toMcpContent(answer, callId) as never,
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
  /**
   * The call the CLI has just reported running, held for the client that owns it.
   *
   * Opened where the running ready goes out, and not where the call is first
   * announced: a call `canUseTool` asks about is not running until it is
   * approved, and an entry raised for one would tell a client to run a tool
   * the person has not allowed yet.
   *
   * This is also where a handler waiting for the call is joined to it, whichever
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
  refuseCall: (toolName: string, id: string, why: string) => void;
  /** Every outstanding client call, answered the same way and forgotten. */
  releaseCalls: (why: string) => void;
  /** Run one tool where the client that provides it lives, and wait for it. */
  ranByClient: (tool: BoundTool, input: Bag, extra: unknown) => Promise<Claimed>;
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

  const clientToolOf = (toolName: string): { owner: string; name: string } | undefined => {
    const tool = offered(toolName);
    const owner = tool?.owner;
    if (tool === undefined || owner === undefined) return undefined;
    /*
     * `<clientId>__<name>` is what the model is offered, because two clients
     * in one session may both provide `openFile`. The client itself knows its
     * tool by the name it announced, and that is the name the entry carries
     * and every sentence about the call uses.
     */
    return { owner, name: tool.definition.name.slice(owner.length + 2) };
  };

  /*
   * The calls this chat has out with its clients, held in one place.
   *
   * The holder raises the entry on the session, keeps the answer that arrives
   * before the harness asks for it, times a call out and fails the calls of a
   * client that goes - all of which this session used to keep a private map
   * for, without the timeout and without the entry.
   */
  const calls = createClientCalls({
    chat: ctx.options.chatUri,
    emit: ctx.emit,
    // Absent only where a session is built by hand, and then the holder's own
    // ten minutes apply - the same answer the host resolves an unset one to.
    ...(ctx.options.clientToolTimeoutMs === undefined ? {} : { timeoutMs: ctx.options.clientToolTimeoutMs }),
    // Asked only when a client goes: the model is the one that has to know
    // that somebody else provides the tool its call was for.
    providers: (name) => ctx.offering
      .filter((one) => one.owner !== undefined && one.definition.name.endsWith(`__${name}`))
      .map((one) => String(one.owner)),
  });

  /*
   * Joining the call the model made to the handler that has to answer it.
   *
   * The two arrive separately and neither carries the other's name: the
   * assistant frame opens the call under the CLI's id, and the in-process MCP
   * handler was invoked with the input and nothing else. So they are matched
   * here, by tool name and then by the input itself, which tells two
   * concurrent calls of one tool apart. Whichever arrives first waits for the
   * other. A CLI new enough to hand the handler the call's own id does not
   * need this, and takes the id straight to `calls.wait`.
   */
  /** How a handler's wait for its call ends: with the call, or with why there is none. */
  type Joined = { id: string } | { refused: string };

  const unclaimed = new Map<string, { id: string; input: string }[]>();
  const expecting = new Map<string, ((joined: Joined) => void)[]>();

  /*
   * Which calls the frames have reported, for a handler that reads the id.
   *
   * With the CLI's own id there is nothing to join - there is only something
   * to wait for, because the handler and the frame are two frames and either
   * can be read first. A handler that arrives before the frame waits in
   * `asked`; one that arrives after is answered from `framed`. Only ids no
   * handler has come for yet are kept there, and past the cap the oldest goes,
   * so an aborted call of a long session does not pile up for ever.
   */
  const framed = new Set<string>();
  const asked = new Map<string, ((joined: Joined) => void)[]>();
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
      for (const go of waiting) go({ id });
      return;
    }
    framed.add(id);
    if (framed.size > KEEP_FRAMED) framed.delete(framed.values().next().value as string);
  };

  /** Wait for the frame to report the call this handler was handed the id of. */
  const untilOpen = (id: string): Promise<Joined> => {
    if (framed.delete(id)) return Promise.resolve({ id });
    return new Promise((resolve) => { asked.set(id, [...(asked.get(id) ?? []), resolve]); });
  };

  /** A call the frame has reported, for a handler that has come for it by name. */
  const opening = (toolName: string, id: string, written: string): void => {
    const waiting = expecting.get(toolName) ?? [];
    const first = waiting.shift();
    expecting.set(toolName, waiting);
    if (first) { first({ id }); return; }
    unclaimed.set(toolName, [...(unclaimed.get(toolName) ?? []), { id, input: written }]);
  };

  const claim = (toolName: string, input: Bag): Promise<Joined> => {
    const open = unclaimed.get(toolName) ?? [];
    const written = JSON.stringify(input);
    const at = open.findIndex((one) => one.input === written);
    const took = at >= 0 ? open.splice(at, 1)[0] : open.shift();
    unclaimed.set(toolName, open);
    if (took !== undefined) return Promise.resolve({ id: took.id });
    return new Promise((resolve) => {
      expecting.set(toolName, [...(expecting.get(toolName) ?? []), resolve]);
    });
  };

  /**
   * One call's place in the joins, taken back, and whoever waits on it told.
   *
   * A handler parked on a call that will never open - the person refused it, or
   * the turn was stopped - is a tool call the model never gets back, so it is
   * answered with the reason instead. The call goes out of the maps as well: a
   * handler that joins later by name and input must not be handed this one.
   */
  const withdraw = (id: string, why: string, toolName: string): void => {
    for (const go of asked.get(id) ?? []) go({ refused: why });
    asked.delete(id);
    framed.delete(id);
    const open = unclaimed.get(toolName);
    if (open !== undefined) unclaimed.set(toolName, open.filter((one) => one.id !== id));
    // A handler that joined by name is waiting for that tool's calls in the
    // order they are made, so with none of them left this one was its call.
    if ((unclaimed.get(toolName) ?? []).length === 0) {
      for (const go of expecting.get(toolName) ?? []) go({ refused: why });
      expecting.delete(toolName);
    }
  };

  /** Every wait there is, ended at once: a turn that was stopped, or a chat that closed. */
  const refuseAll = (why: string): void => {
    for (const waiting of asked.values()) for (const go of waiting) go({ refused: why });
    for (const waiting of expecting.values()) for (const go of waiting) go({ refused: why });
    asked.clear();
    expecting.clear();
    unclaimed.clear();
    framed.clear();
    noEntry.clear();
  };

  const openCall = (toolName: string, turnId: string, id: string, line: StringOrMarkdown, input: string | undefined): void => {
    const tool = clientToolOf(toolName);
    if (tool === undefined) return;
    // A call a person is deciding about, or has refused, is not one any client
    // runs: no entry, and nothing for a handler to wait for.
    if (noEntry.has(id)) return;
    /*
     * The call exists now, and this is the one place that says so: a handler
     * waiting on this id, or on this tool and these arguments, is waiting for
     * exactly this. Registered here rather than where the frame is first read,
     * because a call a person approved is one the frame has already skipped.
     */
    opened(id);
    opening(toolName, id, input ?? '{}');
    calls.open({
      turnId,
      owner: tool.owner,
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

  const refuseCall = (toolName: string, id: string, why: string): void => {
    noEntry.add(id);
    const owner = calls.owner(id);
    // The owner was never asked, so this session answers for it: the call ends
    // here rather than being left open for a client that will not run it.
    if (owner !== undefined) calls.complete(id, owner, refusedAnswer(why));
    withdraw(id, why, toolName);
  };

  const releaseCalls = (why: string): void => {
    calls.release(why);
    // The joins as well as the calls: a handler waiting for a frame that will
    // not come is the other half of a turn left hanging.
    refuseAll(why);
  };

  const ranByClient = async (tool: BoundTool, input: Bag, extra: unknown): Promise<Claimed> => {
    const named = namedBy(extra);
    let joined: Joined;
    if (named !== undefined) {
      // The call this handler is for, by the CLI's own name for it - so it
      // waits for that call to be opened and never for somebody else's.
      joined = await untilOpen(named);
    }
    else {
      /*
       * A CLI that named no call, joined by tool name and then by the input.
       *
       * Said out loud rather than quietly: two identical calls of one tool
       * cannot be told apart this way, so whether this path is still needed is
       * a question about what the CLI sends, and only a live run answers it.
       */
      console.warn(`@ahpd/agent-claude: no ${TOOL_USE_ID} for ${tool.definition.name}; matching the call by tool name and input`);
      joined = await claim(called(tool.definition.name), input);
    }
    /*
     * Nothing to wait on: the call was refused, or the turn it was in stopped.
     * An answer rather than a throw, because a handler that rejects is a
     * transport failure and the model is never told what happened.
     */
    if ('refused' in joined) return { answer: refusedAnswer(joined.refused), callId: named ?? '' };
    const owner = tool.owner ?? '';
    ctx.doing(`Waiting on ${owner}: ${tool.definition.title ?? tool.definition.name}`);
    return { answer: await calls.wait(joined.id), callId: joined.id };
  };

  const methods: ClientTools['methods'] = {
    /**
     * The tools on offer, replaced whole.
     *
     * Whole because that is what the SDK takes: `setMcpServers` replaces the
     * set it is given, so a server rebuilt from one tool would take the others
     * away. Called when a client announces what it provides or stops being
     * active, which is the only thing that moves this list after a session is
     * built.
     */
    setTools: async (next) => {
      const before = ctx.offering.map((one) => `${one.definition.name}\u0000${one.owner ?? ''}`).join('\n');
      const after = next.map((one) => `${one.definition.name}\u0000${one.owner ?? ''}`).join('\n');
      if (before === after) return true;
      ctx.offering = [...next];
      if (ctx.offering.length > 0) ctx.declared.ahp = contributed(ctx.offering, ranByClient) as Bag;
      else delete ctx.declared.ahp;
      try { await ctx.handle.setMcpServers(ctx.declared as never); }
      catch { return false; }
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
  };

  return { clientToolOf, openCall, holdCall, allowCall, refuseCall, releaseCalls, ranByClient, calls, methods };
}
