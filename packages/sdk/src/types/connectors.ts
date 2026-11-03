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
export const MODEL_DIALECTS = [
  'anthropic-messages',
  'openai-chat',
  'anthropic-count-tokens',
  'openai-input-tokens',
  'openai-embeddings',
  'openai-responses',
  'openai-images',
  'openai-speech',
  'openai-transcriptions',
  'rerank',
] as const;

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
  /**
   * The upstream path for one dialect, when the provider serves it somewhere
   * other than the proxy's usual path.
   *
   * A dialect has one path on the proxy's side, such as `/images/generations`,
   * and a provider that serves all of them at one path names it here, as
   * OpenRouter names `/images`.
   */
  paths?: Partial<Record<ModelDialect, string>>;
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
 * One model a provider connector serves, as `x-ahpd/connectors/models` answers
 * it to one reader.
 */
export interface ConnectorModel extends ProviderModel {
  /** The name a caller sends as `model` to the proxy: `<prefix>/<id>`. */
  model: string;
  /**
   * Whether this reader may call it through the proxy now, after its routes
   * and policies. Absent on a host that serves no proxy.
   */
  callable?: boolean;
}

/** One provider connector's models, as the proxy's catalog last read them. */
export interface ConnectorModels {
  /** The models, in the order the provider sent them. */
  models: ConnectorModel[];
  /** When the list was last read from the provider, or tried, as an ISO time. Absent before the first read. */
  at?: string;
}

/**
 * One stored connector as a save that may name it reads it.
 *
 * Id, adapter and owner are what a reference is checked against: a schema
 * field naming a connector has to find one of the adapter it asks for, and one
 * whose owner the automation may read. A record written by hand may name no
 * owner, and such a connector is not one a save may link to. The title is the
 * label a client shows for the connector where a field offers it as a choice.
 */
export interface ConnectorRef {
  /** The connector's id: the slug its record is kept under. */
  id: string;
  /** The adapter it is one of. */
  adapter: string;
  /** Whose it is; absent on a record that names no scope. */
  owner?: ConnectorOwner | undefined;
  /** What a client calls it, when the record has a title. */
  title?: string | undefined;
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
 * A sign-in where a person pastes a code the vendor's page shows.
 *
 * The host builds the PKCE values: a verifier it keeps, the S256 challenge and
 * a state. The adapter puts the challenge in its vendor's sign-in URL, and
 * runs the exchange against the code a person pastes back. The answer is the
 * value of one field the adapter's schema marks `secret`, which the put
 * path moves to the vault.
 *
 * Neither half is handed a secret. The code belongs to the person, the verifier
 * stays in the host's memory, and the key is answered once and stored as
 * `{ "$secret": "<name>" }`.
 */
export interface CodeSignIn {
  /** Which flow this is. Absent, it is the pasted code. */
  flow?: 'code';
  /** What a client prints on the button. */
  title: string;
  /** The field of the adapter's schema the exchange fills: one marked `secret`. */
  field: string;
  /** Where a person signs in, given the challenge and the state the host made. */
  url(challenge: string, state: string): string;
  /**
   * Exchange the code a person pasted for the field's value.
   *
   * The host gives it the code and the verifier it kept, and waits no longer
   * than ten seconds. A refusal whose message is `HTTP <status>` alone is
   * answered to the caller with that status. Any other message is not shown,
   * so it may name the vendor but never the code, the verifier or the key.
   */
  exchange(code: string, verifier: string): Promise<string>;
}

/** What a device-code sign-in's `start` answers. */
export interface DeviceSignInStart {
  /** The code a person types on the vendor's page, which the host shows. */
  code: string;
  /** Where a person types it, which the host shows. */
  url: string;
  /** How long the code lasts, in seconds. */
  expires: number;
  /** How long the host waits between polls, in seconds. */
  interval: number;
  /**
   * What the adapter's `poll` takes.
   *
   * The host keeps it and sends it to nothing else: it is a credential of the
   * pending sign-in, so no answer, row, error or log carries it.
   */
  handle: string;
}

/** What one poll of a device-code sign-in answers. */
export type DeviceSignInPoll =
  | {
    /**
     * The values the approval answered, by the field of the adapter's schema.
     *
     * The host runs the put with them once the owner's rule and the account
     * rule pass. A field the schema marks `secret` goes to the vault and the
     * record keeps a reference; every other value stays in the record.
     */
    values: Record<string, string>;
  }
  | {
    /** How long to wait before the next poll, in seconds. */
    wait: number;
  };

/**
 * A sign-in where the host shows a code and waits for the approval.
 *
 * The adapter starts the flow on its vendor's service, and the host polls it
 * every `interval` seconds until the approval, a refusal or the expiry. The
 * person approves on their own device, so the client that started the sign-in
 * does not have to stay open: the host keeps polling and writes the connector
 * when the values arrive.
 *
 * The values may fill several fields. A field marked `secret` is moved to the
 * vault; the rest stay in the record. When `account` names a plain field, a
 * second sign-in that answers a different account is refused, unless the
 * adapter sets `switchAccount`.
 */
export interface DeviceSignIn {
  /** This flow, which is what makes it a device-code sign-in. */
  flow: 'device';
  /** What a client prints on the button. */
  title: string;
  /** The field of the adapter's schema the token is written to: one marked `secret`. */
  field: string;
  /**
   * The field of the adapter's schema the account is written to.
   *
   * It is a plain field, so the record keeps the account a person signed in
   * as, and a second sign-in that answers a different one is refused.
   */
  account?: string;
  /** Whether a second sign-in may replace the connector's account. */
  switchAccount?: boolean;
  /** Start the flow on the vendor's service, and answer its code, URL and timing. */
  start(): Promise<DeviceSignInStart>;
  /**
   * Ask the vendor once whether the person approved.
   *
   * It answers the values, or how long to wait before asking again. A refusal
   * throws, and the host ends the sign-in. A message is never shown to the
   * caller unless it is `HTTP <status>` alone, so it may name the vendor but
   * never the handle, a value it answered or a secret it saw.
   */
  poll(handle: string): Promise<DeviceSignInPoll>;
}

/**
 * How a person signs in to a provider, as one adapter declares it.
 *
 * A `signIn` with no `flow` is the pasted code, so an adapter written before
 * the device flow keeps working unchanged. A `signIn` with `flow: 'device'`
 * is a code the host shows and waits on.
 */
export type SignIn = CodeSignIn | DeviceSignIn;

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
   * `secret` is the value the vault holds rather than the reference a record
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
   * How a person signs in to this adapter's provider, when it has one.
   *
   * The field it names is one the schema marks `secret`, and a sign-in fills
   * it with the value the exchange or the device flow answers. A device flow
   * may fill more fields, whose secret values the put moves to the vault.
   * Absent, a connector of this adapter is made by a put alone.
   */
  signIn?: SignIn;
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
   *
   * `call.files` is the folder where one session's attachments are kept, when
   * its store keeps one. An adapter that reads or writes a file reads it there.
   * It is absent on a session with no folder, and on every call from a host
   * that keeps none.
   */
  run?(connector: Connector, action: string, input: Record<string, unknown>, call?: { files?: string }): Promise<unknown>;
}

/** One adapter as the fold keeps it, with the plugin that registered it. */
export interface ServedAdapter extends Adapter {
  /** The plugin that registered it. */
  by: string;
}
