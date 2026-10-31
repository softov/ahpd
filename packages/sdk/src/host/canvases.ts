import { canvasResource } from './channels.js';
import { isWebUrl } from '../weburl.js';
import type { CanvasReference, CanvasState } from '@microsoft/agent-host-protocol';

/*
 * The canvases a chat shows.
 *
 * A canvas is the chat's, not the host's: its name carries the chat in
 * base64url, the chat's state lists it, and it goes when the chat does. The
 * store holds what a plugin opened and the state it gave, and it is the one
 * place either is written - a plugin's own record would be a second answer to
 * a question the chat state already answers.
 *
 * In memory only. A canvas names a URL that a plugin's own process answers, so
 * a restarted host can keep neither the URL nor the canvas, and the protocol
 * says a URL is not reused after a provider or host restart.
 * https://github.com/microsoft/agent-host-protocol/blob/main/types/channels-canvas/state.ts
 */

/** What the store reaches for, which is the host's own two answers. */
export interface CanvasHost {
  /** Say one action on one channel, the way every host-owned chat action goes. */
  dispatch(channel: string, action: Record<string, unknown>): void;
  /**
   * Whether this host still holds a chat.
   *
   * Asked when a chat's canvases are forgotten, because the two roads are not
   * the same: a chat that is gone is said nothing to, and one that moved is
   * still there to be told its list is now empty.
   */
  holds(chat: string): boolean;
  /**
   * Whether this host serves canvases at all.
   *
   * `canvasesEnabled`, which is off by default. Read at each call rather than
   * at start, because a window may turn it on while the daemon runs; a canvas
   * that is already open stays open when it is turned off again.
   */
  enabled(): boolean;
}

/** The canvases of every chat, and what a plugin may do with them. */
export interface Canvases {
  /**
   * Open a canvas on a chat, or draw an open one again.
   *
   * Answers the channel. A canvas already open on the chat under the same
   * `instanceId` keeps its channel and is drawn again; any other gets a new
   * one, and the chat's list is said whole after it.
   */
  open(chat: string, state: CanvasState, by: string): string;
  /** Replace the state of a canvas this plugin opened, whole. */
  update(resource: string, state: CanvasState, by: string): void;
  /** Take a canvas off its chat. A canvas that is already gone stays gone. */
  close(resource: string, by: string): void;
  /**
   * Take every canvas of one plugin off its chat.
   *
   * The host's own road, taken when it unloads a plugin: it is not the plugin's
   * call, so it is not refused by `canvasesEnabled` - a plugin that unloads
   * while the key is off still takes the canvases it opened with it.
   */
  closeAll(by: string): void;
  /** The state of one canvas this host holds, or nothing when it holds none. */
  snapshot(resource: string): CanvasState | undefined;
  /** The chat's canvases, in the order they were opened, or nothing when it has none. */
  listOf(chat: string): CanvasReference[] | undefined;
  /** The chat a held canvas belongs to. */
  chatOf(resource: string): string | undefined;
  /** Let every canvas of one chat go, saying nothing when the chat itself has gone. */
  forgetChat(chat: string): void;
}

/** One canvas, as the store keeps it. */
interface HeldCanvas {
  /** The channel it is served on. */
  resource: string;
  /** The chat whose state lists it. */
  chat: string;
  /** The plugin that opened it, and the only one that may change or close it. */
  by: string;
  /** What the plugin last gave, as the value that was given. */
  state: CanvasState;
}

export function createCanvases(ctx: CanvasHost): Canvases {
  /** Every canvas this host holds, by its channel. */
  const held = new Map<string, HeldCanvas>();
  /** Each chat's canvases, by chat, in the order they were opened. */
  const chats = new Map<string, string[]>();

  /**
   * A chat's list as the chat state carries it, or nothing when it has none.
   *
   * A new array each call, because one list goes into a snapshot and another
   * into an action kept for replay: shared, one would be the other written
   * twice.
   */
  const listOf = (chat: string): CanvasReference[] | undefined => {
    const resources = chats.get(chat);
    return resources === undefined ? undefined : resources.map((resource) => ({ resource }));
  };

  /** Say a chat's list whole, which is the one action a list change is. */
  const announce = (chat: string): void => {
    ctx.dispatch(chat, { type: 'chat/canvasesChanged', canvases: listOf(chat) });
  };

  /**
   * Take one canvas out of both maps, saying nothing.
   *
   * The one place a canvas goes, so the resource and the chat's list cannot
   * disagree about what is open.
   */
  const drop = (one: HeldCanvas): void => {
    held.delete(one.resource);
    const resources = chats.get(one.chat);
    if (resources === undefined) return;
    const at = resources.indexOf(one.resource);
    if (at >= 0) resources.splice(at, 1);
    if (resources.length === 0) chats.delete(one.chat);
  };

  /** Refuse a call while this host has canvases turned off. */
  const callable = (): void => {
    if (!ctx.enabled()) throw new Error('Canvases are disabled.');
  };

  /**
   * Check the state a plugin gave, and name the method that gave it.
   *
   * A `CanvasState` is the plugin's whole claim about the canvas, and the host
   * draws it: an unidentified one could not be drawn again under its instance,
   * and a URL that a client cannot reach is a canvas that shows nothing. The
   * URL itself is kept out of the sentence, because the host does not write one
   * anywhere.
   */
  const check = (method: string, by: string, state: CanvasState): void => {
    for (const member of ['instanceId', 'extensionId', 'canvasId'] as const) {
      const value: unknown = state?.[member];
      if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`plugin ${by}: ${method} needs state.${member} to be a non-empty string`);
      }
    }
    const url = state.url;
    if (url === undefined) return;
    if (!isWebUrl(url)) {
      throw new Error(`plugin ${by}: ${method} needs state.url to be an absolute http(s) URL with a host`);
    }
  };

  const open = (chat: string, state: CanvasState, by: string): string => {
    callable();
    if (!ctx.holds(chat)) {
      throw new Error(`plugin ${by}: openCanvas needs a chat this host has live, and ${chat} is not one`);
    }
    check('openCanvas', by, state);
    const resources = chats.get(chat) ?? [];
    const same = resources.find((resource) => held.get(resource)?.state.instanceId === state.instanceId);
    const resource = same ?? canvasResource(chat, crypto.randomUUID());
    if (same === undefined) {
      resources.push(resource);
      chats.set(chat, resources);
    }
    const canvas: HeldCanvas = {
      resource,
      chat,
      // A canvas stays the opener's. A second open under the same instance
      // draws it again and takes no ownership, so the plugin that made it is
      // still the one that may change or close it.
      by: same === undefined ? by : (held.get(same)?.by ?? by),
      state: structuredClone(state),
    };
    held.set(resource, canvas);
    /*
     * The canvas first, then the list that names it: a client which hears the
     * chat hold a resource can subscribe to a channel that already answers.
     * https://github.com/microsoft/vscode/blob/e646868227c/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1077-L1100
     */
    ctx.dispatch(resource, { type: 'canvas/stateChanged', canvas: canvas.state });
    if (same === undefined) announce(chat);
    return resource;
  };

  const update = (resource: string, state: CanvasState, by: string): void => {
    const one = held.get(resource);
    // A canvas that is gone cannot be drawn again: its chat no longer lists
    // it, so a client that never heard of it would be told a state for
    // nothing. A call that raced a close says nothing rather than failing.
    if (one === undefined) return;
    callable();
    check('updateCanvas', by, state);
    if (one.by !== by) throw new Error(`plugin ${by}: ${resource} was opened by ${one.by}`);
    one.state = structuredClone(state);
    ctx.dispatch(resource, { type: 'canvas/stateChanged', canvas: one.state });
  };

  const close = (resource: string, by: string): void => {
    const one = held.get(resource);
    // Gone, and so nothing to do: two closes may meet, and the second is the
    // one that says nothing - even while the key is off, because a call with
    // nothing to close is not a call the store takes.
    if (one === undefined) return;
    callable();
    if (one.by !== by) throw new Error(`plugin ${by}: ${resource} was opened by ${one.by}`);
    drop(one);
    // The list whole, or absent when this was the last one: the protocol's
    // absence means none, and a client that kept an empty list would go on
    // drawing nothing rather than forget.
    announce(one.chat);
  };

  const closeAll = (by: string): void => {
    const touched = new Set<string>();
    for (const one of [...held.values()]) {
      if (one.by !== by) continue;
      drop(one);
      touched.add(one.chat);
    }
    // One action for each chat, after every drop, so a chat that lost two
    // canvases is not told two lists in a row.
    for (const chat of touched) announce(chat);
  };

  const forgetChat = (chat: string): void => {
    for (const resource of chats.get(chat) ?? []) held.delete(resource);
    chats.delete(chat);
    // A chat this host still holds - one that moved to another session - is
    // told its list is now empty. One that is gone is told nothing: nothing
    // can reach its channel any more, and an action on a dead chat is noise.
    if (ctx.holds(chat)) announce(chat);
  };

  return {
    open,
    update,
    close,
    closeAll,
    snapshot: (resource) => held.get(resource)?.state,
    listOf,
    chatOf: (resource) => held.get(resource)?.chat,
    forgetChat,
  };
}
