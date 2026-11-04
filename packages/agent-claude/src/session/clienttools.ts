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
    for (const one of asked.get(id) ?? []) one.go({ refused: why });
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
    for (const waiting of asked.values()) for (const one of waiting) one.go({ refused: why });
    for (const waiting of expecting.values()) for (const go of waiting) go({ refused: why });
    asked.clear();
    expecting.clear();
    unclaimed.clear();
    framed.clear();
    noEntry.clear();
  };

  /**
   * Every wait for one tool, ended at once, because nothing will open it now.
   *
   * The tool is no longer on offer - its client left, or the frame for a call
   * of it names one nothing offers - so a handler parked on a call that will
   * never open is answered with the reason rather than left until the turn is
   * stopped. Both joins go: a handler waiting on the call's id, and one that
   * joined by the tool's name and has not been handed a call yet.
   */
  const refuseJoins = (toolName: string, why: string): void => {
    for (const [id, waiting] of asked) {
      const here = waiting.filter((one) => one.tool === toolName);
      if (here.length === 0) continue;
      for (const one of here) one.go({ refused: why });
      const rest = waiting.filter((one) => one.tool !== toolName);
      if (rest.length === 0) asked.delete(id);
      else asked.set(id, rest);
    }
    unclaimed.delete(toolName);
    for (const go of expecting.get(toolName) ?? []) go({ refused: why });
    expecting.delete(toolName);
  };

  const openCall = (toolName: string, turnId: string, id: string, line: StringOrMarkdown, input: string | undefined): void => {
    const tool = clientToolOf(toolName);
    if (tool === undefined) {
      // Nothing offers this tool, so nothing will open this call: a handler
      // already waiting on it, by id or by name, is told that rather than left
      // until the turn is stopped.
      const none = `Nothing here offers ${toolName}.`;
      for (const one of asked.get(id) ?? []) one.go({ refused: none });
      asked.delete(id);
      refuseJoins(toolName, none);
      return;
    }
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
      joined = await untilOpen(named, called(tool.definition.name));
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
    return { answer: await calls.wait(joined.id), callId: joined.id };
  };

  /** One change of tools, sent to the CLI: `setTools` says when, and why in two declarations. */
  const retool = async (offered: BoundTool[]): Promise<boolean> => {
    const next = takes(offered);
    const before = ctx.offering.map((one) => `${one.definition.name}\u0000${one.owner ?? ''}`).join('\n');
    const after = next.map((one) => `${one.definition.name}\u0000${one.owner ?? ''}`).join('\n');
    if (before === after) return true;
    // Without `ahp`: the declaration the SDK disconnects the old one on.
    const removed: Record<string, Bag> = { ...ctx.declared };
    delete removed.ahp;
    const declared: Record<string, Bag> = { ...removed };
    if (next.length > 0) declared.ahp = contributed(next, ranByClient) as Bag;
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
    catch { return false; }
    ctx.offering = [...next];
    ctx.declared = declared;
    return true;
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
     *
     * `ahp` goes out in two declarations and not one, because the SDK connects
     * only a server name it has not registered yet and `ahp` was registered
     * when the session started: the first call leaves it out, which is what
     * makes the SDK disconnect it, and the second carries the new one, which is
     * what makes the SDK connect that. Between the two the CLI has no `ahp`
     * server, so a session tool called in that moment fails. A list
     * with nothing in it is the first call alone, there being no server to add
     * back, and a session with no `ahp` yet is the second alone.
     *
     * Each declaration is built on the side and kept only once the SDK has
     * taken it, so a `setMcpServers` that refuses - a session whose CLI has
     * gone, or one that says no to this set - leaves the session holding what
     * the CLI actually has. A removal that took and an add that did not leaves
     * it holding the set without `ahp`, and the list that failed comes again as
     * a change to send rather than one already sent.
     *
     * One change at a time, in the order they came, and a turn's prompt after
     * the last of them: the protocol applies a session's actions in one order,
     * so a turn a client sends after announcing its tools is a turn of a
     * session that has them, as the reference rebuilds its query with the new
     * tools before it sends a turn. The host does not wait for a change to
     * land, so the session holds the one in hand as `retooling`, a change goes
     * out at once when none is in hand and after it otherwise, and
     * `beginTurn` waits for it.
     * https://github.com/microsoft/vscode/blob/3a2421399905c0c044dade3048a797d1e9ba33d4/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1089-L1105
     */
    setTools: (next) => {
      const took = ctx.retooling === undefined ? retool(next) : ctx.retooling.then(() => retool(next));
      const landed = took.then(() => undefined, () => undefined);
      ctx.retooling = landed;
      void landed.then(() => { if (ctx.retooling === landed) ctx.retooling = undefined; });
      return took;
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
     * yet, so a handler is still waiting in the joins for a client that is no
     * longer there to answer. Those are ended here, with the sentence the
     * holder uses for the same news, so both halves of one call read the same.
     *
     * Every tool whose name is this client's, by the prefix the model is
     * offered under. The tools may already be gone from `offering` - the host
     * takes them out in the same breath - so the joins are asked, not the list.
     */
    clientGone: (clientId) => {
      const why = `The client ${clientId} that was running the tool is no longer here`;
      // Every tool a handler is waiting on: by name in `expecting` and
      // `unclaimed`, and by call id in `asked`, which carries the tool with the
      // wait so a client that leaves can be told which of its tools those are.
      const waited = [...expecting.keys(), ...unclaimed.keys(), ...[...asked.values()].flat().map((one) => one.tool)];
      for (const toolName of new Set(waited)) {
        if (toolName.startsWith(called(`${clientId}__`))) refuseJoins(toolName, why);
      }
      calls.methods.clientGone(clientId);
    },
  };

  return { clientToolOf, openCall, holdCall, allowCall, refuseCall, releaseCalls, ranByClient, calls, methods };
}
