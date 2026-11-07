import { expect, it } from 'vitest';
import { claudeManagedSettingsOf } from '../src/managed.js';

/*
 * The operator's managed settings in Claude Code's grammar.
 *
 * The host hands every backend the operator's managed rules and per-tool
 * eligibility, and Claude Code takes them as the policy tier its embedding
 * application supplies. A rule is written in Claude Code's grammar where a
 * Claude Code rule names the calls it names, and left out where each would
 * name more or fewer, as VS Code's bridge writes a setting in its runtime's
 * grammar.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedSettings.ts#L27-L30
 * https://code.claude.com/docs/en/managed-settings#let-an-embedding-host-add-policy
 */

/** The session's folder the cases anchor a path in. */
const CWD = '/work/repo';

/** The ask rules handed for some managed ask rules. */
const asked = (ask: string[]): unknown => claudeManagedSettingsOf({ permissions: { ask } }, CWD)?.permissions?.ask;

/** The deny rules handed for some managed deny rules. */
const denied = (deny: string[]): unknown => claudeManagedSettingsOf({ permissions: { deny } }, CWD)?.permissions?.deny;

/*
 * The family names `Bash` and `PowerShell` alike, and a command the host reads
 * bare and with arguments where it carries no wildcard, which Claude Code
 * writes with a trailing ` *`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedRules.ts#L79-L81
 * https://code.claude.com/docs/en/permissions#wildcard-patterns
 */
it('writes a managed shell rule as a Bash and a PowerShell rule, a command with no wildcard bare and with arguments', () => {
  expect(denied(['Shell'])).toEqual(['Bash', 'PowerShell']);
  expect(denied(['Shell(*)'])).toEqual(['Bash', 'PowerShell']);
  expect(asked(['Shell(git push)'])).toEqual(['Bash(git push *)', 'PowerShell(git push *)']);
  expect(asked(['Shell(npm run *)', 'Shell(* --version)', 'Shell(git:*)'])).toEqual([
    'Bash(npm run *)', 'PowerShell(npm run *)',
    'Bash(* --version)', 'PowerShell(* --version)',
    'Bash(git:*)', 'PowerShell(git:*)',
  ]);
});

/*
 * The host reads `/<pattern>/<flags>` as a regular expression and
 * `commandLine:` against the whole line, and an unmatched `(` as naming
 * nothing; Claude Code reads `<field>:<value>` as a match on a tool's input.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/permissionRules.ts#L141-L161
 * https://code.claude.com/docs/en/permissions#match-by-input-parameter
 */
it('leaves out a shell rule the host reads as a regular expression, against the whole line or as naming nothing, and one Claude Code reads as an input field', () => {
  expect(asked(['Shell(/rm .*/i)', 'Shell(commandLine:git *)', 'Shell(echo (x)', 'Shell(timeout:5)', 'Shell( git)'])).toBeUndefined();
});

/*
 * Claude Code's bare `Read` matches every file read and its `Edit` rules every
 * tool that edits a file; a read deny there refuses the edits and the writes
 * of its path too, which a managed read deny leaves alone.
 * https://code.claude.com/docs/en/permissions#match-all-uses-of-a-tool
 * https://code.claude.com/docs/en/tools-reference#configure-tools-with-permission-rules-and-hooks
 */
it('writes every read and every write as Claude Code\'s Read and Edit, and leaves a read deny to the host', () => {
  expect(asked(['Read', 'Write'])).toEqual(['Read', 'Edit']);
  expect(denied(['Write', 'Edit(//etc/**)'])).toEqual(['Edit', 'Edit(//etc/**)']);
  expect(denied(['Read', 'Read(//etc/**)'])).toBeUndefined();
});

/*
 * The host anchors `//` at the root, `~/` at the home and any other path in
 * the session's folder, and Claude Code's `//` is an absolute path.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/permissionRules.ts#L254-L286
 * https://code.claude.com/docs/en/permissions#how-path-patterns-match
 */
it('anchors a path rule where the host anchors it, in Claude Code\'s absolute form', () => {
  expect(asked(['Read(//etc/../srv/**/*.env)', 'Read(~/secrets/**)', 'Write(src/**)', 'Write(/docs/*.md)', 'Read(**/.env)'])).toEqual([
    'Read(//srv/**/*.env)', 'Read(~/secrets/**)', 'Edit(//work/repo/src/**)', 'Edit(//work/repo/docs/*.md)', 'Read(//work/repo/**/.env)',
  ]);
});

/*
 * Brackets and braces read apart in VS Code's glob and gitignore patterns, a
 * trailing `/` is a folder to gitignore, and a drive letter is a path Claude
 * Code spells otherwise.
 * https://code.claude.com/docs/en/permissions#how-path-patterns-match
 */
it('leaves out a path rule whose glob gitignore reads apart, a home path that moves, and a drive letter', () => {
  expect(asked(['Read(//etc/{a,b}/**)', 'Read(//etc/[ab])', 'Read(//etc/ssl/)', 'Read(~/a/../b)', 'Read(//c:/Users/**)', 'Read(C:/Users/**)'])).toBeUndefined();
  expect(claudeManagedSettingsOf({ permissions: { ask: ['Read(src/**)'] } }, 'C:\\work')).toBeUndefined();
});

/*
 * The host names a domain by the host VS Code's network filter reads from a
 * URL, a `*.` pattern the domain and its subdomains; Claude Code's `domain:`
 * rules match the host name, a `*.` one its subdomains alone.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/networkFilter/common/domainMatcher.ts#L208-L241
 * https://code.claude.com/docs/en/permissions#webfetch
 */
it('writes a domain rule by its host, a wildcard one as the domain and its subdomains', () => {
  expect(denied(['Domain'])).toEqual(['WebFetch(domain:*)']);
  expect(asked(['Domain(example.com)', 'Domain(*.example.org)', 'Domain(https://Docs.Example.net:8443/x)'])).toEqual([
    'WebFetch(domain:example.com)', 'WebFetch(domain:example.org)', 'WebFetch(domain:*.example.org)', 'WebFetch(domain:docs.example.net)',
  ]);
  expect(asked(['Domain(example.*)'])).toBeUndefined();
});

/*
 * The lock is Claude Code's own key, and Claude Code asks about a call an ask
 * rule names in every mode, `bypassPermissions` included, so an eligibility
 * ask hands the rule alone.
 * https://code.claude.com/docs/en/permissions#permission-modes
 * https://code.claude.com/docs/en/permission-modes#actions-no-mode-auto-approves
 */
it('hands the bypass lock as Claude Code\'s own, and the eligibility\'s asks as ask rules alone', () => {
  expect(claudeManagedSettingsOf({ permissions: { disableBypassPermissionsMode: 'disable' } }, CWD))
    .toEqual({ permissions: { disableBypassPermissionsMode: 'disable' } });
  expect(claudeManagedSettingsOf({ eligibleForAutoApproval: { Bash: false } }, CWD))
    .toEqual({ permissions: { ask: ['Bash', 'mcp__client__Bash'] } });
});

/*
 * The host reads a key as a backend's own tool or a client's by its name, the
 * host's tool as `ahp/<name>` and an MCP server's as `<server>/<tool>`, and
 * the CLI names them `<name>`, `mcp__client__<name>`, `mcp__host__<name>` and
 * `mcp__<server>__<tool>`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedSettings.ts#L31-L42
 * https://code.claude.com/docs/en/permissions#mcp
 */
it('asks about each tool the eligibility sets false, by each name Claude Code gives it', () => {
  expect(claudeManagedSettingsOf({
    eligibleForAutoApproval: {
      runInTerminal: false,
      'ahp/create_session': false,
      'github/create_issue': false,
      'linear/*': false,
      mcp__notes__append: false,
      WebFetch: true,
    },
  }, CWD)?.permissions?.ask).toEqual([
    'runInTerminal', 'mcp__client__runInTerminal', 'mcp__host__create_session', 'mcp__github__create_issue', 'mcp__linear__*', 'mcp__notes__append',
  ]);
});

/*
 * An exact key keeps a tool of its server eligible past `<server>/*`, which an
 * ask rule holding over every allow rule cannot carve out; and the CLI
 * rewrites a server's name with a character outside a tool name's.
 * https://code.claude.com/docs/en/permissions#manage-permissions
 * https://code.claude.com/docs/en/permissions#mcp
 */
it('leaves out a server\'s wildcard where a key keeps one of its tools eligible, and a name the CLI rewrites', () => {
  expect(claudeManagedSettingsOf({
    eligibleForAutoApproval: {
      'github/*': false,
      'github/list_issues': true,
      'my.server/run': false,
      'reports__v2/*': false,
      'host/run': false,
      mcp__github: false,
      'Bash(rm *)': false,
    },
  }, CWD)).toBeUndefined();
});

/*
 * A boundary denies every domain but its own, and a deny rule in Claude Code
 * holds over every allow rule beside it.
 * https://code.claude.com/docs/en/permissions#manage-permissions
 */
it('hands nothing where the operator set nothing Claude Code\'s grammar carries', () => {
  expect(claudeManagedSettingsOf({ permissions: { limitTo: ['Domain(example.com)'] } }, CWD)).toBeUndefined();
  expect(claudeManagedSettingsOf(undefined, CWD)).toBeUndefined();
});
