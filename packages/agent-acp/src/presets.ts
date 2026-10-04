/**
 * The agents this package ships a row for.
 *
 * A row is what running one known agent takes: the program, the arguments that
 * put it in ACP mode, the switch that stops it updating itself, and the sign-in
 * it needs once a key is there. A preset takes a row by naming it as its own
 * key or as its `base`, and whatever the preset writes itself wins over the row.
 *
 * The rows are kept by hand rather than read from the ACP registry, which lists
 * a command and nothing else: the switch that stops an agent updating itself
 * and the variable that says it has been signed in are not in it. They were
 * checked against each agent's own command on 2026-10-03, and that date is what
 * a rename is noticed at. Versions are not here either: a machine pins them,
 * and one place does that.
 *
 * Only an agent that ships an ACP server is here. Crush has none.
 */

/** One shipped agent: the fields `AcpOptions` takes, less the id and the sign-in. */
export interface AcpPreset {
  /** What a client reads instead of the id. */
  name: string;
  /** The program to spawn as the ACP server. */
  command: string;
  /** The arguments to give it. */
  args?: string[];
  /**
   * The variables it is spawned with, over the daemon's own.
   *
   * Each is a switch that has to be off for a host that does not want the
   * agent replacing itself under a session that is running.
   */
  env?: Record<string, string>;
  /**
   * The sign-in it needs, and the daemon variables that say it has one.
   *
   * A variable counts as set when the daemon's own environment has it or the
   * preset's `env` does, so a deployment that keeps its key out of the daemon
   * still says the preset is signed in. With none of them set the agent
   * registers with no sign-in at all, and a session the server refuses ends
   * with the sentence naming the methods its handshake offered.
   */
  authenticate?: { methodId: string; fromEnv: string[] };
}

/** Every shipped row, by the key a preset names. */
export const presets: Record<string, AcpPreset> = {
  codex: {
    name: 'Codex',
    command: 'codex-acp',
    // The `codex` CLI has no ACP mode of its own; this is Codex behind an
    // adapter, installed with `npm i -g @agentclientprotocol/codex-acp`.
    authenticate: { methodId: 'api-key', fromEnv: ['CODEX_API_KEY', 'OPENAI_API_KEY'] },
  },
  gemini: {
    name: 'Gemini',
    command: 'gemini',
    args: ['--acp'],
  },
  copilot: {
    name: 'Copilot',
    command: 'copilot',
    args: ['--acp'],
    env: { COPILOT_AUTO_UPDATE: 'false' },
  },
  opencode: {
    name: 'OpenCode',
    command: 'opencode',
    args: ['acp'],
    env: { OPENCODE_DISABLE_AUTOUPDATE: '1' },
  },
  kilo: {
    name: 'Kilo',
    command: 'kilo',
    args: ['acp'],
    // Kilo is an OpenCode fork and reads its own copy of the switch.
    env: { OPENCODE_DISABLE_AUTOUPDATE: '1' },
  },
  goose: {
    name: 'Goose',
    command: 'goose',
    args: ['acp'],
    // A headless host has no keyring, and a session that cannot read one fails
    // its first turn rather than its start.
    env: { GOOSE_DISABLE_KEYRING: '1' },
  },
  pi: { name: 'Pi', command: 'pi-acp' },
  dsh: { name: 'dsh', command: 'dsh', args: ['--profile', 'acp'] },
  devin: { name: 'Devin', command: 'devin', args: ['acp'] },
  cursor: {
    name: 'Cursor',
    command: 'agent',
    args: ['acp'],
    // `cursor_login` is the one method Cursor advertises; with the key set it
    // signs in without a browser.
    authenticate: { methodId: 'cursor_login', fromEnv: ['CURSOR_API_KEY'] },
  },
  amp: {
    // The Amp CLI is the ACP server's own harness, so the binary that speaks
    // the protocol is this one rather than `amp` itself.
    name: 'Amp',
    command: 'amp-acp',
  },
  qwen: { name: 'Qwen Code', command: 'qwen', args: ['--acp'] },
};