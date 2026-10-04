import type { Agent } from '../types/agent.js';
import type { Bag } from '../types/common.js';
import type { Session } from '../types/session.js';

/**
 * A live session: one or more chats, and what they all run on.
 *
 * The protocol's session is a *container*. It was one conversation here
 * because one backend session is one CLI, and the two were collapsed - so a
 * second chat had nowhere to go.
 */
export interface Held {
  /** The backend running it. */
  agent: Agent;
  /** Its chats, by URI, in the order they were opened. */
  chats: Map<string, Session>;
  /** Which of them a client gets when it names none. */
  defaultChat: string;
  /** Config in force. Every chat in the session runs on it. */
  config: Record<string, unknown>;
  /** Where they work, when the client named a directory. */
  workingDirectory: string | undefined;
  /**
   * The peers of that directory, which the agent may also work in.
   *
   * Held here as well as inside each chat because a restart rebuilds the
   * chats and has to hand them back what they had.
   */
  additional: string[] | undefined;
  /**
   * ISO 8601, when the session was first started.
   *
   * Not when it last moved. `createdAt` is an identity field - the protocol
   * says it never changes, and that it MUST be left out of a summary
   * *change* - and this used to be answered with the modification time, so a
   * row's age moved every time somebody said something to it. A resumed
   * session takes the catalogue's value rather than the moment it was
   * resumed, because it was not created then either.
   */
  createdAt: string;
}

/**
 * The worker chats this host opened, by URI.
 *
 * Not in `held.chats`, because a worker has no `Session` of its own: it is a
 * conversation inside one call of another chat, and everything it says
 * arrives through the emitter the backend was handed. What is kept here is the
 * row a catalogue lists and the state a subscriber reads, reduced from the
 * actions the backend emitted - the same reducer a client runs, so the
 * two cannot disagree.
 */
export interface LiveSubagent {
  /** The session holding it. */
  session: string;
  /** The chat the spawning call is in. */
  parentChat: string;
  /** The call that spawned it. */
  toolCallId: string;
  title: string;
  agentName?: string;
  description?: string;
  /** The turn the host opened, which every part of this worker's names. */
  turnId: string;
  /** When it opened, which is the duration of a turn ended without one. */
  openedAt: number;
  /** Its `ChatState`, as the reducer leaves it. */
  state: Bag;
}

/**
 * What one backend turned out to offer.
 *
 * Advertised on the *root* channel, but only a live backend can enumerate
 * it - so it is empty until its probe answers, and that emptiness is a real
 * answer rather than a loading state. When it fills, every client watching
 * the root is told with `root/agentsChanged`.
 */
export interface Learned {
  /** Models a turn can run on, and what each can be told to do differently. */
  models: { id: string; name: string; configSchema?: Record<string, unknown> }[];
  /** What a slash offers when no session of this backend is running. */
  commands: { name: string; description?: string; argumentHint?: string }[];
  /**
   * Skills, commands, subagents and MCP servers, as the probe found them.
   *
   * What every new session reports until its own backend answers. That takes
   * several seconds, and a client asks once - so a session that started
   * empty stayed empty for anyone who looked before the reply landed.
   */
  seeds: Bag[];
}

/** Which client's dispatch an action is the echo of. */
export interface Origin {
  clientId: string;
  clientSeq: number;
}

/** What a name this host holds is. */
export type NameKind = 'session' | 'chat' | 'terminal' | 'watch';

/** A name in `claims`: its kind, and the session it belongs to for a session's or a chat's name. */
export interface Claimed { kind: NameKind; of: string }

/**
 * A map whose keys are names this host holds, each claimed in `claims` when
 * it is set and released when it is deleted.
 *
 * A key another kind already claims keeps that claim. Deleting a session
 * releases every name claimed as belonging to it.
 */
export class Claiming<V> extends Map<string, V> {
  private readonly claims: Map<string, Claimed>;
  private readonly kind: NameKind;
  private readonly ofOf: (key: string, value: V) => string;

  constructor(claims: Map<string, Claimed>, kind: NameKind, ofOf: (key: string, value: V) => string = (key) => key) {
    super();
    this.claims = claims;
    this.kind = kind;
    this.ofOf = ofOf;
  }

  override set(key: string, value: V): this {
    if (!this.claims.has(key)) this.claims.set(key, { kind: this.kind, of: this.ofOf(key, value) });
    return super.set(key, value);
  }

  /** Deleted from the map with its claim kept, for a key about to be set again. */
  drop(key: string): boolean {
    return super.delete(key);
  }

  override delete(key: string): boolean {
    if (this.claims.get(key)?.kind === this.kind) this.claims.delete(key);
    if (this.kind === 'session') {
      for (const [name, held] of this.claims) if (held.of === key) this.claims.delete(name);
    }
    return super.delete(key);
  }
}
