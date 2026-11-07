import type { Store, RunHandle } from '@cofold/agents';
import type { Bag, BoundTool, Chosen, MessageAttachment, MessageFrom, Start, TurnOptions } from '@ahpd/sdk';
import type { CofoldOptions, Held } from './agent.js';
import type { HarnessConfig } from './config.js';
import type { OpenRequest, TurnMapping } from './mapping.js';
import type { TurnAgent } from './turnagent.js';
import type { Runs } from './runs.js';
import type { Pauses } from './pauses.js';
import type { Turns } from './turns.js';

/** A turn handed while a run held another: what `sendMessage` was handed. */
export interface PendingTurn {
  turnId: string;
  text: string;
  model?: Chosen | undefined;
  from?: MessageFrom | undefined;
  attachments?: MessageAttachment[] | undefined;
  options?: TurnOptions | undefined;
}

/**
 * Everything an area of a cofold session reaches for, in one object.
 *
 * Built once in `cofoldSession` and handed to every area's factory, the way a
 * host tool is handed a `ToolCall`. A `let` in the closure that crosses into
 * another file is a field here, and it is read as `ctx.<name>` where it is
 * used rather than copied onto the factory's own scope at construction - so
 * the order the areas are built in never matters and nothing is frozen.
 */
export interface SessionContext extends TurnAgent, Runs, Pauses, Turns {
  options: CofoldOptions;
  start: Start;
  harness: HarnessConfig;
  provider: string;
  sessionId: string;
  where: string;
  store: Store;
  /**
   * The backend's catalogue and the transport it was read through, when a
   * backend built this session.
   *
   * A turn's model is built through the same provider the catalogue came from,
   * with the price the list published; a session built by a caller that named
   * none has nothing here and its turns build an adapter of their own.
   */
  held: Held | undefined;
  turns: Bag[];
  editing: Map<string, string>;
  pending: Map<string, OpenRequest>;
  points: Map<string, string>;
  /** The references the host answered for the images replies carried, by message id and place. */
  kept: Map<string, Bag>;
  /** The steering message the run was handed and has not read yet, by its id, whose removal is said once it reads it. */
  steering: { id: string } | undefined;
  /**
   * The steering messages a client took back while the run still held them.
   *
   * cofold's submit gives a steer back only by rejecting it, so one taken back
   * is answered nowhere when it comes back, as the reference host has its
   * provider withdraw a steering message a client removes after handing it over.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L165-L173
   */
  withdrawn: Set<string>;
  /** The config values in force, by key, which the next turn's agent is built from. */
  values: Record<string, unknown>;
  /**
   * Set the chat's `modifiedAt`, where the protocol's reducer sets it and
   * nowhere else: to a turn's start as it starts, and to its start plus its
   * duration as it ends.
   */
  setModifiedAt: (at: string) => void;
  /**
   * Read the record again, for a backend opened from one.
   *
   * Puts what the record says now on `options`, which the turn that follows
   * builds from, and answers a sentence when the record can no longer be used.
   * A backend an embedder built from its own options has nothing to read and
   * answers nothing.
   */
  refreshOptions: () => string | undefined;
  /**
   * The tools the model is offered.
   *
   * Mutable because a client announces what it provides after the session is
   * built, and the host re-declares the whole set through `setTools`. An
   * agent is built per turn from this, so a tool announced mid-turn is
   * offered from the turn after it.
   */
  offered: BoundTool[];
  active: Bag | undefined;
  /**
   * The turns handed while a run held another, in the order they came, each
   * run once the turn in front of it is over: one run reads the session at a
   * time, as the reference agent runs each send after the one before it. The
   * host said each start, so the turn it took the place of runs on here. VS
   * Code's Copilot agent holds such sends as its pending turns.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1810-L1814
   */
  pendingTurns: PendingTurn[];
  /** The turns a later one took the place of, which run on and end in no history. */
  replaced: Set<string>;
  /**
   * The run behind `active`, so a cancel, an answer and a steer have something
   * to reach.
   *
   * One handle serves a turn from its start to its last `run.finished`,
   * including the pauses in between: a paused run keeps the handle that
   * started it, and that handle is what takes the answer.
   */
  handle: RunHandle | undefined;
  /** The active turn's mapping, so an answer can settle the entries it opened. */
  activeMapping: TurnMapping | undefined;
  /** Whether a client asked to stop, read by the mapping when the run ends. */
  cancelRequested: boolean;
  /** The error the last turn failed with, or nothing. Cleared when a turn starts. */
  error: string | undefined;
  title: string;
  /** Whether the title is one a local command suggested, which the first real message replaces. */
  provisional: boolean;
  modified: string;
  /** Whether the session was disposed, after which no turn starts. */
  disposed: boolean;
  /**
   * Whether the lookup of a run a restart left paused is still being made.
   *
   * A turn that began before the paused run was found would not know to let
   * that run go first. Everything that would begin a turn waits on this.
   */
  opening: Promise<void> | undefined;
  /**
   * The run a restart left paused on a person, whose turn reads back
   * interrupted: a client's resume of that turn continues it, and a new turn
   * lets it go.
   */
  paused: { turnId: string; runId: string; requestId: string } | undefined;
  /**
   * The running turn's earlier time and usage when a client resumed it, and
   * when it ran again, so the turn holds its time and usage across both runs.
   */
  resumedFrom: { duration: number; at: number; usage: Bag | undefined } | undefined;
}