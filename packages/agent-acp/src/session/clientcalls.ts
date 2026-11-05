import { createClientCalls as holder } from '@ahpd/sdk';
import type { Bag, BoundTool, ClientCalls as Held, RunClientTool } from '@ahpd/sdk';
import { HOST_SERVER } from '../mapping.js';
import type { AcpCall } from '../types.js';
import { bag } from './common.js';
import type { SessionContext } from './context.js';

/**
 * Where an agent names the call it is making, on a `tools/call`'s `_meta`.
 *
 * The key the Claude CLI's own tool server reads, and the one an agent that
 * carries it uses here: a `tools/call` holds a tool and some arguments and
 * nothing else, so this is the only thing in one that says which of two
 * identical concurrent calls it was made for.
 */
export const TOOL_USE_ID = 'claudecode/toolUseId';

/** What this area offers the rest of the session, and the `Session` members it brings. */
export interface ClientCalls {
  /**
   * Which client's tool the agent reported a call for, if any.
   *
   * Nothing for a call that is not a client's: the host's own tools ride the
   * same server and are nobody's to run.
   */
  ownerOf: (name: string | undefined, title: string) => string | undefined;
  /**
   * Hold a call a client owns, so the entry asking it goes out.
   *
   * Called where the ready says the call is running, and at the approval for a
   * call the person was asked about first.
   */
  openCall: (call: AcpCall, turnId: string) => void;
  /** The one place this session's client calls are held, for the snapshot and above. */
  calls: Held;
  /**
   * Run one tool where the client that provides it lives, and wait for it.
   *
   * What the host's tool server is handed, because it is the thing that
   * receives the agent's `tools/call` and has nothing to run a client's tool
   * with: it finds the call the request is for and hands back what the owner
   * said.
   */
  ranByClient: RunClientTool;
  /**
   * The tools this session may offer, replaced whole.
   *
   * Whole because that is how the host sends them: a client announces what it
   * provides or stops being active, and what a session may offer is the
   * session's rather than one chat's. The lookup a reported call is recognised
   * by reads this, and the endpoint the agent is served from is told the same
   * list, which is what lets a client that arrived after the session opened own
   * its calls and be called.
   */
  setTools: (tools: BoundTool[]) => Promise<boolean>;
}

export function createClientCalls(ctx: SessionContext): ClientCalls {
  /*
   * The calls this session has out with its clients, held in one place.
   *
   * The holder raises the entry on the session, keeps an answer that arrives
   * before the harness asks for it, times a call out, and fails the calls of a
   * client that goes - naming the other clients that have the tool, which is
   * why it is handed the offering rather than a list of names.
   */
  const calls = holder({
    chat: ctx.start.chatUri,
    emit: ctx.emit,
    timeoutMs: ctx.start.clientToolTimeoutMs,
    providers: (name) => ctx.offering
      .filter((one) => one.owner !== undefined && one.definition.name.endsWith(`__${name}`))
      .map((one) => String(one.owner)),
  });

  /**
   * The tool of a client's that what the agent said names, as it is offered.
   *
   * Whole or after the prefix, because the agent may say the name either way.
   * A tool nobody owns is not a client's: the host's own tools ride the same
   * server, and a schema the offering does not hold is nothing this session
   * ever offered.
   */
  const offered = (said: string): BoundTool | undefined => {
    const bare = said.startsWith(HOST_SERVER) ? said.slice(HOST_SERVER.length) : said;
    return ctx.offering.find((one) => one.owner !== undefined && one.definition.name === bare);
  };

  /**
   * Which client's tool the agent reported a call for.
   *
   * The name the agent gave is read before the title, and the title only when
   * it named none: an agent that said what the tool was called has said which
   * one it meant, so a title that happens to spell another client's tool is not
   * what it reported.
   */
  const ownerOf = (name: string | undefined, title: string): string | undefined =>
    offered(name ?? title)?.owner;

  /**
   * Ask the client that owns a call to run it.
   *
   * The call is held under the name the client announced its tool with, as
   * the chat's row names it, because that is the name the client answers to
   * and the name every sentence about the call uses. A tool the offering no
   * longer holds is no call to ask anybody about.
   */
  const openCall = (call: AcpCall, turnId: string): void => {
    const owner = call.owner;
    if (owner === undefined || offered(`${owner}__${call.toolName}`)?.owner !== owner) return;
    calls.open({
      turnId,
      owner,
      toolCall: {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        displayName: call.displayName,
        invocationMessage: call.displayName,
        // Nothing is being asked here: a call that runs at all has cleared its
        // confirmation gate.
        confirmed: 'not-needed',
        ...(call.input === undefined ? {} : { toolInput: call.input }),
      },
    });
  };

  /**
   * The call one `tools/call` is for.
   *
   * Three ways to find it, in this order: the id the agent put on the request,
   * the one open call of that tool, and the call whose arguments are the
   * request's. The id is what tells two identical concurrent calls apart, a
   * lone open call is the only thing a request that names no call can be for,
   * and the arguments tell apart two calls of one tool that were made for
   * different things - when the agent reported them, which it need not.
   *
   * A request no reported call can be for, and one two or more calls could be
   * for with nothing to choose between them, are answered with an error result,
   * as VS Code's client tool server answers a request it cannot name a call
   * for: a result never lands on another call, and the agent is told to make
   * the call again.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/clientTools/claudeClientToolMcpServer.ts#L46-L55
   */
  const callFor = (owner: string, name: string, input: Bag, meta: Bag | undefined): string => {
    const said = meta?.[TOOL_USE_ID];
    const id = typeof said === 'string' && said !== '' ? said : undefined;
    // Only one of this owner's own calls: an id that names another client's
    // call, or one already answered, says nothing about this request.
    if (id !== undefined && calls.owner(id) === owner) return id;
    const open = calls.entries()
      .filter((entry) => String(entry.clientId) === owner)
      .map((entry) => bag(entry.toolCall))
      .filter((call) => String(call.toolName) === name);
    if (open.length === 0) {
      throw new Error(`Client tool "${name}" could not run: the agent reported no call it is for, and the request names none (expected at _meta["${TOOL_USE_ID}"]).`);
    }
    // An agent that makes one call at a time, which is most of them, has
    // nothing else this request could be for.
    if (open.length === 1) return String(open[0]?.toolCallId);
    /*
     * More than one, so the arguments are all there is - and they are here only
     * when the agent said them. A call the agent reported with a title alone
     * carries no arguments, and matches none.
     */
    const written = JSON.stringify(input);
    const found = open.find((call) => call.toolInput === written);
    if (found !== undefined) return String(found.toolCallId);
    throw new Error(`${open.length} calls of ${owner}__${name} are open and the request names no call; nothing says which one this is for`);
  };

  /**
   * Run one tool where the client that provides it lives, and wait for it.
   *
   * What the host's tool server calls when a `tools/call` arrives for a tool a
   * client owns. The tool is offered under the client's id and the client's own
   * name, so the name the client answers to is that one stripped; the answer is
   * the owner's own words and blocks, which the server turns into the MCP
   * content the agent reads.
   */
  const ranByClient: RunClientTool = async (tool, input, meta) => {
    const owner = String(tool.owner ?? '');
    const name = tool.definition.name.slice(owner.length + 2);
    return await calls.wait(callFor(owner, name, input, meta));
  };

  /**
   * The tools this session may offer, replaced whole.
   *
   * Two places hold that list and both move: the offering, which is what a
   * reported call's owner is looked up in, and the endpoint, which is what the
   * agent is served from. They are one list seen from two sides, so a client
   * that arrives is a tool that can be recognised and a tool the agent can
   * call, or neither.
   */
  const setTools = async (tools: BoundTool[]): Promise<boolean> => {
    ctx.offering = [...tools];
    ctx.toolsEndpoint()?.setTools([...tools]);
    return true;
  };

  return { ownerOf, openCall, calls, ranByClient, setTools };
}
