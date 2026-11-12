/**
 * The operations a kind offers, and what a channel's state lists of them.
 *
 * A kind of thing a channel holds - a tunnel now, a computer later - declares
 * the verbs a person may run on it. The declaration is the same for every
 * kind: an id an invocation names, the words a client draws, the form its
 * input is filled in from, and the grant a caller has to hold. What the kind
 * does with a call is the kind's own, and the host only carries the
 * declaration to the clients and runs the handler the kind gave it.
 *
 * `Operation` is one of those declarations as a channel lists it: the kind it
 * came from, the scopes it may be pointed at, the grant it asks and how its
 * last invocation went. A kind never sets the status - it says what it found
 * while working, and whether a call is in flight is the host's to know.
 */

/**
 * Where an operation may be invoked.
 *
 * `list` is the channel as a whole, such as making a new record. `tunnel` is
 * one record of it, such as starting or removing that record. `client` is one
 * client the host serves, such as dropping its connection. `agent` is one
 * agent record, such as pausing it. `connector` is one connector record, such
 * as turning it off. A kind declares the scopes an operation accepts, and the
 * host refuses an invocation whose target is not one of them.
 */
export type OperationScope = 'list' | 'tunnel' | 'client' | 'agent' | 'connector';

/**
 * How an invocation of an operation is going.
 *
 * `idle` is the resting state, including a call that finished well. `running`
 * is a call in flight, and `error` is the one that threw. The error's message
 * is beside it, when the kind or the host has one to give.
 */
export type OperationStatus = 'idle' | 'running' | 'error';

/**
 * One operation a kind declares.
 *
 * Its shape is the protocol's `ChangesetOperation`, reduced to the members a
 * channel of records needs, so two kinds of thing can be drawn by one client
 * and, later, share the invocation command and its checks.
 */
export interface KindOperation {
  /**
   * Stable within the kind, and what an invocation names.
   *
   * The ids the host serves for every kind - `create`, `update`, `remove`,
   * `enable` and `disable` - are refused, because the host owns those and a
   * kind's own operation may not shadow one of them.
   */
  id: string;
  /** The button. A client may print the id when this is absent. */
  label?: string;
  /** Longer text, for a tooltip. */
  description?: string;
  /** A hint, such as `restart` or `plus`. */
  icon?: string;
  /**
   * The JSON Schema a client draws the input's form from.
   *
   * Its values are what the host checks an invocation's `input` against and
   * what the kind's `invoke` is handed. Absent, the operation takes no input.
   */
  input?: Record<string, unknown>;
  /**
   * The question to ask before running it.
   *
   * Its presence is also how a client is told the operation is destructive:
   * it must ask, and should style the affirmative answer as the warning.
   */
  confirmation?: string;
  /**
   * The grant a caller holds to invoke it.
   *
   * `<subject>:<operation>`, such as `tunnel:restart` for a kind's own verb.
   * Absent, the host asks for the grant of the group the operation falls in:
   * `tunnel:delete` for `remove`, and `tunnel:put` for everything else.
   */
  grant?: string;
  /**
   * Whether one record offers this operation now.
   *
   * The host calls it with the record as a client reads it, its settings and
   * its state, and keeps the answer to itself: the field is never sent, and a
   * record lists only the ids it answered true for. A kind that leaves it out
   * offers the operation on every record of the kind.
   *
   * A condition a client evaluates, rather than the host, is a later idea:
   * `.project/ideas/an-operation-says-when-it-applies.md`.
   */
  offered?(record: Record<string, unknown>): boolean;
}

/**
 * One operation as a channel's state lists it.
 *
 * The kind's declaration, with the facts the host alone knows: the kind it
 * belongs to, the scopes it may be pointed at, the grant it asks, and how its
 * last invocation went. A client invokes it by `id`, so the list is the whole
 * of what may be asked for.
 */
export interface Operation extends KindOperation {
  /** The `name` of the kind that declared it. */
  kind: string;
  /** The scopes an invocation may name, as the kind declared them. */
  scopes: OperationScope[];
  /** The grant a caller holds to invoke it, which the host resolved. */
  grant: string;
  /** How its last invocation went, and `idle` before any. */
  status: OperationStatus;
  /** Why the last invocation failed, when it did. */
  error?: string;
}
