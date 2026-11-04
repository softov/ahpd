/** What the agent backend offers, read once before any session exists. */

/**
 * The account a harness is signed in as.
 *
 * The shape is VS Code's `ICodexAccountInfo`: its window reads exactly these
 * fields out of a host's root state, so a client that already draws an account
 * menu draws this one as it is rather than as a translation of it. The fields
 * left are the ones a harness can state - what the sign-in is, the email it
 * belongs to, the plan it bills to and when it was read. An account with no
 * email is a real answer and not a missing one.
 */
export interface Account {
  /**
   * What the sign-in is.
   *
   * `signedIn` is an account with an email. `signedOut` is a harness that
   * holds no sign-in of its own, and `unavailable` one that does not sign in
   * at all: an API key, or a preset pointed at a provider that hands out its
   * own credentials. The other three are VS Code's, for a value that is being
   * read, has failed to be read, or has not been read yet.
   */
  status: 'unknown' | 'downloading' | 'signedIn' | 'signedOut' | 'unavailable' | 'error';
  /** The email the harness is signed in as. */
  email?: string;
  /** The plan the account bills to, as the provider names it. */
  planType?: string;
  /** When the account was read, in Unix milliseconds. */
  observedAt?: number;
}

/** The harness-wide capabilities, used until a session reports its own. */
export interface Offered {
  /**
   * Models a turn can run on.
   *
   * `id` is what the wire carries and `name` what a person reads.
   * `configSchema` is what the *model* can be told to do differently, as
   * `SessionModelInfo.configSchema`: a client draws it as a form beside the
   * model rather than as a session-wide control, which matters because
   * different models take different options. A model that takes none omits
   * it, and a client then draws no form for that one.
   *
   * `maxContextWindow` and `maxOutputTokens` are what the harness knows the
   * model can hold and answer, when it knows: a client sizes a conversation
   * against the first and caps a request with the second. Absent means nothing
   * was published, which is not the same as a limit of zero. `supportsVision`
   * says whether the model takes an image, as the spec's model info does.
   */
  models: {
    id: string;
    name: string;
    /**
     * The canonical wire id this row's `id` resolves to, when the harness says.
     *
     * A row can be an alias - `sonnet` resolving to `claude-sonnet-5` - and a
     * limit learned from a result is keyed by the canonical id. A host reads
     * this to match the two; it is not a second name to offer the model under.
     */
    resolvedModel?: string;
    maxContextWindow?: number;
    maxOutputTokens?: number;
    maxPromptTokens?: number;
    supportsVision?: boolean;
    configSchema?: Record<string, unknown>;
  }[];
  /**
   * Skills, commands, subagents and MCP servers the harness offers here.
   *
   * What a new session starts out reporting, so its info pane is answered at
   * once rather than several seconds later when its own agent replies.
   */
  customizations: Record<string, unknown>[];
  /**
   * The account this harness bills to, when it can say.
   *
   * Optional because a harness that was asked and did not answer has nothing
   * to report, which is not the same as one reporting no sign-in.
   */
  account?: Account;
  /**
   * Output styles this harness has, and the one in force.
   *
   * Optional because it is a real answer for a backend to have no such
   * notion: left out, no output-style control is drawn at all rather than an
   * empty picker being offered.
   */
  outputStyles?: string[];
  /** The style the harness starts on, when it has them. */
  outputStyle?: string;
  /** Commands available after a slash. */
  commands: {
    /** The command name, without its leading slash. */
    name: string;
    /** One line describing what it does. */
    description?: string;
    /** What its argument is, e.g. `<id>`, when it takes one. */
    argumentHint?: string;
  }[];
}
