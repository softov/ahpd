/** What the agent backend offers, read once before any session exists. */

/** The harness-wide capabilities, used until a session reports its own. */
export interface Offered {
  /** Models a turn can run on. `id` is what the wire carries, `name` what a person reads. */
  models: { id: string; name: string }[];
  /**
   * Skills, commands, subagents and MCP servers the harness offers here.
   *
   * What a new session starts out reporting, so its info pane is answered at
   * once rather than several seconds later when its own agent replies.
   */
  customizations: Record<string, unknown>[];
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
