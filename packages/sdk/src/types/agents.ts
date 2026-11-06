/**
 * The engines a plugin offers, and the records a person makes from them.
 *
 * An engine is what a plugin registers: one name, the form a person fills
 * in, the host-only fields, the environment variables any owner may set, and
 * the `open` that builds the backend for one record. A record is one agent,
 * kept as a JSON record, and the channel folds it into the host's agent list
 * while the daemon runs.
 *
 * The channel owns the four fields every agent has - `name`, `description`,
 * `icon` and `model` - so an engine's schema holds only the fields of that engine,
 * and two engines cannot disagree about what a name is.
 */

import type { Icon } from '@microsoft/agent-host-protocol';
import type { Agent } from './agent.js';
import type { Capability, ConnectorOwner } from './connectors.js';

/**
 * Whose agent it is: the same three owners a connector takes.
 *
 * `host` is the daemon's own, shared by everyone it serves. `team:<team>` is a
 * team's and `user:<id>` is a person's, and each is kept under that owner's
 * scope in the vault.
 */
export type AgentOwner = ConnectorOwner;

/** What a new record starts from, as an engine offers it. */
export interface AgentTemplate {
  /** The name a record made from it starts with. */
  name: string;
  /** One line about it. */
  description?: string;
  /** What a client draws beside it, as the engine declared it. */
  icon?: Icon;
  /** The icons a client draws beside it, with each `src` resolved by the host. */
  icons?: Icon[];
  /** The model a record made from it starts on. */
  model?: string;
  /** The engine's own values it starts with. */
  config?: Record<string, unknown>;
}

/**
 * One agent record, as it is kept.
 *
 * `config` holds the engine's own values. A field the engine marks `secret`, or
 * one of its `keyVariables`, is a secret: the record keeps
 * `{ "$secret": "<name>" }` and the vault keeps the value, so a listing, an
 * answer and the log never carry it.
 */
export interface AgentRecord {
  /** The record's id: a slug, unique across every owner, and what a client names the agent by. */
  id: string;
  /** The name of the engine it is one of. */
  engine: string;
  /** Whose agent it is. */
  owner: AgentOwner;
  /** What a client prints for it. */
  name: string;
  /** One line about it. */
  description?: string;
  /** What a client draws beside it. */
  icon?: Icon;
  /** The model it runs on, where the engine lets a record choose one. */
  model?: string;
  /** The engine's own values, held to its schema. */
  config: Record<string, unknown>;
}

/**
 * The live view of one record, as an engine's `open` is handed it.
 *
 * Every field is read at each call rather than copied at open, so an edit
 * reaches a running session at its next turn instead of waiting for the daemon
 * to restart. `config` is the engine's own values with each secret read back
 * from the vault, refreshed when the record changes.
 */
export interface AgentView {
  /** The record's id. */
  readonly id: string;
  /** The engine's name. */
  readonly engine: string;
  /** Whose agent it is. */
  readonly owner: AgentOwner;
  /** What a client prints for it. */
  readonly name: string;
  /** One line about it, when it has one. */
  readonly description: string | undefined;
  /** What a client draws beside it, when it has one. */
  readonly icon: Icon | undefined;
  /** The model it runs on, when it names one. */
  readonly model: string | undefined;
  /** The engine's own values, each secret read back from the vault. */
  readonly config: Record<string, unknown>;
}

/**
 * One engine a plugin offers.
 *
 * The name is the engine's identity and is a slug, because it is also the `engine`
 * a stored record carries. The schema is what a client draws the record's own
 * form from, and `open` is where the plugin builds the backend for one record.
 */
export interface Engine {
  /** The engine's name: a slug, and the name every record of it carries. */
  name: string;
  /** What a client prints for the engine. */
  title: string;
  /** One sentence on what an agent of this engine is. */
  description: string;
  /** The JSON Schema a client draws a record's own fields from. */
  schema: Record<string, unknown>;
  /**
   * What an agent of this engine does, as a client lists it.
   *
   * The same type an adapter's capabilities are. The host reads only `ui` on an
   * engine now: a `ui` capability carries the component tree an agent of this
   * engine draws from the data it sends.
   */
  capabilities?: Capability[];
  /** What a client draws beside the engine's title. */
  icons?: Icon[];
  /** What a new record of this engine starts from. */
  templates?: AgentTemplate[];
  /**
   * The template one record was made from, picked out of `templates`.
   *
   * The host draws a record with no icon of its own with its template's icons.
   * An engine that knows which template a record runs, as `acp` knows from the
   * record's id or its `base`, answers here. Left out, the host takes the
   * template whose `command` equals the record's.
   */
  templateOf?(record: { id: string; config: Record<string, unknown> }, templates: readonly AgentTemplate[]): AgentTemplate | undefined;
  /**
   * The fields only the host's own record may set.
   *
   * A field a dangerous setting lives in, such as a command a backend runs. A
   * team's or a person's record that sets one is refused, so a free field
   * cannot become a way to run something the owner chose.
   */
  hostOnly?: string[];
  /**
   * The `env` variables any owner may set, as key fields.
   *
   * Every other `env` variable is host-only, because a free environment can run
   * a program, such as `NODE_OPTIONS`, while a person still needs to set their
   * own key. A variable named here is a secret: the vault keeps its value and
   * the record keeps a reference.
   */
  keyVariables?: string[];
  /**
   * Build the backend for one record.
   *
   * Called once when a record is made, and when the daemon starts with it
   * stored. The view is live, so what `open` builds reads an edit at the next
   * turn rather than holding the values it saw.
   */
  open(record: AgentView): Agent;
}

/** One engine as the fold keeps it, with the plugin that registered it. */
export interface ServedEngine extends Engine {
  /** The plugin that registered it. */
  by: string;
  /** What configuration named that plugin by, a package or a path, where it named one. */
  spec?: string;
}

/** The three states an agent row can be in. */
export type AgentState = 'ready' | 'invalid' | 'unavailable';

/** What the host knows about one agent's health, kept in memory only. */
export interface AgentHealth {
  /** What the last check found: `ok`, or why it did not answer in time or threw. */
  result: 'ok' | 'unreachable' | 'failed';
  /** One line the agent answered, when it gave one. */
  message?: string;
  /** When it was checked, as an ISO time. */
  at: string;
}
