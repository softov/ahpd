/**
 * The messages between the plugin and its engine process.
 *
 * The engine is a separate process because a piece turns off TLS checks for the
 * process it runs in. The two sides trade plain JSON: what a piece is, and the
 * result of one action.
 *
 * A request carries an `id`, and the answer to it carries the same one, so a
 * call is matched to its answer even when two are in flight.
 */

/**
 * The store an action keeps values in, in the shape a piece calls.
 *
 * The shape of `Store` in `@activepieces/pieces-framework`, written here so the
 * package installs no framework: each piece bundles its own copy. The scope is
 * the framework's `StoreScope`, `FLOW` when a piece names none, or `PROJECT`.
 */
export interface Store {
  /** Keep one value under a key in a scope, and answer it. */
  put<T>(key: string, value: T, scope?: unknown): Promise<T>;
  /** The value kept under a key in a scope, or `null`. */
  get<T>(key: string, scope?: unknown): Promise<T | null>;
  /** Forget the value under a key in a scope. */
  delete(key: string, scope?: unknown): Promise<void>;
}

/** One prop of a piece's auth, or of one of its actions, as the engine describes it. */
export interface PropDescription {
  /** The piece's own type, such as `SHORT_TEXT` or `STATIC_DROPDOWN`. */
  type: string;
  /** What a client prints for the prop. */
  displayName: string;
  /** One line on what the prop is, when the piece says. */
  description?: string;
  /** Whether an action needs a value for it. */
  required: boolean;
  /** The values of a static dropdown, in the order the piece lists them. */
  options?: unknown[];
  /**
   * The props of one item, for an `ARRAY` prop the piece describes by them.
   *
   * The framework writes them as the array prop's `properties`. An array
   * without them is a list of strings.
   */
  props?: Record<string, PropDescription>;
}

/** One auth a piece takes, as the engine describes it. */
export interface AuthDescription {
  /** The piece's auth type, such as `SECRET_TEXT` or `CUSTOM_AUTH`. */
  type: string;
  /** What a client prints for the auth. */
  displayName: string;
  /** One line on what the auth is, when the piece says. */
  description?: string;
  /** The fields of a `CUSTOM_AUTH`, each by the name the piece reads it by. */
  props?: Record<string, PropDescription>;
  /** What a `BASIC_AUTH` calls its username field. */
  username?: { displayName: string; description?: string };
  /** What a `BASIC_AUTH` calls its password field. */
  password?: { displayName: string; description?: string };
  /** Whether the piece checks a connection of this auth with a `validate` of its own. */
  validates?: boolean;
}

/** One action of a piece, as the engine describes it. */
export interface ActionDescription {
  /** The name a call refers to the action by. */
  name: string;
  /** What a client prints for the action. */
  displayName: string;
  /** One line on what the action does. */
  description: string;
  /** The description the piece wrote for a model, when it wrote one. */
  aiDescription?: string;
  /** Who the action is for, as the piece marks it: `human`, `ai` or `both`, which it is when the piece says nothing. */
  audience?: string;
  /** The action's input, each prop by the name the piece reads it by. */
  props: Record<string, PropDescription>;
}

/** One piece the engine loaded, as the engine describes it. */
export interface PieceDescription {
  /** The specifier the piece was asked for by. */
  package: string;
  /** What a client prints for the piece, which is its adapter's title. */
  displayName: string;
  /** One line on what the piece is, when the piece says. */
  description?: string;
  /** Where the piece's logo is, when the piece publishes one. */
  logoUrl?: string;
  /** The auth the piece takes, one of several, or none. */
  auth?: AuthDescription | AuthDescription[];
  /** The actions the piece offers, in the order it declares them. */
  actions: ActionDescription[];
}

/** Ask the engine what the named pieces are. */
export interface DescribeRequest {
  type: 'describe';
  /** The id this request is answered by. */
  id: number;
  /** One package name or file URL for each piece. */
  pieces: string[];
  /**
   * The plugin's own `installed/` folder, when it has one.
   *
   * A piece that is not one of the plugin's dependencies is installed there,
   * so the engine imports it from that folder when its own resolution does not
   * find the package.
   */
  installed?: string;
  /**
   * The pieces the engine imports from `installed/` before its own resolution.
   *
   * A name the options wrote with a version runs at that version, and the copy
   * the plugin ships may be another one.
   */
  installedFirst?: string[];
}

/**
 * Ask the engine to run one action of one piece.
 *
 * The connector's id goes with it because the engine keeps one `store` for each
 * connector, and the auth value goes with it because the engine holds no secret
 * from one call to the next.
 */
export interface RunRequest {
  type: 'run';
  /** The id this request is answered by. */
  id: number;
  /** The connector the call is for. */
  connector: string;
  /** The package specifier of the piece. */
  piece: string;
  /** The name of the action to run. */
  action: string;
  /**
   * The plugin's own `installed/` folder, when it has one.
   *
   * Sent with every call, because an engine started after an install still has
   * to find a piece that lives there.
   */
  installed?: string;
  /** Whether this piece is imported from `installed/` first, as `describe` was told. */
  installedFirst?: boolean;
  /** The auth value the piece reads: a secret text, or the props of a custom auth. */
  auth: Record<string, unknown>;
  /** The input of the call, each prop by the name the piece reads it by. */
  input: Record<string, unknown>;
  /**
   * The calling session's attachments folder, when it has one.
   *
   * A `FILE` value that names an attachment is read from here, and
   * `files.write` puts a written file here.
   */
  files?: string;
  /** The folder the engine keeps each connector's store in, one file to a connector. */
  stores?: string;
}

/** Ask the engine whether a connection works, by the piece's own `validate`. */
export interface ValidateRequest {
  type: 'validate';
  /** The id this request is answered by. */
  id: number;
  /** The package specifier of the piece. */
  piece: string;
  /** The auth value, as a call would carry it, its `type` naming its kind. */
  auth: Record<string, unknown>;
  /** The plugin's own `installed/` folder, when it has one. */
  installed?: string;
  /** Whether this piece is imported from `installed/` first. */
  installedFirst?: boolean;
}

/** What the engine answered a `validate` with: the piece's verdict. */
export interface ValidatedAnswer {
  type: 'validated';
  /** The id of the request this answers. */
  id: number;
  /** Whether the piece took the connection. */
  valid: boolean;
  /** What the piece said of one it did not take. */
  error?: string;
}

/** What the engine answered a `describe` with. */
export interface DescribedAnswer {
  type: 'described';
  /** The id of the request this answers. */
  id: number;
  /** The pieces that loaded. */
  pieces: PieceDescription[];
  /** One line for each piece that did not load, naming it. */
  errors: string[];
}

/** What the engine answered a `run` with, when the action returned. */
export interface RanAnswer {
  type: 'ran';
  /** The id of the request this answers. */
  id: number;
  /** The action's result, as JSON. */
  result: unknown;
}

/** What the engine answered when the request itself failed. */
export interface FailedAnswer {
  type: 'failed';
  /** The id of the request this answers. */
  id: number;
  /** One line saying what went wrong. */
  message: string;
}

/** One request to the engine. */
export type Request = DescribeRequest | RunRequest | ValidateRequest;

/** One request before its id is given: what a caller sends. */
export type Question = Omit<DescribeRequest, 'id'> | Omit<RunRequest, 'id'> | Omit<ValidateRequest, 'id'>;

/** One answer from the engine. */
export type Answer = DescribedAnswer | RanAnswer | ValidatedAnswer | FailedAnswer;

/**
 * What a running action said with `output.update`, before its answer: the
 * `data` it handed over, which replaces what it said before.
 */
export interface OutputMessage {
  type: 'output';
  /** The id of the `run` request the action is running for. */
  id: number;
  /** The `data` the action handed `output.update`. */
  data: unknown;
}

/** Whether a value came over the channel as an answer, with an id. */
export const isAnswer = (value: unknown): value is Answer => {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  const known = message['type'] === 'described' || message['type'] === 'ran' || message['type'] === 'validated' || message['type'] === 'failed';
  return known && typeof message['id'] === 'number';
};

/**
 * A line the engine has for the daemon's log. The engine is a process of its
 * own with no log, so it hands the line to the plugin, which writes it.
 */
export interface LogMessage {
  type: 'log';
  level: 'warn' | 'error';
  line: string;
}

/** Whether a value came over the channel as a line for the daemon's log. */
export const isLog = (value: unknown): value is LogMessage => {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  return message['type'] === 'log' && typeof message['line'] === 'string'
    && (message['level'] === 'warn' || message['level'] === 'error');
};

/** Send a line for the daemon's log from the engine, which only the plugin can write to. */
export const engineLog = (level: LogMessage['level'], line: string): void => {
  const message: LogMessage = { type: 'log', level, line };
  process.send?.(message);
};

/** Whether a value came over the channel as a running action's output, with an id. */
export const isOutput = (value: unknown): value is OutputMessage =>
  typeof value === 'object' && value !== null && (value as Record<string, unknown>)['type'] === 'output'
  && typeof (value as Record<string, unknown>)['id'] === 'number';
