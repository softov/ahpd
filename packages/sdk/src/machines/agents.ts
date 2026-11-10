/**
 * The agents a setup can find, and how each one is installed.
 *
 * A row is what the daemon needs to know about an agent it did not start: the
 * preset id a client names, what to call it, the command that speaks ACP, the
 * line that installs it, the sites behind it, and the variables its vendor
 * documents. `@ahpd/agent-acp` takes each row's name and command from here, so
 * the command a person is told to install and the command the daemon spawns
 * have one source. The rest of a preset - its arguments, its environment and
 * its machine - stays in that package, because the daemon never spawns an agent
 * itself.
 *
 * The list lives in the sdk rather than in `@ahpd/agent-acp` because `@ahpd/server`
 * reads it to offer an agent it found on PATH, and `pnpm boundary` does not let
 * the server import a package that runs an agent.
 *
 * Every install line is the vendor's own, copied from its install docs or its
 * npm package page and checked on 2026-10-19. A system a vendor does not give a
 * line for is left out rather than guessed at, and the row's `page` is what a
 * person on that system is shown instead. A line is never made up from a product
 * name: `codex` has no ACP mode, so Codex's line installs `codex-acp`, the
 * command its preset runs.
 */

/** One environment variable an agent reads, as its vendor documents it. */
export interface AgentVariable {
  /** The variable's name, as the agent reads it. */
  name: string;
  /** One line on what it does. */
  description: string;
  /** Whether it holds a credential, which a form draws without showing its value. */
  secret: boolean;
}

/** One known agent, as the daemon and a setup read it. */
export interface KnownAgent {
  /** The preset id a client names, which is also this row's key. */
  id: string;
  /** What a client reads instead of the id. */
  name: string;
  /** The agent's own page. */
  site: string;
  /** The site of the company behind it. */
  company: string;
  /** The program to spawn as the ACP server. */
  command: string;
  /**
   * The line that installs it, by system, as the vendor's own docs give it.
   *
   * `all` is what a system with no key of its own uses; a system's key wins over
   * it. A system with neither is left to `page`.
   */
  install?: {
    /** A line that works on every system the vendor supports. */
    all?: string;
    /** Linux. */
    linux?: string;
    /** macOS. */
    darwin?: string;
    /** Windows. */
    win32?: string;
  };
  /** The vendor's install page, for a system the lines do not cover. */
  page?: string;
  /**
   * The environment variables its vendor documents, and what each one does.
   *
   * A generic provider key such as `OPENAI_API_KEY` is not here: a person
   * writes those as any other `env` name. A secret is one a form draws without
   * showing its value.
   */
  variables: AgentVariable[];
}

/** How a known agent is installed on `platform`, or nothing when the row has no line for it. */
export const installLine = (agent: KnownAgent, platform: NodeJS.Platform): string | undefined => {
  const install = agent.install;
  if (install === undefined) return undefined;
  if (platform === 'linux' || platform === 'darwin' || platform === 'win32') {
    return install[platform] ?? install.all;
  }
  return install.all;
};

/**
 * Every agent a setup knows, by the preset id a client names.
 *
 * The npm lines are `npm i -g <package>` for the package `versions.json` installs
 * for that part. The rest are copied from the vendor's docs, and a system the
 * docs do not name is absent rather than filled in.
 */
export const knownAgents: Record<string, KnownAgent> = {
  codex: {
    id: 'codex',
    name: 'Codex',
    site: 'https://developers.openai.com/codex',
    company: 'https://openai.com',
    command: 'codex-acp',
    install: { all: 'npm i -g @agentclientprotocol/codex-acp' },
    variables: [
      { name: 'CODEX_API_KEY', description: 'The API key, read before OPENAI_API_KEY', secret: true },
      { name: 'CODEX_HOME', description: 'The folder for the config and the sessions; it must exist', secret: false },
    ],
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    site: 'https://geminicli.com',
    company: 'https://google.com',
    command: 'gemini',
    install: { all: 'npm i -g @google/gemini-cli' },
    variables: [
      { name: 'GEMINI_API_KEY', description: 'The Gemini API key', secret: true },
      { name: 'GOOGLE_API_KEY', description: 'The Vertex AI key', secret: true },
      { name: 'GEMINI_CLI_HOME', description: 'The folder for the settings', secret: false },
      { name: 'GEMINI_MODEL', description: 'The model', secret: false },
    ],
  },
  copilot: {
    id: 'copilot',
    name: 'Copilot',
    site: 'https://github.com/features/copilot/cli',
    company: 'https://github.com',
    command: 'copilot',
    install: { all: 'npm i -g @github/copilot' },
    variables: [
      { name: 'COPILOT_GITHUB_TOKEN', description: 'The GitHub token, read before GH_TOKEN and GITHUB_TOKEN', secret: true },
      { name: 'COPILOT_HOME', description: 'The folder for the config and the sessions', secret: false },
      { name: 'COPILOT_MODEL', description: 'The model', secret: false },
      { name: 'COPILOT_AUTO_UPDATE', description: 'false stops the update', secret: false },
    ],
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    site: 'https://opencode.ai',
    company: 'https://anoma.ly',
    command: 'opencode',
    install: {
      linux: 'curl -fsSL https://opencode.ai/install | bash',
      darwin: 'curl -fsSL https://opencode.ai/install | bash',
      win32: 'npm install -g opencode-ai',
    },
    variables: [
      { name: 'OPENCODE_CONFIG', description: 'The config file', secret: false },
      { name: 'OPENCODE_CONFIG_DIR', description: 'The config folder', secret: false },
      { name: 'OPENCODE_DISABLE_AUTOUPDATE', description: 'Any value stops the update', secret: false },
    ],
  },
  kilo: {
    id: 'kilo',
    name: 'Kilo',
    site: 'https://kilo.ai/cli',
    company: 'https://kilo.ai',
    command: 'kilo',
    install: { all: 'npm i -g @kilocode/cli' },
    variables: [
      { name: 'KILO_API_KEY', description: 'The Kilo API key', secret: true },
      { name: 'KILO_CONFIG_DIR', description: 'The config folder', secret: false },
      { name: 'KILO_PROVIDER', description: 'The provider', secret: false },
      { name: 'KILOCODE_MODEL', description: 'The model', secret: false },
    ],
  },
  goose: {
    id: 'goose',
    name: 'Goose',
    site: 'https://goose-docs.ai',
    company: 'https://aaif.io',
    command: 'goose',
    install: {
      linux: 'curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash',
      darwin: 'curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash',
      // Windows has no line: the docs' one-line form is for Git Bash and MSYS2,
      // and PowerShell is a two-step download and run, so the page covers it.
    },
    page: 'https://goose-docs.ai/docs/getting-started/installation/',
    variables: [
      { name: 'GOOSE_PROVIDER', description: 'The provider', secret: false },
      { name: 'GOOSE_MODEL', description: 'The model', secret: false },
      { name: 'GOOSE_PROVIDER__API_KEY', description: 'The key of the provider', secret: true },
      { name: 'GOOSE_PATH_ROOT', description: 'The folder for the config and the data', secret: false },
    ],
  },
  pi: {
    id: 'pi',
    name: 'Pi',
    site: 'https://pi.dev',
    company: 'https://earendil.com',
    command: 'pi-acp',
    // `pi-acp` spawns `pi`, which it does not install, so a person is given
    // both commands and the part installs both packages.
    install: { all: 'npm i -g pi-acp @earendil-works/pi-coding-agent' },
    variables: [
      { name: 'PI_CODING_AGENT_DIR', description: 'The folder for the config and the sessions', secret: false },
      { name: 'PI_SKIP_VERSION_CHECK', description: 'Any value stops the version check', secret: false },
    ],
  },
  dsh: {
    id: 'dsh',
    name: 'dsh',
    site: 'https://deepseek-harness.github.io/deepseek-harness/',
    company: 'https://www.deepseek.com',
    command: 'dsh',
    install: { all: 'npm i -g @deepseek-ai/dsh' },
    variables: [
      { name: 'DEEPSEEK_API_KEY', description: 'The DeepSeek API key', secret: true },
      { name: 'DSH_HOME', description: 'The folder for the config and the sessions', secret: false },
    ],
  },
  copapo: {
    id: 'copapo',
    name: 'copapo',
    site: 'https://github.com/softov/cofold',
    company: 'https://softov.dev',
    command: 'copapo',
    install: { all: 'npm i -g @cofold/copapo' },
    variables: [
      { name: 'COPAPO_BASE_URL', description: 'The URL of the endpoint', secret: false },
      { name: 'COPAPO_API_KEY', description: 'The API key, when the server wants one', secret: true },
      { name: 'COPAPO_MODEL', description: 'The default model', secret: false },
      { name: 'COPAPO_CONFIG', description: 'The config file', secret: false },
    ],
  },
  devin: {
    id: 'devin',
    name: 'Devin',
    site: 'https://docs.devin.ai/cli',
    company: 'https://cognition.com',
    command: 'devin',
    install: {
      linux: 'curl -fsSL https://cli.devin.ai/install.sh | bash',
      darwin: 'curl -fsSL https://cli.devin.ai/install.sh | bash',
      win32: 'irm https://static.devin.ai/cli/setup.ps1 | iex',
    },
    variables: [
      { name: 'WINDSURF_API_KEY', description: 'The key that devin acp signs in with', secret: true },
      { name: 'DEVIN_MODEL', description: 'The model', secret: false },
    ],
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor',
    site: 'https://cursor.com/cli',
    company: 'https://cursor.com',
    command: 'cursor-agent',
    install: {
      linux: 'curl https://cursor.com/install -fsS | bash',
      darwin: 'curl https://cursor.com/install -fsS | bash',
      win32: "irm 'https://cursor.com/install?win32=true' | iex",
    },
    variables: [
      { name: 'CURSOR_API_KEY', description: 'The Cursor API key', secret: true },
      { name: 'CURSOR_CONFIG_DIR', description: 'The config folder', secret: false },
    ],
  },
  amp: {
    id: 'amp',
    name: 'Amp',
    site: 'https://ampcode.com',
    company: 'https://ampcode.com',
    command: 'amp-acp',
    // The adapter's own README offers prebuilt binaries and `npx -y amp-acp`,
    // and no line that installs the command globally, so every system is left
    // to the page rather than given a line the project does not document.
    page: 'https://github.com/tao12345666333/amp-acp#readme',
    variables: [
      { name: 'AMP_API_KEY', description: 'The Amp API key', secret: true },
      { name: 'AMP_SKIP_UPDATE_CHECK', description: '1 stops the update check', secret: false },
    ],
  },
  qwen: {
    id: 'qwen',
    name: 'Qwen Code',
    site: 'https://qwenlm.github.io/qwen-code-docs/en/users/overview',
    company: 'https://qwen.ai',
    command: 'qwen',
    install: { all: 'npm i -g @qwen-code/qwen-code' },
    variables: [
      { name: 'OPENAI_BASE_URL', description: 'The URL of that provider', secret: false },
      { name: 'OPENAI_MODEL', description: 'The model', secret: false },
      { name: 'QWEN_HOME', description: 'The folder for the config and the sessions', secret: false },
    ],
  },
  cline: {
    id: 'cline',
    name: 'Cline',
    site: 'https://cline.bot/cli',
    company: 'https://cline.bot',
    command: 'cline',
    install: { all: 'npm install -g cline' },
    page: 'https://cline.bot/cli',
    variables: [
      { name: 'CLINE_API_KEY', description: 'The key, instead of a sign-in', secret: true },
      { name: 'CLINE_PROVIDER', description: 'The provider', secret: false },
      { name: 'CLINE_MODEL', description: 'The model', secret: false },
      { name: 'CLINE_DIR', description: 'The config folder', secret: false },
    ],
  },
  omp: {
    id: 'omp',
    name: 'omp',
    site: 'https://omp.sh',
    company: 'https://stencil.so',
    command: 'omp',
    install: {
      linux: 'curl -fsSL https://omp.sh/install | sh',
      darwin: 'curl -fsSL https://omp.sh/install | sh',
      win32: 'irm https://omp.sh/install.ps1 | iex',
    },
    page: 'https://omp.sh',
    variables: [
      { name: 'PI_CODING_AGENT_DIR', description: 'The agent folder', secret: false },
      { name: 'OMP_PROFILE', description: 'The profile', secret: false },
      { name: 'OMP_AUTH_BROKER_URL', description: 'The URL of a remote broker for keys', secret: false },
      { name: 'OMP_AUTH_BROKER_TOKEN', description: 'The token for that broker', secret: true },
    ],
  },
};
