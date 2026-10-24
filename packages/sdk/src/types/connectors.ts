/**
 * The adapters a plugin offers, and the connectors made from them.
 *
 * An adapter is what a plugin registers: one name, the form a person fills in
 * to make a connector of it, and the capabilities a connector of that adapter
 * carries. A connector is one person's or team's instance of an adapter, kept
 * as a JSON record, and the adapter's `open` is where the plugin starts
 * answering for it.
 *
 * A capability is declared and shown. A `receive` capability is where a
 * connector answers, and an `action` runs through the adapter's `run`, which
 * the host calls with the connector - the identity, the configuration and the
 * secrets - and the input of one call.
 */

import type { Icon } from '@microsoft/agent-host-protocol';

/**
 * What a capability is, as a client files it.
 *
 * `receive` is a connector that answers calls, `command` is a `/` command it
 * adds, `action` is something a client offers to run, `models` is a connector
 * the model proxy may call, and `ui` is reserved for a component tree a later
 * plan adds. A type this version does not know is kept and shown by its title
 * rather than refused.
 */
export type CapabilityType = 'receive' | 'command' | 'action' | 'models' | 'ui' | (string & {});

/** One thing a connector of an adapter does. */
export interface Capability {
  /** What kind of capability this is. */
  type: CapabilityType;
  /** The name a client and the plugin refer to it by. */
  name: string;
  /** What a client prints for it. */
  title: string;
  /** One line on what it does. */
  description: string;
  /**
   * The form a client draws for a `command` or an `action`.
   *
   * A JSON Schema object, the same subset a client already draws a session
   * setting from.
   */
  input?: Record<string, unknown>;
  /**
   * Where a `receive` capability's connectors receive, on a `receive` only.
   *
   * A path relative to the daemon's HTTP root, with `{id}` standing for the
   * connector's id, such as `/plugins/webhook/{id}`. A client puts the root
   * before it to build a connector's URL.
   */
  path?: string;
}

/**
 * Whose connector it is.
 *
 * `host` is the daemon's own, shared by everyone it serves. `team:<team>` is a
 * team's and `user:<id>` is a person's, and each is kept under that owner's
 * scope in the vault.
 */
export type ConnectorOwner = 'host' | `team:${string}` | `user:${string}`;

/** The APIs a model provider is called in, as the proxy writes them. */
export const MODEL_DIALECTS = ['anthropic-messages', 'openai-chat'] as const;

/** One of those APIs. */
export type ModelDialect = (typeof MODEL_DIALECTS)[number];

/**
 * What one model costs, as OpenRouter writes it.
 *
 * Each side is dollars per token, as a string, so a figure small enough to be
 * written in exponent form keeps every digit the provider gave. A side the
 * provider does not price is absent rather than zero.
 */
export interface ModelPricing {
  /** Dollars per token of the prompt, such as `"0.000003"`. */
  prompt?: string;
  /** Dollars per token of the answer. */
  completion?: string;
}

/**
 * One model a provider connector serves, in the field names OpenRouter's list
 * uses.
 *
 * An adapter answers these from its vendor's own list, so a field the vendor
 * does not send is absent: OpenAI's list is ids alone.
 */
export interface ProviderModel {
  /** The model's id on that provider, which is that provider's own spelling. */
  id: string;
  /** What the provider calls it, when it sends a name. */
  name?: string;
  /** The prompt the model reads, in tokens, when the provider says. */
  context_length?: number;
  /** What a call costs there, when the provider prices it. */
  pricing?: ModelPricing;
}

/**
 * How the proxy calls one provider connector.
 *
 * An adapter that serves models answers this from the connector's config, with
 * each secret already read back from the vault, so the key here is the value a
 * call goes out with rather than the reference a record keeps.
 */
export interface ModelProvider {
  /** Where the provider's API answers, such as `https://api.anthropic.com`. */
  endpoint: string;
  /** The APIs the provider is called in. A call passes through in one of them. */
  accepts: ModelDialect[];
  /** The key a call goes out with; absent when the provider takes none. */
  key?: string;
  /**
   * What comes before a fetched model's id, as the adapter's name unless it
   * says otherwise.
   *
   * An adapter with no vendor name of its own answers its connector's id here,
   * so a local server's models are `<connector id>/<id>`.
   */
  prefix?: string;
}

/** One open connector that serves models, as the proxy reads it. */
export interface ProviderConnector {
  /** The connector's id: a slug, and the name its record is kept under. */
  id: string;
  /** The adapter it is one of. */
  adapter: string;
  /** Whose connector it is, which decides whose calls it may answer. */
  owner: ConnectorOwner;
  /** Where, how and with what key the proxy calls it. */
  provider: ModelProvider;
  /**
   * The models this connector serves, read from the provider's own list.
   *
   * The channel binds it to the open connector, so the adapter reads the
   * resolved config and the key never leaves the channel. It is absent when
   * the adapter has no `models`, as `provider` is absent when it has no
   * `provider`.
   */
  models?: () => Promise<ProviderModel[]>;
}

/**
 * One stored connector as a save that may name it reads it.
 *
 * Id, adapter and owner and nothing else, because that is the whole of what a
 * reference is checked against: a schema field naming a connector has to find
 * one of the adapter it asks for, and one whose owner the automation may read.
 * A record written by hand may name no owner, and such a connector is not one
 * a save may link to.
 */
export interface ConnectorRef {
  /** The connector's id: the slug its record is kept under. */
  id: string;
  /** The adapter it is one of. */
  adapter: string;
  /** Whose it is; absent on a record that names no scope. */
  owner?: ConnectorOwner | undefined;
}

/** One connector, as an adapter's `open` is handed it. */
export interface Connector {
  /** The connector's id: a slug, and the name its record is kept under. */
  id: string;
  /** The name of the adapter it is one of. */
  adapter: string;
  /** Whose connector it is. */
  owner: ConnectorOwner;
  /** What a client prints for it; absent, its id stands for it. */
  title?: string;
  /** The values a person filled in, each secret read back from the vault. */
  config: Record<string, unknown>;
}

/**
 * What one check of a connector answered.
 *
 * `ok` is a connector that works, `denied` a service that refused its
 * credentials, `unreachable` a service that did not answer in time, and
 * `failed` anything else. A message says what the service answered, when the
 * adapter has one to give.
 */
export interface CheckResult {
  /** What the check found. */
  result: 'ok' | 'denied' | 'unreachable' | 'failed';
  /** One line the service answered, when it gave one. */
  message?: string;
}

/** One call a connector made or answered, as a row carries it. */
export interface CallOutcome {
  /** When it happened, as an ISO time. */
  at: string;
  /** Whether it worked. */
  ok: boolean;
  /** The status the service answered, when there was one. */
  status?: number;
  /** What went wrong, as the thrower gave it, at most 500 characters. */
  error?: string;
}

/** What the host knows about one connector's health, kept in memory only. */
export interface ConnectorHealth {
  /** The last check, and when it ran. */
  check?: CheckResult & { at: string };
  /** The last call the connector made or answered. */
  lastCall?: CallOutcome;
  /** The last call that failed. */
  lastFailure?: CallOutcome;
}

/**
 * One adapter a plugin offers.
 *
 * The name is the adapter's identity and is a slug, because it is also the
 * `adapter` a stored connector carries. The schema is what a client draws the
 * form from, so it is the protocol between the plugin and a person: an adapter
 * that changes it leaves a connector that no longer matches, and the plan that
 * adds connectors does not migrate one.
 */
export interface Adapter {
  /** The adapter's name: a slug, and the name every connector of it carries. */
  name: string;
  /** What a client prints for the adapter. */
  title: string;
  /** One sentence on what a connector of this adapter is. */
  description: string;
  /** The JSON Schema a client draws the form from. */
  schema: Record<string, unknown>;
  /** What a connector of this adapter does, as a client lists it. */
  capabilities: Capability[];
  /**
   * What a client draws beside the adapter's title.
   *
   * An `src` that is a path is relative to the package of the plugin that
   * registered the adapter, and the host reads the file and sends it as a
   * `data:` URI, at most 32 KB. An `https:` URL or a `data:` URI is sent as it
   * is.
   */
  icons?: Icon[];
  /**
   * How the proxy calls one connector of this adapter, when it serves models.
   *
   * It reads the connector's resolved config, so a field the schema marks
   * `writeOnly` is the value the vault holds rather than the reference a record
   * keeps. Absent, a connector of this adapter serves no model.
   */
  provider?(connector: Connector): ModelProvider;
  /**
   * The models one connector serves, as its provider lists them.
   *
   * It reads the connector's resolved config, as `provider` does, so it calls
   * the provider with the key the vault holds. The host reads it when the proxy
   * starts and again every hour, so a failed read keeps the list it had. Absent,
   * a connector of this adapter adds no model name of its own.
   */
  models?(connector: Connector): Promise<ProviderModel[]>;
  /**
   * Start answering for one connector.
   *
   * Called when a connector is made and when the daemon starts with one
   * stored. The answer is the function that stops it, or nothing when there is
   * nothing to stop.
   */
  open(connector: Connector): void | (() => void | Promise<void>);
  /**
   * Say whether one connector works, with a call that needs its credentials.
   *
   * The host calls it after each open: a put waits for the answer, so its
   * result says whether the key is right, and a start does not. It is handed
   * the connector as `open` was, with each secret read back. An adapter with
   * no check leaves its connectors with no `health.check`.
   */
  check?(connector: Connector): Promise<CheckResult>;
  /**
   * Run one of the adapter's `action` capabilities for one connector.
   *
   * The host hands it the connector as `open` was handed it, with each secret
   * read back from the vault, and the input of the call. It answers the
   * action's result, which the host passes on. An adapter with no `run` offers
   * no action tool, and an adapter with `run` and no `action` capability runs
   * nothing either.
   */
  run?(connector: Connector, action: string, input: Record<string, unknown>): Promise<unknown>;
}

/** One adapter as the fold keeps it, with the plugin that registered it. */
export interface ServedAdapter extends Adapter {
  /** The plugin that registered it. */
  by: string;
}
