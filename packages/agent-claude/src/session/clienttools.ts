import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Bag, BoundTool } from '@ahpd/sdk';
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
 * The host's tools, as an in-process MCP server the CLI can call.
 *
 * In-process: `createSdkMcpServer` registers the handlers here rather than
 * spawning anything, so a host tool is a function call. The result is handed
 * back as text, because that is the one content shape every model reads and
 * a host tool answering with anything richer would be answering in a shape
 * this host cannot check.
 */
export const contributed = (
  tools: BoundTool[],
  /** Hand a call to the client that provides it, and wait for what it says. */
  byClient: (tool: BoundTool, input: Bag) => Promise<{ text: string; ok: boolean }>,
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
      handler: async (input: Record<string, unknown>) => {
        /*
         * Somebody else's tool, run where it lives.
         *
         * A client that announced this one is the only thing that can run it -
         * it is the editor's own command, or a plugin's - so the call goes out
         * against that client and this waits. The wait is what makes the model
         * see a tool at all: an MCP handler that returned before the answer
         * came back would be answering on the client's behalf.
         */
        if (one.owner !== undefined) {
          const answer = await byClient(one, input);
          return {
            content: [{ type: 'text' as const, text: answer.text }],
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
  /** Which client provides a tool, by the name the CLI calls it. */
  providedBy: (toolName: string) => string | undefined;
  /** A call the model has opened and the handler has to answer. */
  opening: (toolName: string, id: string, input: Bag) => void;
  /** Every outstanding client call, answered the same way and forgotten. */
  releaseCalls: (why: string, whose?: string) => void;
  /** Run one tool where the client that provides it lives, and wait for it. */
  ranByClient: (tool: BoundTool, input: Bag) => Promise<{ text: string; ok: boolean }>;
  methods: {
    setTools: (tools: BoundTool[]) => Promise<boolean>;
    toolCallOwner: (toolCallId: string) => string | undefined;
    completeToolCall: (toolCallId: string, clientId: string, result: { text: string; ok: boolean }) => boolean;
    clientGone: (clientId: string) => void;
  };
}

export function createClientTools(ctx: SessionContext): ClientTools {
  /** The full name the CLI calls a contributed tool by. */
  const called = (name: string): string => `mcp__ahp__${name}`;
  const providedBy = (toolName: string): string | undefined =>
    ctx.offering.find((one) => called(one.definition.name) === toolName)?.owner;

  /*
   * Joining the call the model made to the handler that has to answer it.
   *
   * The two arrive separately and neither carries the other's name: the
   * assistant frame opens the call under the CLI's id, and the in-process MCP
   * handler is invoked with the input and nothing else - the SDK surfaces a
   * `toolUseID` to `canUseTool` and to hooks, and not to a tool. So they are
   * matched here, by tool name and then by the input itself, which tells two
   * concurrent calls of one tool apart. Whichever arrives first waits for the
   * other.
   */
  const unclaimed = new Map<string, { id: string; input: string }[]>();
  const expecting = new Map<string, ((id: string) => void)[]>();

  const opening = (toolName: string, id: string, input: Bag): void => {
    const waiting = expecting.get(toolName) ?? [];
    const first = waiting.shift();
    expecting.set(toolName, waiting);
    if (first) { first(id); return; }
    unclaimed.set(toolName, [...(unclaimed.get(toolName) ?? []), { id, input: JSON.stringify(input) }]);
  };

  const claim = (toolName: string, input: Bag): Promise<string> => {
    const open = unclaimed.get(toolName) ?? [];
    const written = JSON.stringify(input);
    const at = open.findIndex((one) => one.input === written);
    const took = at >= 0 ? open.splice(at, 1)[0] : open.shift();
    unclaimed.set(toolName, open);
    if (took !== undefined) return Promise.resolve(took.id);
    return new Promise((resolve) => {
      expecting.set(toolName, [...(expecting.get(toolName) ?? []), resolve]);
    });
  };

  /**
   * Calls a client is running for this session, by call id.
   *
   * Held for the same reason `pending` is: the thing that has to settle them
   * arrives later and from somewhere else, and anything that ends the turn has
   * to settle them itself or the CLI waits for ever on a promise nobody owns.
   */
  const byClient = new Map<string, { owner: string; settle: (answer: { text: string; ok: boolean }) => void }>();

  const releaseCalls = (why: string, whose?: string): void => {
    for (const [id, held] of [...byClient.entries()]) {
      if (whose !== undefined && held.owner !== whose) continue;
      byClient.delete(id);
      held.settle({ text: why, ok: false });
    }
  };

  const ranByClient = async (tool: BoundTool, input: Bag): Promise<{ text: string; ok: boolean }> => {
    const id = await claim(called(tool.definition.name), input);
    const owner = tool.owner ?? '';
    ctx.doing(`Waiting on ${owner}: ${tool.definition.title ?? tool.definition.name}`);
    return await new Promise((settle) => { byClient.set(id, { owner, settle }); });
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

    toolCallOwner: (toolCallId) => byClient.get(toolCallId)?.owner,

    /**
     * What a client says its own tool did.
     *
     * Only from the client the call was reported against: the protocol makes
     * that one responsible for the call, and a result from anybody else is a
     * client answering for work it did not do. Answered `false` either way -
     * for a call nobody is waiting on and for a client that does not own it -
     * because both are a client out of step, and the caller says which.
     *
     * Nothing is emitted here. The answer goes back to the CLI, the CLI writes
     * the tool result, and `results` reports the completion to everybody from
     * that - which is the same path every other tool call takes. A completion
     * announced here as well would be the same row finished twice.
     */
    completeToolCall: (toolCallId, clientId, result) => {
      const held = byClient.get(toolCallId);
      if (!held || held.owner !== clientId) return false;
      byClient.delete(toolCallId);
      held.settle(result);
      return true;
    },

    clientGone: (clientId) => {
      // A tool call whose client has gone is a turn waiting on a promise
      // nothing will settle. The agent is told it failed, which is true, and
      // is left to decide what to do about it.
      releaseCalls('The client that provides this tool is no longer here', clientId);
    },
  };

  return { providedBy, opening, releaseCalls, ranByClient, methods };
}
