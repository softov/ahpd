import type { Store, RunHandle } from '@cofold/agents';
import type { Bag, BoundTool, Start } from '@ahpd/sdk';
import type { CofoldOptions, Held } from './agent.js';
import type { HarnessConfig } from './config.js';
import type { OpenRequest, TurnMapping } from './mapping.js';
import type { TurnAgent } from './turnagent.js';
import type { Runs } from './runs.js';
import type { Pauses } from './pauses.js';
import type { Turns } from './turns.js';

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
  queued: Bag[];
  settings: Record<string, unknown>;
  touch: () => void;
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
  /** What the last turn failed with, or nothing. Cleared when a turn starts. */
  failed: string | undefined;
  title: string;
  modified: string;
  closed: boolean;
  /**
   * Whether the conversation the host resumed is still being looked up.
   *
   * A run paused before the restart still holds the session's writer claim, so
   * a turn that started before the lookup finished would fight it for the
   * claim and lose. Everything that would begin a turn waits on this instead,
   * so it sees either an empty conversation or the reopened one. A fork or a
   * rewind rides the same chain, because the cut has to land before the first
   * turn reads the session.
   */
  opening: Promise<void> | undefined;
  /**
   * Why the cut this session was asked for did not happen.
   *
   * A session whose fork or rewind failed does not fall back to an ordinary
   * continue: every turn it is asked for is answered with this, so a client
   * sees the cut it asked for not happen rather than a conversation quietly
   * carrying on from the wrong place.
   */
  refused: Error | undefined;
  /** What it is doing, or nothing while it is idle. */
  activity: string | undefined;
}