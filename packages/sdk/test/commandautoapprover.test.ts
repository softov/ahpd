import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { posix } from '../../../tools/posix.ts';
import { CommandAutoApprover, DEFAULT_TERMINAL_AUTO_APPROVE_RULES } from '../src/access/commandautoapprover.js';
import type {
  CommandApprovalOptions, CommandSplitter, TerminalAutoApprovePatterns, TerminalAutoApproveRules,
} from '../src/access/commandautoapprover.js';
import { vscodeRootProperties } from '../src/vscoderootconfig.js';

/*
 * What the rules say about a command line.
 *
 * The cases are VS Code's, from `commandAutoApprover.test.ts` at `a959ba62444`,
 * less the ones that need a parse this file does not have - those are named in
 * the plan's Resume. `denied` and `noMatch` are both the caller being asked;
 * they differ in which rule spoke, and a case bound on one of them says so.
 */

const approver = new CommandAutoApprover();

/** What the rules say about a bash line. */
const bash = (line: string, options: CommandApprovalOptions = {}): string => approver.evaluate(line, options);
/** What the rules say about a PowerShell line. */
const powershell = (line: string, options: CommandApprovalOptions = {}): string =>
  approver.evaluate(line, { ...options, shell: 'powershell' });

describe('the rules a line is answered by', () => {
  it('approves a line that runs nothing', () => {
    expect(bash('')).toBe('approved');
    expect(bash('   ')).toBe('approved');
  });

  it('answers noMatch when no rule names the command', () => {
    expect(bash('my-custom-script')).toBe('noMatch');
    expect(bash('python script.py')).toBe('noMatch');
    expect(bash('node index.js')).toBe('noMatch');
  });

  it('takes the rules it is handed rather than the table of its own', () => {
    expect(bash('echo hello', { rules: { echo: false } })).toBe('denied');
    expect(bash('python script.py', { rules: { python: true } })).toBe('approved');
    // A null entry is a rule no table carries, which is no rule at all.
    expect(bash('echo hello', { rules: { echo: null } })).toBe('noMatch');
    // An empty table is a table rather than a fallback to the default.
    expect(bash('echo hello', { rules: {} })).toBe('noMatch');
    expect(bash('rm file.txt', { rules: {} })).toBe('noMatch');
  });

  it('matches a key as a command prefix and as a regular expression', () => {
    expect(bash('grep -r needle .')).toBe('approved');
    // A key names a word of the command, so a longer word is another command.
    expect(bash('grepper --run')).toBe('noMatch');
    expect(bash('npm ls')).toBe('approved');
    expect(bash('npm run build', { rules: { '/^npm\\s+run\\s+build$/': true } })).toBe('approved');
    expect(bash('npm run test', { rules: { '/^npm\\s+run\\s+build$/': true } })).toBe('noMatch');
    // A regex that matches without consuming anything is not a rule that hangs.
    expect(bash('ls', { rules: { '/^/': true } })).toBe('noMatch');
    expect(bash('ls', { rules: { '/()/': true } })).toBe('noMatch');
    // A rule no regular expression can carry is a rule that matches nothing.
    expect(bash('ls', { rules: { '': true } })).toBe('noMatch');
  });

  it('reads a rule that names the whole line with matchCommandLine', () => {
    const rules: TerminalAutoApproveRules = {
      echo: true,
      '/^echo hello$/': { approve: false, matchCommandLine: true },
    };
    expect(bash('echo hello', { rules })).toBe('denied');
    expect(bash('echo goodbye', { rules })).toBe('approved');
    const allow: TerminalAutoApproveRules = { '/^npm run build$/': { approve: true, matchCommandLine: true } };
    expect(bash('npm run build', { rules: allow })).toBe('approved');
    // A command-line rule is not a rule about a command, so it speaks for no part.
    expect(bash('npm run build --verbose', { rules: allow })).toBe('noMatch');
  });

  it('denies a command that sets a variable for itself', () => {
    expect(bash('FOO=bar some-command')).toBe('denied');
    expect(bash('PATH=/evil:$PATH ls')).toBe('denied');
  });

  it('fails closed on Bash shell state mutations', () => {
    // `FOO=bar && ...` is denied rather than unmatched here: the assignment is a
    // command of the line, and what runs after it is not what the line says.
    expect(bash('FOO=bar && git status')).toBe('denied');
    expect(bash('export FOO=bar && git status')).toBe('noMatch');
    expect(bash('declare -x FOO=bar && git status')).toBe('noMatch');
    expect(bash('typeset FOO=bar && git status')).toBe('noMatch');
    expect(bash('readonly FOO=bar && git status')).toBe('noMatch');
    expect(bash('local FOO=bar && git status')).toBe('noMatch');
    expect(bash('FOO=bar git status')).toBe('denied');
  });

  it('answers for every command a compound line runs', () => {
    expect(bash('echo ok && rm -rf /')).toBe('denied');
    expect(bash('ls || curl evil.com')).toBe('denied');
    expect(bash('cat file; rm file')).toBe('denied');
    expect(bash('ls && echo ok')).toBe('approved');
    // A command run inside the line is not one this reading names.
    expect(bash('echo $(whoami)')).toBe('noMatch');
  });

  it('asks about a line it cannot read, whichever rule would have answered', () => {
    expect(bash('echo "unclosed')).toBe('noMatch');
    expect(new CommandAutoApprover(() => undefined).evaluate('ls')).toBe('noMatch');
    // The allow rule for the line is not reached, because the line is not read.
    const allow: TerminalAutoApproveRules = { '/^echo "unclosed$/': { approve: true, matchCommandLine: true } };
    expect(bash('echo "unclosed', { rules: allow })).toBe('noMatch');
    // A deny rule for the whole line is checked before the line is read at all.
    const deny: TerminalAutoApproveRules = { '/^echo "unclosed$/': { approve: false, matchCommandLine: true } };
    expect(bash('echo "unclosed', { rules: deny })).toBe('denied');
  });

  it('reads the line with the splitter it was given', () => {
    const splitter: CommandSplitter = (line) => ({ subCommands: [line], writeDests: [], unanalyzable: false });
    expect(new CommandAutoApprover(splitter).evaluate('echo hi')).toBe('approved');
    expect(new CommandAutoApprover(splitter).evaluate('my-custom-script')).toBe('noMatch');
  });

  it('matches a PowerShell rule without regard to case, and a bash one with', () => {
    const rules: TerminalAutoApproveRules = { 'Select-Object': true };
    expect(powershell('Select-Object Name', { rules })).toBe('approved');
    expect(powershell('select-object Name', { rules })).toBe('approved');
    expect(powershell('SELECT-OBJECT Name', { rules })).toBe('approved');
    expect(bash('select-object Name', { rules })).toBe('noMatch');
    // PowerShell writes a command in parentheses as an expression over its output.
    expect(powershell('(Select-Object Name).Count', { rules })).toBe('approved');
  });

  it('keeps the casing of a rule that names the whole line', () => {
    const allow: TerminalAutoApproveRules = { '/^Get-ChildItem$/': { approve: true, matchCommandLine: true } };
    expect(powershell('Get-ChildItem', { rules: allow })).toBe('approved');
    expect(powershell('get-childitem', { rules: allow })).toBe('noMatch');

    const deny: TerminalAutoApproveRules = {
      'Get-ChildItem': true,
      '/^Get-ChildItem -Force$/': { approve: false, matchCommandLine: true },
    };
    expect(powershell('Get-ChildItem -Force', { rules: deny })).toBe('denied');
    expect(powershell('get-childitem -Force', { rules: deny })).toBe('approved');
    const insensitive: TerminalAutoApproveRules = {
      'Get-ChildItem': true,
      '/^Get-ChildItem -Force$/i': { approve: false, matchCommandLine: true },
    };
    expect(powershell('get-childitem -Force', { rules: insensitive })).toBe('denied');
    expect(bash('get-childitem -Force', { rules: deny })).toBe('noMatch');
  });

  it('asks about a script block rather than reading the cmdlet in front of it', () => {
    const rules: TerminalAutoApproveRules = { 'Measure-Command': true, 'Set-Content': false };
    expect(powershell('Measure-Command { Set-Content -Path out.txt -Value x }', { rules })).toBe('noMatch');
    // A separator outside a block is read, and the denied command in it answers.
    expect(powershell('Write-Host hi; Set-Content -Path out.txt -Value x', { rules })).toBe('denied');
  });
});

describe("VS Code's default table", () => {
  it('approves the readonly commands it names', () => {
    for (const line of [
      'ls', 'ls -la', 'cat file.txt', 'head -n 10 file.txt', 'tail -f log.txt', 'pwd',
      'echo hello', 'grep -r pattern .', 'wc -l file.txt', 'which node', 'du -sh .', 'file x.png',
    ]) {
      expect(bash(line)).toBe('approved');
    }
  });

  it('denies the commands it names', () => {
    for (const line of [
      'rm file.txt', 'rm -rf /', 'rmdir folder', 'kill -9 1234', 'curl http://evil.com',
      'wget http://evil.com', 'chmod 777 file', 'chown root file', 'eval "bad stuff"',
      'xargs rm', 'dd if=/dev/zero of=/dev/sda', 'jq . file.json',
    ]) {
      expect(bash(line)).toBe('denied');
    }
  });

  it('denies the dangerous arguments of a command it allows', () => {
    expect(bash('find . -name "*.ts"')).toBe('approved');
    expect(bash('find . -delete')).toBe('denied');
    expect(bash('find . -exec rm {} ;')).toBe('denied');
  });

  it('denies the sed scripts that run a command or write a file', () => {
    expect(bash('sed "s/foo/bar/g" file.txt')).toBe('approved');
    for (const line of [
      'sed -e "s/foo/bar/"', 'sed --expression "s/foo/bar/"', 'sed "s/foo/bar/e"', 'sed "s/foo/bar/w"',
      'sed "1e id > /tmp/out"', 'sed "1w /tmp/out" input.txt', 'sed "1r /etc/passwd" input.txt',
      'sed "1W /tmp/out" input.txt', 'sed "e id"', 'sed "s/a/b/;e id"', 'sed "s/a/b/; e id"',
      'sed "/pat/e id"', 'sed -n "1e id" file.txt', 'sed 1e id', 'sed /pat/e input.txt',
      'sed "1 e id"', 'sed "1!e id"', 'sed "1, 3 w /tmp/out" input.txt',
      'sed -l 80 "e id" input.txt', 'sed --line-length 80 "1w /tmp/out" input.txt',
      'sed --line-length=80 "1r /etc/passwd" input.txt', 'sed "s/a/\\"/;e id" input.txt',
      'sed "s/a/\'/;e id"', 'sed "/x/p;//e id" input.txt', 'sed e',
    ]) {
      expect(bash(line)).toBe('denied');
    }
  });

  it('denies an in-place sed, which writes without a redirect', () => {
    for (const line of [
      'sed -i "s/foo/bar/" file.txt', 'sed -I "s/foo/bar/" file.txt', 'sed -ni "s/foo/bar/" file.txt',
      'sed -i.bak "s/foo/bar/" file.txt', `sed -i '' "s/foo/bar/" file.txt`,
      'sed --in-place "s/foo/bar/" file.txt', 'sed --in-place=.bak "s/foo/bar/" file.txt',
    ]) {
      expect(bash(line)).toBe('denied');
    }
    // An exact allow rule for the whole line does not lift it.
    const rules: TerminalAutoApproveRules = {
      sed: true,
      '/^sed -i "s\\/foo\\/bar\\/" file\\.txt$/': { approve: true, matchCommandLine: true },
    };
    expect(bash('sed -i "s/foo/bar/" file.txt', { rules })).toBe('denied');
  });

  it('approves the git sub-commands it names', () => {
    for (const line of [
      'git status', 'git log --oneline', 'git diff HEAD', 'git diff --output-indicator-new=+ HEAD',
      'git show HEAD', 'git show --format=%B HEAD', 'git --no-pager show HEAD', 'git -C repo show HEAD',
      'git show --output-format=text HEAD', 'git ls-files', 'git branch',
    ]) {
      expect(bash(line)).toBe('approved');
    }
  });

  it('denies the git operations that write a file or delete a branch', () => {
    for (const line of [
      'git branch -D main', 'git branch --delete main', 'git log --output=/tmp/out',
      'git diff --output=changes.diff HEAD', 'git diff --output changes.diff HEAD',
      'git diff --stat --output=changes.diff HEAD', 'git --no-pager diff --output=changes.diff HEAD',
      'git -C repo diff --output changes.diff HEAD', 'git diff --out\\put=changes.diff HEAD',
      'git diff --out"put"=changes.diff HEAD', 'git show --output=message.txt HEAD',
      'git show --output message.txt HEAD', 'git show --format=%B --output=message.txt HEAD',
      'git --no-pager show --output=message.txt HEAD', 'git -C repo show --output message.txt HEAD',
    ]) {
      expect(bash(line)).toBe('denied');
    }
  });

  it('requires confirmation for the git grep pager options', () => {
    const approved = [
      'git grep needle', 'git grep -n needle', 'git grep -o needle', 'git grep -e TODO',
      'git grep -eTODO', 'git grep --only-matching needle', 'git -C repo grep needle',
      'git --no-pager grep needle',
    ];
    const denied = [
      'git grep -O needle', 'git grep -Osh -e needle', 'git grep -nOsh -e needle',
      'git grep --open-files-in-pager -e needle', 'git grep --open-files-in-pager=sh -e needle',
      'git --no-pager -C repo grep --"op=sh" -e needle', "git --no-pager -C repo grep --'op=sh' -e needle",
    ];
    for (const line of approved) {
      expect(bash(line)).toBe('approved');
      expect(powershell(line)).toBe('approved');
    }
    for (const line of denied) {
      expect(bash(line)).toBe('denied');
      expect(powershell(line)).toBe('denied');
    }
  });

  it('keeps the git directory option case-sensitive in both shells', () => {
    expect(bash('git -C dir status')).toBe('approved');
    expect(powershell('git -C dir status')).toBe('approved');
    expect(bash('git -c core.pager=x status')).toBe('noMatch');
    expect(powershell('git -c core.pager=x status')).toBe('noMatch');
    const safe = ['status', 'log', 'show', 'diff', 'ls-files', 'grep needle', 'branch'];
    for (const subcommand of safe) expect(bash(`git -C repo ${subcommand}`)).toBe('approved');
    for (const subcommand of safe) expect(powershell(`git -C repo ${subcommand}`)).toBe('approved');
    for (const subcommand of safe) expect(bash(`git -c key=value ${subcommand}`)).toBe('noMatch');
    for (const subcommand of safe) expect(powershell(`git -c key=value ${subcommand}`)).toBe('noMatch');
    expect(powershell('git --no-pager -c core.pager=program log')).toBe('noMatch');
    expect(powershell('git -C repo -c diff.external=program diff')).toBe('noMatch');
    // The whole rule is matched with case, so the word naming the command is too.
    expect(powershell('GIT -C repo DIFF')).toBe('noMatch');
  });

  it('approves a sort and denies the options that write or execute', () => {
    for (const line of [
      'sort input.txt', 'sort --check input.txt', 'sort --check=quiet input.txt',
      'sort "--check" input.txt', 'sort --buffer-size=1K input.txt',
    ]) {
      expect(bash(line)).toBe('approved');
    }
    for (const line of [
      'sort -o output.txt input.txt', 'sort -S 1G input.txt',
      'sort --compress-program=/bin/sh input.txt', 'sort --compress-program /bin/sh input.txt',
      'sort --compress-prog=/bin/sh input.txt', 'sort --compress-p=/bin/sh input.txt',
      'sort --com=/bin/sh input.txt', 'sort --co=/bin/sh input.txt',
      'sort "--compress-program=/bin/sh" input.txt', "sort '--compress-prog=/bin/sh' input.txt",
      'sort \\-\\-compress-program=/bin/sh input.txt', 'sort --compress-program\\=/bin/sh input.txt',
      'sort --"compress-program=/bin/sh" input.txt', "sort $'--compress-program=/bin/sh' input.txt",
    ]) {
      expect(bash(line)).toBe('denied');
    }
  });

  it('approves a package manager command and denies one with options', () => {
    const exact = ['npm ci', 'npm ci   ', 'yarn install --frozen-lockfile', 'yarn  install  --frozen-lockfile   ',
      'pnpm install --frozen-lockfile'];
    const withOptions = ['npm ci --prefix /outside/project', 'npm ci -w other', 'npm ci --workspaces',
      'yarn install --frozen-lockfile --cwd /outside/project', 'yarn install --frozen-lockfile --no-lockfile',
      'pnpm install --frozen-lockfile -C /outside/project', 'pnpm install --frozen-lockfile --no-frozen-lockfile'];
    for (const line of exact) expect(bash(line)).toBe('approved');
    for (const line of withOptions) expect(bash(line)).toBe('denied');
  });

  it('keeps a null entry as no rule rather than as a denial', () => {
    const rules: TerminalAutoApproveRules = {
      'npm ci': null,
      '/^npm\\s+ci\\s+\\S/': false,
    };
    expect(bash('npm ci', { rules })).toBe('noMatch');
    expect(bash('npm ci --prefix other', { rules })).toBe('denied');
  });

  it('denies the dangerous commands it names for PowerShell', () => {
    expect(powershell('Remove-Item file.txt')).toBe('denied');
    expect(powershell('Invoke-Expression "bad"')).toBe('denied');
    expect(powershell('Invoke-WebRequest http://evil.com')).toBe('denied');
    expect(powershell('Stop-Process -Id 1234')).toBe('denied');
    expect(powershell('IEX "bad"')).toBe('denied');
  });

  it('approves the PowerShell cmdlets it names, without regard to case', () => {
    for (const line of [
      'Get-ChildItem', 'Get-Content file.txt', 'Write-Host "hello"', 'Select-Object Name',
      'Measure-Object Length', 'Compare-Object $a $b', 'Format-Table', 'Sort-Object Name',
      'select-object Name', 'SELECT-OBJECT Name', 'measure-object Length',
    ]) {
      expect(powershell(line)).toBe('approved');
    }
  });

  it('does not approve a PowerShell cmdlet by its verb', () => {
    for (const line of ['Select-Custom', 'Measure-Command', 'Compare-Custom', 'Format-Hex', 'Sort-Custom']) {
      expect(powershell(line)).toBe('noMatch');
    }
  });

  it('exports the table it answers by', () => {
    expect(DEFAULT_TERMINAL_AUTO_APPROVE_RULES['ls']).toBe(true);
    expect(DEFAULT_TERMINAL_AUTO_APPROVE_RULES['rm']).toBe(false);
    expect(DEFAULT_TERMINAL_AUTO_APPROVE_RULES['git status']).toBeUndefined();
    expect(bash('ls')).toBe('approved');
    expect(bash('rm file.txt')).toBe('denied');
  });
});

describe('a PowerShell line', () => {
  it('reads the shapes it can follow and asks about the rest', () => {
    expect(powershell('Get-ChildItem -Recurse')).toBe('approved');
    expect(powershell('Get-ChildItem | Select-Object Name')).toBe('approved');
    expect(powershell('Get-ChildItem `\n  -Path .')).toBe('approved');
    expect(powershell('(Get-Content README.md).Length')).toBe('approved');
    // A substitution runs a command this reading does not name, so it asks.
    expect(powershell('Write-Host $(Get-Date)')).toBe('noMatch');
    expect(powershell('Write-Host $(Remove-Item x)')).toBe('noMatch');
  });

  it('masks an option written as --flag=value', () => {
    expect(powershell('git log --format="%h|%s" -5')).toBe('approved');
    expect(powershell('git log --format="a|b"; Remove-Item x')).toBe('denied');
  });

  it('asks about a line that was cut off', () => {
    expect(powershell('Write-Output before; "unterminated')).toBe('noMatch');
    expect(powershell('Write-Output before; `Write-Output after')).toBe('noMatch');
    expect(powershell('if ($x -eq')).toBe('noMatch');
    expect(powershell('Get-ChildItem -Recurse')).toBe('approved');
  });

  it('reads a script block as opaque in bash and refuses it in PowerShell', () => {
    const rules: TerminalAutoApproveRules = {
      'Measure-Command': true,
      'Where-Object': true,
      'Set-Content': false,
      'Start-Process': false,
      'Invoke-Expression': false,
    };
    expect(powershell('Get-ChildItem | Where-Object { Remove-Item $_ }', { rules })).toBe('noMatch');
    expect(powershell('Get-ChildItem | ForEach-Object { Invoke-Expression $_ }', { rules })).toBe('noMatch');
    expect(powershell('Measure-Command { Set-Content -Path out.txt -Value pwned }', { rules })).toBe('noMatch');
    expect(powershell('Measure-Command { Invoke-Expression "Write-Output hi" }', { rules })).toBe('noMatch');
    expect(powershell('Get-ChildItem | Where-Object { Start-Process notepad }', { rules })).toBe('noMatch');
    expect(powershell('Write-Host hi; Set-Content -Path out.txt -Value pwned', { rules })).toBe('denied');
    // A bash block is opaque to this reading, as it is to upstream's bash grammar.
    expect(bash('Measure-Command { Set-Content -Path out.txt -Value pwned }', { rules })).toBe('approved');
  });

  it('asks about an assignment or a method call inside a command it allows', () => {
    for (const line of [
      '$env:GIT_SSH_COMMAND="evil"; git status',
      'Write-Output ($env:FOO="evil"); Get-ChildItem',
      'Get-ChildItem | Where-Object { $env:FOO="evil"; $true }',
      'Get-ChildItem; [System.IO.File]::Delete("x")',
      'Get-ChildItem | Where-Object { [System.IO.File]::Delete($_.FullName) }',
      'Get-ChildItem; $obj.Delete()',
      '[Math]::Max(1, 2) | Out-String',
      "Out-String -InputObject ([scriptblock]::Create('Write-Output ok').Invoke())",
      'Write-Output ([math]::Round(1.5))',
    ]) {
      expect(powershell(line)).toBe('noMatch');
    }
    // A property access runs no method, so it stays approved.
    expect(powershell('(Get-Content README.md).Length')).toBe('approved');
  });

  it('requires an analyzable line for an exact allow rule', () => {
    const parseErrorAllow: TerminalAutoApproveRules = { '/^if \\(\\$x -eq$/': { approve: true, matchCommandLine: true } };
    const parseErrorDeny: TerminalAutoApproveRules = { '/^if \\(\\$x -eq$/': { approve: false, matchCommandLine: true } };
    const invocationAllow: TerminalAutoApproveRules = {
      '/^Write-Output \\(\\[math\\]::Round\\(1\\.5\\)\\)$/': { approve: true, matchCommandLine: true },
    };
    const redirectAllow: TerminalAutoApproveRules = {
      Write: true,
      '/^Write-Host hi >out\\.txt$/': { approve: true, matchCommandLine: true },
    };
    const deniedSubCommand: TerminalAutoApproveRules = {
      Get: true,
      Remove: false,
      '/^Get-ChildItem; Remove-Item x$/': { approve: true, matchCommandLine: true },
    };
    expect(powershell('if ($x -eq', { rules: parseErrorAllow })).toBe('noMatch');
    expect(powershell('if ($x -eq', { rules: parseErrorDeny })).toBe('denied');
    expect(powershell('Write-Output ([math]::Round(1.5))', { rules: invocationAllow })).toBe('noMatch');
    expect(powershell('Write-Host hi >out.txt', { rules: redirectAllow })).toBe('noMatch');
    expect(powershell('Get-ChildItem; Remove-Item x', { rules: deniedSubCommand })).toBe('denied');
  });
});

describe('a write redirect', () => {
  /** A folder to write in, with the links followed so a path inside it is one path. */
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ahpd-approver-')));
  const folder = join(root, 'project');
  mkdirSync(folder);
  mkdirSync(join(folder, '.git'));
  mkdirSync(join(root, 'elsewhere'));
  writeFileSync(join(root, 'elsewhere', 'out.txt'), '');
  // A junction on Windows, which links a folder with no privilege and resolves as a link does.
  symlinkSync(join(root, 'elsewhere'), join(folder, 'link'), posix ? 'dir' : 'junction');
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  /** The edit patterns a client pushes, as `editAutoApprovePatterns` writes them. */
  const patterns: TerminalAutoApprovePatterns = { '**/*': true, '**/.git/**': false };
  const here = { workingDirectory: folder, editPatterns: patterns };

  /** What the default edit patterns of a client make of a target in the folder. */
  const pushed = vscodeRootProperties['editAutoApprovePatterns']?.default as TerminalAutoApprovePatterns;

  it('approves a target in the working folder that the patterns allow', () => {
    expect(bash('echo hi > out.txt', here)).toBe('approved');
    expect(bash('echo hi > sub/dir/out.txt', here)).toBe('approved');
    expect(bash('cat file > out.txt', here)).toBe('approved');
    expect(bash('ls -la >> listing.txt 2> err.log', here)).toBe('approved');
    // The target is the path it names, whether it is quoted or glued to the operator.
    expect(bash('echo hi >"out.txt"', here)).toBe('approved');
    expect(bash(`echo hi > 'out file.txt'`, here)).toBe('approved');
  });

  it('asks when a target leaves the working folder', () => {
    expect(bash('echo hi > /etc/passwd', here)).toBe('noMatch');
    expect(bash('echo hi > ../out.txt', here)).toBe('noMatch');
    expect(bash('echo hi > sub/../../out.txt', here)).toBe('noMatch');
    expect(bash(`echo id > '${join(root, 'elsewhere', 'out.txt')}'`, here)).toBe('noMatch');
    // A link inside the folder is not the folder the command was allowed to write in.
    expect(bash('echo hi > link/out.txt', here)).toBe('noMatch');
    expect(bash('echo hi > link/new.txt', here)).toBe('noMatch');
  });

  it('asks when the patterns deny the target', () => {
    expect(bash('echo hi > .git/config', here)).toBe('noMatch');
    expect(bash('echo hi > sub/.git/hooks/pre-commit', here)).toBe('noMatch');
    // A pattern that denies is read before one that allows, wherever it was written.
    expect(bash('echo hi > secret/out.txt', { ...here, editPatterns: { '**/*': true, '**/secret/**': false } }))
      .toBe('noMatch');
    expect(bash('echo hi > secret/out.txt', { ...here, editPatterns: { '**/secret/**': false, '**/*': true } }))
      .toBe('noMatch');
    // Nothing matching the target is not an approval either.
    expect(bash('echo hi > out.txt', { ...here, editPatterns: { '**/*.log': true } })).toBe('noMatch');
  });

  it('asks when the target is a path the shell finishes reading', () => {
    expect(bash('echo id >> ~/.bashrc', here)).toBe('noMatch');
    expect(bash('echo id > $HOME/.bashrc', here)).toBe('noMatch');
    expect(bash('echo id > ${HOME}/.bashrc', here)).toBe('noMatch');
    expect(bash('echo id > out-$(date).txt', here)).toBe('noMatch');
  });

  /*
   * A sensitive edit location keeps a write under it asking, whatever the
   * patterns allow, as the reference host judges a redirect.
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/sessionPermissions.ts#L774-L815
   */
  it('asks when the target is in a sensitive location', () => {
    mkdirSync(join(folder, '.github', 'hooks'), { recursive: true });
    symlinkSync(join(folder, '.github', 'hooks'), join(folder, 'hooks'), posix ? 'dir' : 'junction');
    const sensitive = [{ path: '.github/hooks', isDirectory: true }, { path: 'AGENTS.md', isDirectory: false }];
    expect(bash('echo hi > .github/hooks/a.json', here)).toBe('approved');
    expect(bash('echo hi > .github/hooks/a.json', { ...here, sensitive })).toBe('noMatch');
    expect(bash('echo hi > .github/hooks/deep/a.json', { ...here, sensitive })).toBe('noMatch');
    expect(bash('echo hi > AGENTS.md', { ...here, sensitive })).toBe('noMatch');
    // A link in the folder that leads into a location is that location.
    expect(bash('echo hi > hooks/a.json', { ...here, sensitive })).toBe('noMatch');
    // A file location holds that file alone, and a folder what is under it.
    expect(bash('echo hi > AGENTS.md.bak', { ...here, sensitive })).toBe('approved');
    expect(bash('echo hi > .github/hooks-two/a.json', { ...here, sensitive })).toBe('approved');
  });

  it('asks when it has no folder or no patterns to check a target against', () => {
    expect(bash('echo hi > out.txt')).toBe('noMatch');
    expect(bash('echo hi > out.txt', { editPatterns: patterns })).toBe('noMatch');
    expect(bash('echo hi > out.txt', { workingDirectory: folder })).toBe('noMatch');
  });

  it('answers for every target of the line, not the first', () => {
    expect(bash('echo hi > out.txt 2> err.log', here)).toBe('approved');
    expect(bash('echo hi > out.txt 2> /tmp/err.log', here)).toBe('noMatch');
    expect(bash('echo hi 2> /dev/null > /tmp/out', here)).toBe('noMatch');
    expect(bash('echo hi > out.txt 2> /dev/null', here)).toBe('approved');
  });

  it('leaves a write that goes nowhere out of it', () => {
    expect(bash('echo hello > /dev/null')).toBe('approved');
    expect(bash('echo hello >/dev/null')).toBe('approved');
    expect(bash(`echo hello > '/dev/null'`)).toBe('approved');
    expect(bash('echo hello >> /dev/stderr')).toBe('approved');
    expect(bash('echo hello 2> /dev/null')).toBe('approved');
    expect(bash('echo hello 2>&1')).toBe('approved');
    expect(bash('ls 2>&1 > /dev/null')).toBe('approved');
    expect(bash('echo hi > /dev/null 2>&1', here)).toBe('approved');
    // A quoted `&1` is the name of a file, and not the descriptor it looks like.
    expect(bash('echo hello > "&1"')).toBe('noMatch');
    expect(bash(`echo hello > '&1'`)).toBe('noMatch');
  });

  it('never approves a target whose name it could not read', () => {
    expect(bash('echo hi > *.txt', here)).toBe('noMatch');
    expect(bash('echo hi > ?ut.txt', here)).toBe('noMatch');
    expect(bash('echo hi > .[e]nv', here)).toBe('noMatch');
    expect(bash('echo hi > "packag"[e]".json"', here)).toBe('noMatch');
    expect(bash('echo data 1<>/etc/passwd', here)).toBe('noMatch');
    expect(bash('echo data <>/tmp/file', here)).toBe('noMatch');
    expect(bash('cat < <(tee ~/.bashrc <<< id)', here)).toBe('noMatch');
    expect(bash('ls > >(tee ~/.bashrc)', here)).toBe('noMatch');
    // A pattern the shell expands into a name is a name, and the shell reads it.
    expect(bash("echo hi > '*.txt'", here)).toBe('approved');
    expect(bash('Write-Host hi > *.txt', { ...here, shell: 'powershell' })).toBe('noMatch');
    expect(powershell("Write-Host hi >'.[m]cp.json'", here)).toBe('noMatch');
  });

  it('reads a redirect whose target is the sink of a PowerShell session', () => {
    expect(powershell('Get-Content file.txt 2>$null')).toBe('approved');
    expect(powershell('Get-Content file.txt 2> $null')).toBe('approved');
    expect(powershell('Write-Host hi >$null')).toBe('approved');
    expect(powershell('Write-Host hi 2>&1')).toBe('approved');
    // `/dev/null` is a POSIX path, which is a file to PowerShell like any other.
    expect(powershell('Write-Host hi > /dev/null')).toBe('noMatch');
    expect(powershell('Write-Host hi >/dev/null')).toBe('noMatch');
    expect(powershell("Write-Host hi > '$null'")).toBe('noMatch');
    expect(powershell('Write-Host hi > out.txt')).toBe('noMatch');
    expect(powershell('Write-Host hi >out.txt')).toBe('noMatch');
    // A file in the folder the command runs in, under the patterns, is approved.
    expect(powershell('Write-Host hi > out.txt', here)).toBe('approved');
  });

  it('reads a target by the patterns the client pushes', () => {
    expect(bash('echo hi > out.txt', { ...here, editPatterns: pushed })).toBe('approved');
    expect(bash('echo hi > .git/config', { ...here, editPatterns: pushed })).toBe('noMatch');
    expect(bash('echo hi > .npmrc', { ...here, editPatterns: pushed })).toBe('noMatch');
    expect(bash('echo hi > package.json', { ...here, editPatterns: pushed })).toBe('noMatch');
    expect(bash('echo hi > pnpm-lock.yaml', { ...here, editPatterns: pushed })).toBe('noMatch');
    expect(bash('echo hi > src/index.ts', { ...here, editPatterns: pushed })).toBe('approved');
  });
});
