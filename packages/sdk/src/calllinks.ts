import type { Bag } from './types/common.js';

/**
 * The side index a worker's link is written from.
 *
 * A worker's chat is opened while a call in another chat is running, and the
 * action that links them names the turn that call is in and carries the call's
 * whole content - neither of which this host otherwise holds, because the
 * backend keeps its own turns. It is fed from `dispatch`, the one funnel every
 * chat action passes through, the backend's own emitter included.
 */
export interface CallLinks {
  /** Fold one action dispatched on a chat into the index. */
  observe(chat: string, action: Bag): void;
  /** The open turn of a chat, when it has one. */
  turnOf(chat: string): string | undefined;
  /** What a call's `content` last held, when the call is one the index keeps. */
  contentOf(chat: string, toolCallId: string): Bag[] | undefined;
  /** Set a call's content, which also makes it one the index keeps. */
  hold(chat: string, toolCallId: string, content: Bag[]): void;
  /** Drop one call. */
  forget(chat: string, toolCallId: string): void;
  /** Drop a chat's open turn and every call held in it. */
  forgetChat(chat: string): void;
  /** How many calls the index holds. */
  readonly size: number;
}

/** Whether a tool call action names a call that spawns a worker. */
const isSpawning = (action: Bag): boolean => {
  const meta = action._meta;
  return typeof meta === 'object' && meta !== null && (meta as Bag).toolKind === 'subagent';
};

/** The key one call is held under: its chat and its id. */
const aboutCall = (chat: string, toolCallId: string): string => `${chat}\u0000${toolCallId}`;

/**
 * An empty index.
 *
 * `turns` is the open turn of each chat, by chat URI. `calls` is what each
 * spawning call's `content` last held, by chat and call, which is what a
 * `subagent` content is appended to. A call is a spawning call when its start
 * or ready action carries `_meta.toolKind: 'subagent'`, or when a link was
 * written onto it; no other call's content is kept.
 */
export function createCallLinks(): CallLinks {
  const turns = new Map<string, string>();
  const calls = new Map<string, Bag[]>();
  return {
    observe(chat, action) {
      if (action.type === 'chat/turnStarted' && typeof action.turnId === 'string') {
        turns.set(chat, action.turnId);
      }
      else if (action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled'
        || action.type === 'chat/error') {
        if (turns.get(chat) === action.turnId) turns.delete(chat);
      }
      const named = typeof action.toolCallId === 'string' ? action.toolCallId : undefined;
      if (named === undefined) return;
      const key = aboutCall(chat, named);
      if ((action.type === 'chat/toolCallStart' || action.type === 'chat/toolCallReady')
        && isSpawning(action)) {
        if (!calls.has(key)) calls.set(key, []);
        return;
      }
      if (!calls.has(key)) return;
      if (action.type === 'chat/toolCallContentChanged' && Array.isArray(action.content)) {
        calls.set(key, action.content as Bag[]);
      }
      else if (action.type === 'chat/toolCallComplete') {
        const result = action.result as Bag | undefined;
        if (Array.isArray(result?.content)) calls.set(key, result.content as Bag[]);
      }
    },
    turnOf: (chat) => turns.get(chat),
    contentOf: (chat, toolCallId) => calls.get(aboutCall(chat, toolCallId)),
    hold(chat, toolCallId, content) {
      calls.set(aboutCall(chat, toolCallId), content);
    },
    forget(chat, toolCallId) {
      calls.delete(aboutCall(chat, toolCallId));
    },
    forgetChat(chat) {
      turns.delete(chat);
      const prefix = `${chat}\u0000`;
      for (const key of [...calls.keys()]) if (key.startsWith(prefix)) calls.delete(key);
    },
    get size() { return calls.size; },
  };
}
