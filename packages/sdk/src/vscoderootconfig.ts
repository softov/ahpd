import type { ConfigPropertySchema } from '@microsoft/agent-host-protocol';

/*
 * The root config keys VS Code pushes, as VS Code's agent host declares them.
 *
 * A client draws a control for every key in root `config.schema.properties`
 * and draws nothing for a key that is not there, so a setting the window
 * pushes and this host keeps has to be declared or it is a value nobody can
 * see. These are the keys the checkpoint's client pushes and the checkpoint's
 * own root schemas declare, each copied with the property it carries there.
 *
 * Every line number below is VS Code `7516b04bc94`. A `localize(...)` call
 * contributes its English string and its id is dropped, and a constant
 * contributes the literal it resolves to. The two keys whose default comes
 * from `src/vs/platform/chat/common/chatSettings.ts` name that file as a URL.
 *
 * This host acts on one of them, `globalAutoApproveEnabled`. The rest are
 * declared so that a client can draw them and so that a push of one is kept
 * and read back rather than refused; what is acted on is in `docs/AHP.md`.
 */

/**
 * The properties VS Code's own agent host declares for the keys it pushes.
 *
 * Keyed by the config key, so `ROOT_CONFIG_SCHEMA` spreads the whole map into
 * its own `properties`. The one key here this host reads is
 * `globalAutoApproveEnabled`, which `trust.ts` asks before a tool call runs.
 *
 * `workspaceTrust` is not here: it is declared beside `defaultShell` in
 * `host/root.ts`, because both belong to the connection that pushed them.
 */
export const vscodeRootProperties: Record<string, ConfigPropertySchema> = {
  // `agentHostProxyConfigDefinition.Proxy`, `agentHostSchema.ts:537`.
  'http.proxy': {
    type: 'string',
    title: 'HTTP Proxy',
    description: 'The proxy URL used by network requests from the Agent Host.',
  },
  // `agentHostProxyConfigDefinition.ProxyKerberosServicePrincipal`, `agentHostSchema.ts:542`.
  'http.proxyKerberosServicePrincipal': {
    type: 'string',
    title: 'HTTP Proxy Kerberos Service Principal',
    description: 'The Kerberos service principal used to authenticate with the HTTP proxy.',
  },
  // `agentHostProxyConfigDefinition.NoProxy`, `agentHostSchema.ts:547`.
  'http.noProxy': {
    type: 'array',
    title: 'HTTP No Proxy',
    description: 'Domain names that bypass the configured HTTP proxy.',
    items: { type: 'string', title: 'Domain' },
    default: [],
  },
  // `platformRootSchema`, `agentHostSchema.ts:809`.
  disableRepoInfoTelemetry: {
    type: 'boolean',
    title: 'Disable Repository Information Telemetry',
    description: 'Whether repository information telemetry is disabled for Agent Host sessions.',
    default: false,
  },
  /*
   * `platformRootSchema`, `agentHostSchema.ts:815`.
   *
   * The enum is `TelemetryConfiguration`'s four values, in the order upstream
   * writes them, and `ON` is what a client draws before anybody pushes one.
   */
  telemetryLevel: {
    type: 'string',
    title: 'Telemetry Level',
    description: 'Most restrictive telemetry level requested by connected clients.',
    enum: ['all', 'error', 'crash', 'off'],
    default: 'all',
  },
  // `platformRootSchema`, `agentHostSchema.ts:822`.
  editTelemetryEnabled: {
    type: 'boolean',
    title: 'Edit Telemetry',
    description: 'Whether edit attribution telemetry is enabled for Agent Host sessions.',
    default: true,
  },
  // `platformRootSchema`, `agentHostSchema.ts:828`.
  sessionSyncEnabled: {
    type: 'boolean',
    title: 'Session Sync',
    description: 'Whether remote session sync is enabled for the copilot-sdk CLI.',
    default: false,
  },
  // `platformRootSchema`, `agentHostSchema.ts:840`.
  codexAgentEnabled: {
    type: 'boolean',
    title: 'Codex Agent',
    description: 'Whether the Codex provider is enabled.',
    default: false,
  },
  // `platformRootSchema`, `agentHostSchema.ts:846`.
  terminalAutoApproveEnabled: {
    type: 'boolean',
    title: 'Terminal Auto Approve',
    description: 'Whether terminal auto-approve rules forwarded by the connected client are allowed to apply to agent-host shell permission requests.',
    default: true,
  },
  /*
   * `platformRootSchema`, `agentHostSchema.ts:852`.
   *
   * The host's rather than a window's: a push of it is one setting for
   * everybody, unlike `workspaceTrust` in `host/root.ts` beside it. It was
   * read and declared nowhere before this, so a host that approved every tool
   * call was one no client could see or turn off.
   *
   * The default is what a client draws before anybody pushes one, and it is
   * the answer the reading of a missing key already gives.
   */
  globalAutoApproveEnabled: {
    type: 'boolean',
    title: 'Global Auto Approve',
    description: "Whether VS Code's global auto-approve setting is enabled. When `true`, every tool call is auto-approved, equivalent to a session using Allow all.",
    default: false,
  },
  // `platformRootSchema`, `agentHostSchema.ts:858`. Upstream gives no description.
  autoApprovePolicyRestricted: {
    type: 'boolean',
    title: 'Auto Approve Policy Restricted',
    default: false,
    readOnly: true,
  },
  // `platformRootSchema`, `agentHostSchema.ts:878`.
  autoReplyEnabled: {
    type: 'boolean',
    title: 'Auto Reply',
    description: "Whether VS Code's auto-reply setting is enabled. When `true`, `ask_user` questions are auto-answered instead of blocking on the user, mirroring autopilot mode.",
    default: false,
  },
  // `platformRootSchema`, `agentHostSchema.ts:884`.
  systemProxyEnabled: {
    type: 'boolean',
    title: 'System Proxy Discovery',
    description: "Whether Copilot sessions automatically discover and use the operating system's proxy configuration.",
    default: true,
  },
  // `platformRootSchema`, `agentHostSchema.ts:890`.
  githubMcpServerEnabled: {
    type: 'boolean',
    title: 'GitHub MCP Server',
    description: 'Whether agent sessions include a GitHub MCP server by default.',
    default: true,
  },
  // `platformRootSchema`, `agentHostSchema.ts:896`.
  mcpToolRoutingEnabled: {
    type: 'boolean',
    title: 'MCP Tool Routing',
    description: 'Whether Copilot agent sessions use cached MCP tool metadata for routing.',
    default: false,
  },
  // `platformRootSchema`, `agentHostSchema.ts:902`.
  mcpConnectorsEnabled: {
    type: 'boolean',
    title: 'Copilot Connectors',
    description: 'Whether Copilot agent sessions expose MCP servers provided by connected Copilot Connectors.',
    default: false,
  },
  // `platformRootSchema`, `agentHostSchema.ts:908`.
  markdownPlanRichLinksEnabled: {
    type: 'boolean',
    title: 'Markdown Plan Rich Links',
    description: 'Whether agents receive guidance for using rich links and running task markers in Markdown plan documents.',
    default: false,
  },
  // `platformRootSchema`, `agentHostSchema.ts:914`.
  workspaceSnapshotEnabled: {
    type: 'boolean',
    title: 'Initial Workspace Snapshot',
    description: 'Whether the first turn of a new Copilot chat includes a bounded file-name snapshot of its working directories.',
    default: false,
  },
  // `platformRootSchema`, `agentHostSchema.ts:920`.
  agentOrchestrationLimits: {
    type: 'string',
    title: 'Agent Orchestration Limits',
    description: 'Controls creation, messaging, and recursion safety limits for Agent Host session tools.',
    enum: ['on', 'off'],
    enumDescriptions: [
      'Enforce agent orchestration safety limits.',
      'Do not enforce agent orchestration safety limits.',
    ],
    default: 'on',
  },
  /*
   * `platformRootSchema`, `agentHostSchema.ts:931`.
   *
   * The dashes are upstream's, kept so that a client reading this description
   * reads what VS Code's own host sends for the same key.
   */
  artifactTools: {
    type: 'boolean',
    title: 'Artifact Tools',
    description: 'Whether agents can record artifacts — pull requests, issues, commits, websites, files and other resources — with the artifact tools.',
    default: false,
  },
  // `platformRootSchema`, `agentHostSchema.ts:937`.
  canvasesEnabled: {
    type: 'boolean',
    title: 'Canvases',
    description: 'Whether Copilot sessions can use Canvas extensions to present interactive content.',
    default: false,
  },
  // `platformRootSchema`, `agentHostSchema.ts:943`.
  autoAttachPullRequests: {
    type: 'boolean',
    title: 'Automatic Pull Request Association',
    description: 'Whether the Agent Host automatically discovers and associates a pull request for the currently checked-out branch. When disabled, only pull requests recorded as artifacts or explicitly associated by session actions are considered.',
    default: true,
  },
  // `platformRootSchema`, `agentHostSchema.ts:949`.
  overlapProviderPreparation: {
    type: 'boolean',
    title: 'Overlap Provider Preparation',
    description: 'Whether agents prepare their session for a turn while the turn-start checkpoint is captured, instead of after it.',
    default: false,
  },
  // `platformRootSchema`, `agentHostSchema.ts:955`.
  migrateLegacyCopilotCliEnabled: {
    type: 'boolean',
    title: 'Migrate Legacy Copilot CLI Sessions',
    description: 'Whether un-adopted extension-host Copilot CLI sessions are surfaced as adoptable agent-host sessions and migrated in place when opened.',
    default: false,
  },
  // `platformRootSchema`, `agentHostSchema.ts:961`.
  sessionCatalogEnabled: {
    type: 'boolean',
    title: 'Session Catalog',
    description: 'Whether the session list is served from the central catalog. When disabled, sessions are listed from provider metadata and per-session storage instead.',
    default: true,
  },
  /*
   * `platformRootSchema`, `agentHostSchema.ts:967`.
   *
   * The five values are `ChatExternalSessionsMode`'s, in upstream's order,
   * from https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/chat/common/chatSettings.ts
   */
  showExternalSessions: {
    type: 'string',
    title: 'Show External Agent Sessions',
    description: 'Controls whether sessions created outside the Agent Host are included in the session catalog.',
    enum: ['none', 'recent', 'last24Hours', 'last7Days', 'last30Days'],
    enumDescriptions: [
      'Do not show external sessions.',
      'Show up to the 2 most recent external sessions updated in the last 7 days. At startup, external sessions older than the second-most-recently updated local session are hidden.',
      'Show external sessions updated in the last 24 hours.',
      'Show external sessions updated in the last 7 days.',
      'Show external sessions updated in the last 30 days.',
    ],
    default: 'none',
  },
  // `platformRootSchema`, `agentHostSchema.ts:981`.
  autoArchiveMergedSessionsAfterDays: {
    type: 'number',
    title: 'Auto-Archive Merged Sessions',
    description: 'Number of inactive days after which a session with a merged pull request is automatically archived. Zero disables automatic archival.',
    default: 0,
  },
  // `platformRootSchema`, `agentHostSchema.ts:987`.
  autoDeleteArchivedMergedSessionsAfterDays: {
    type: 'number',
    title: 'Auto-Delete Archived Merged Sessions',
    description: 'Number of days after automatic archival before a session with a merged pull request is permanently deleted. Zero disables permanent deletion.',
    default: 0,
  },
  // `platformRootSchema`, `agentHostSchema.ts:993`.
  copilotMultiRootEnabled: {
    type: 'boolean',
    title: 'Copilot Multiple Working Directories',
    description: 'Whether the Copilot provider advertises support for multiple working directories, letting a session span every folder of a multi-root workspace.',
    default: false,
  },
  // `platformRootSchema`, `agentHostSchema.ts:999`.
  claudeMultiRootEnabled: {
    type: 'boolean',
    title: 'Claude Multiple Working Directories',
    description: 'Whether the Claude provider advertises support for multiple working directories, letting a session span every folder of a multi-root workspace.',
    default: false,
  },
  // `platformRootSchema`, `agentHostSchema.ts:1005`.
  codexMultiRootEnabled: {
    type: 'boolean',
    title: 'Codex Multiple Working Directories',
    description: 'Whether the Codex provider advertises support for multiple working directories, letting a session span every folder of a multi-root workspace.',
    default: false,
  },
  /*
   * `platformRootSchema`, `agentHostSchema.ts:1011`.
   *
   * The default is `DEFAULT_EDIT_AUTO_APPROVE_PATTERNS`, resolved to the
   * object itself in the order that file builds it: the nine patterns it
   * writes, then the eleven of `ALWAYS_CHECKED_EDIT_PATTERNS` spread after
   * them, so the `.npmrc` pattern is the last key.
   *
   * https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/chat/common/chatSettings.ts
   */
  editAutoApprovePatterns: {
    type: 'object',
    title: 'Edit Auto Approve Patterns',
    description: 'Effective edit auto-approve patterns forwarded by the connected client for agent-host write permission checks.',
    default: {
      '**/*': true,
      '**/.git/**': false,
      '**/{package.json,server.xml,build.rs,web.config,.gitattributes,.env,Cargo.toml}': false,
      '**/{.npmrc,.yarnrc,.yarnrc.yml,.pnpmfile.js,.pnpmfile.cjs,.pnpmfile.mjs,pnpm-workspace.yaml}': false,
      '**/*.{code-workspace,csproj,fsproj,vbproj,vcxproj,proj,targets,props,gradle,gradle.kts}': false,
      '**/gradle.properties': false,
      '**/ruby_lsp/*/addon': false,
      '**/*.lock': false,
      '**/*-lock.{yaml,json}': false,
      '**/.mcp.json': false,
      '**/.npmrc': false,
      '**/.vscode/*.json': false,
      '**/.github/agents/**': false,
      '**/.github/hooks/**': false,
      '**/.claude/agents/**': false,
      '**/.claude/settings.json': false,
      '**/.claude/settings.local.json': false,
      '**/.codex/agents/**': false,
      '**/.codex/config.toml': false,
      '**/.codex/hooks.json': false,
    },
  },
  // `platformRootSchema`, `agentHostSchema.ts:1017`.
  terminalAutoApproveRules: {
    type: 'object',
    title: 'Terminal Auto Approve Rules',
    description: 'Terminal auto-approve rules forwarded by the connected client for agent-host shell permission checks.',
    default: {},
  },
  /*
   * The seven below are `agentMergeRootConfigSchema`, `agentMerge.ts:160-197`,
   * a schema of its own that `platformRootSchema` does not spread. The keys
   * keep their `agentMerge.` prefix, as upstream's other flat namespaces do,
   * and none of them carries a description.
   */
  // `agentMergeRootConfigSchema.Enabled`, `agentMerge.ts:160`.
  'agentMerge.enabled': {
    type: 'boolean',
    title: 'Agent Merge',
    default: false,
  },
  // `agentMergeRootConfigSchema.AddressReviews`, `agentMerge.ts:165`.
  'agentMerge.addressReviews': {
    type: 'boolean',
    title: 'Address Reviews',
    default: true,
  },
  // `agentMergeRootConfigSchema.FixCI`, `agentMerge.ts:170`.
  'agentMerge.fixCI': {
    type: 'boolean',
    title: 'Fix CI Failures',
    default: true,
  },
  // `agentMergeRootConfigSchema.ResolveConflicts`, `agentMerge.ts:175`.
  'agentMerge.resolveConflicts': {
    type: 'boolean',
    title: 'Resolve Conflicts',
    default: true,
  },
  // `agentMergeRootConfigSchema.MergePullRequest`, `agentMerge.ts:180`.
  'agentMerge.mergePullRequest': {
    type: 'string',
    title: 'Merge Pull Request',
    enum: ['always', 'ifUnchanged', 'never'],
    default: 'never',
  },
  // `agentMergeRootConfigSchema.MergeMethod`, `agentMerge.ts:186`.
  'agentMerge.mergeMethod': {
    type: 'string',
    title: 'Merge Method',
    enum: ['auto', 'squash', 'merge', 'rebase'],
    default: 'auto',
  },
  // `agentMergeRootConfigSchema.ReplyAttribution`, `agentMerge.ts:192`.
  'agentMerge.replyAttribution': {
    type: 'boolean',
    title: 'Reply Attribution',
    default: true,
  },
  /*
   * `automationRootConfigSchema`, `automationConfig.ts:15` and `#L21`, also a
   * schema of its own. Its timeout default is
   * `DEFAULT_AGENT_HOST_AUTOMATION_RUN_TIMEOUT_MINUTES`, which is 30.
   */
  // `automationRootConfigSchema.AUTOMATIONS_ENABLED`, `automationConfig.ts:15`.
  automationsEnabled: {
    type: 'boolean',
    title: 'Automations',
    description: 'Whether this Agent Host may run automations.',
    default: false,
  },
  // `automationRootConfigSchema.AUTOMATION_RUN_TIMEOUT_MINUTES`, `automationConfig.ts:21`.
  automationRunTimeoutMinutes: {
    type: 'number',
    title: 'Automation Run Timeout',
    description: 'Maximum duration of an automation run, in minutes.',
    default: 30,
  },
};
