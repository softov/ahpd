/** The rules that answer a shell command without asking, and the reading of a command line a rule is matched against. */

/*
 * A rule is a key and a value: the key names a command, and the value says
 * whether it runs without a question. `CommandAutoApprover.evaluate` reads a
 * line into its parts, denies it when any part matches a deny rule, approves it
 * when every part matches an allow rule, and leaves the rest to the caller,
 * which asks.
 *
 * The reading is this file's own rather than a grammar's, so a line it cannot
 * vouch for is a line that asks: `splitCommand` answers `undefined`, or marks
 * the line `unanalyzable`, for everything it cannot read. That is the whole of
 * why it is conservative - a splitter that says yes wrongly approves a command
 * nobody agreed to.
 *
 * The keys, the value shape and the default table are VS Code's, from
 * `commandAutoApprover.ts` at `a959ba62444`: a key is a prefix of a command, or
 * a regular expression when it is written `/.../flags`, and a rule may name the
 * whole command line instead with `matchCommandLine`.
 *
 * The approver holds no state and reads no config: the rules, the edit patterns
 * and the folder a write lands in are arguments, so a caller hands it what its
 * own client pushed rather than what some earlier call left behind.
 */

import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';

/** The shells a command line is read for. */
export type CommandShell = 'bash' | 'powershell';

/**
 * A rule's value.
 *
 * `true` approves the command and `false` denies it. An object says the same
 * with the shape of the match named: `matchCommandLine` matches the key against
 * the whole command line rather than against each command in it.
 */
export type TerminalAutoApproveRuleValue = boolean | null | { approve: boolean; matchCommandLine?: boolean };

/** The rules a client pushes: one entry per command, in the client's own order. */
export type TerminalAutoApproveRules = Record<string, TerminalAutoApproveRuleValue>;

/** The edit patterns a write target is checked against: a path pattern, and whether a file under it may be written. */
export type TerminalAutoApprovePatterns = Record<string, boolean>;

/** What a rule says about a command line. `denied` and `noMatch` both ask; they differ in which rule spoke. */
export type CommandApprovalResult = 'approved' | 'denied' | 'noMatch';

/**
 * A command line read as the parts a rule is matched against.
 *
 * `subCommands` is one entry per command the line runs, in the order it runs
 * them. `writeDests` is the path of every redirect that writes to a file, minus
 * the destinations that write nowhere - `/dev/null`, a file descriptor
 * duplication. `unanalyzable` says the line holds something no rule can see
 * into, and is the same answer as a line that could not be read at all: it
 * asks.
 */
export interface CommandSplit {
  subCommands: string[];
  writeDests: string[];
  unanalyzable: boolean;
}

/** Reads a command line, or answers `undefined` when it cannot read one. */
export type CommandSplitter = (line: string, shell: CommandShell) => CommandSplit | undefined;

/** The redirect sinks that write to no file: the discards, and the file descriptor duplications. */
const SAFE_SINKS: ReadonlySet<string> = new Set(['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/tty']);

/** Where an unquoted word ends: whitespace, or one of the characters a shell reads itself. */
const WORD_END = /[\s;|&<>()]/u;

/** Every character of a name a rule may carry, escaped so it stands for itself in a regular expression. */
const escapeRegExpCharacters = (value: string): string => value.replace(/[-\\{}*+?|^$.,[\]()#\s]/gu, '\\$&');

/** A rule that matches nothing, which is what a key no regular expression can carry becomes. */
const NEVER_MATCHES = /(?!)/u;

/** A redirect read off a line, and where the line continues after it. */
interface RedirectRead {
  /** The path written to, or `undefined` for a read, and for a write that goes nowhere. */
  dest: string | undefined;
  /** Where the line continues once the redirect has been read. */
  next: number;
  /** Whether the redirect is one no rule can read, which makes the whole line ask. */
  unreadable: boolean;
}

/** A redirect's destination, read off a line. */
interface TargetRead {
  /** The name written to, with any surrounding quotes taken off. */
  dest: string;
  /** Whether the name was quoted, which is what makes a name with brackets in it a name rather than a pattern. */
  quoted: boolean;
  /** Whether the name holds a character a shell would expand into a list of names. */
  glob: boolean;
  /** Where the line continues after the name. */
  next: number;
}

/**
 * The destination of the redirect operator at `at`, or `undefined` when the
 * character runs no target this can read.
 *
 * A quoted name is read to its closing quote. An unquoted name runs to the next
 * character a shell reads itself. A name built out of several pieces, such as
 * `"packag"[e]".json"`, is not read at all: what it names is a name the rules
 * never saw, so it asks.
 */
const readTarget = (line: string, at: number, powershell: boolean): TargetRead | undefined => {
  let j = at;
  while (line[j] === ' ' || line[j] === '\t') j += 1;
  if (j >= line.length) return undefined;
  const open = line[j]!;

  if (open === "'" || open === '"') {
    let dest = '';
    let closed = false;
    j += 1;
    while (j < line.length) {
      const c = line[j]!;
      // A PowerShell single-quoted string writes a quote inside itself by doubling it.
      if (powershell && open === "'" && c === "'" && line[j + 1] === "'") {
        dest += "''";
        j += 2;
        continue;
      }
      if (c === open) {
        j += 1;
        closed = true;
        break;
      }
      if (c === (powershell ? '`' : '\\') && j + 1 < line.length) {
        dest += line.slice(j, j + 2);
        j += 2;
        continue;
      }
      // A name the shell finishes reading is a name the rules cannot match.
      if (!powershell && (c === '`' || (c === '$' && line[j + 1] === '('))) return undefined;
      dest += c;
      j += 1;
    }
    if (!closed) return undefined;
    if (j < line.length && !WORD_END.test(line[j]!)) return undefined;
    return { dest, quoted: true, glob: /[*?\[]/u.test(dest), next: j };
  }

  if (open === '&') {
    // `>&1` and `2>&1` name a file descriptor, which is no file at all.
    let k = j + 1;
    while (k < line.length && /[0-9]/u.test(line[k]!)) k += 1;
    if (line[k] === '-') k += 1;
    if (k >= line.length || WORD_END.test(line[k]!)) return { dest: line.slice(j, k), quoted: false, glob: false, next: k };
    // `>&word` writes to `word`, so the `&` is the shell's and not the name's.
    j = k;
  }

  let dest = '';
  while (j < line.length && !WORD_END.test(line[j]!)) {
    dest += line[j];
    j += 1;
  }
  if (dest === '') return undefined;
  return { dest, quoted: false, glob: /[*?\[]/u.test(dest), next: j };
};

/**
 * Whether a destination writes to no file at all.
 *
 * The sinks that discard output, and the file descriptors a duplication points
 * at, are not files any rule has an opinion about. `/dev/null` is a POSIX path
 * and resolves as a real file on Windows, so it is only a sink to a POSIX
 * shell; `$null` is PowerShell's.
 */
const writesNowhere = (dest: string, quoted: boolean, powershell: boolean): boolean => {
  if (!quoted && powershell && dest.toLowerCase() === '$null') return true;
  if (!quoted && /^&[0-9]*-?$/u.test(dest)) return true;
  return !powershell && SAFE_SINKS.has(dest);
};

/**
 * The redirect at `at`, read as what it writes and where the line continues.
 *
 * A heredoc, a here-string and a process substitution are unreadable rather
 * than merely unwritten: each of them hands a shell text this cannot see the
 * commands in. A read redirect is read for what it names so the name does not
 * land in the command beside it, and then dropped - nothing is written.
 */
const readRedirect = (line: string, at: number, powershell: boolean): RedirectRead => {
  let j = at;
  let writes = false;
  if (line[j] === '<') {
    const after = line[j + 1];
    if (after === '<' || after === '(') return { dest: undefined, next: j + 2, unreadable: true };
    // `<>` opens a file for reading and writing both, so it is a write.
    if (after === '>') {
      j += 2;
      writes = true;
    } else {
      const target = readTarget(line, j + 1, powershell);
      return target === undefined
        ? { dest: undefined, next: j + 1, unreadable: true }
        : { dest: undefined, next: target.next, unreadable: false };
    }
  }
  if (!writes) {
    if (line[j] !== '>') return { dest: undefined, next: j + 1, unreadable: false };
    j += 1;
    if (line[j] === '>') j += 1;
    if (line[j] === '|') j += 1;
  }
  const target = readTarget(line, j, powershell);
  if (target === undefined) return { dest: undefined, next: j, unreadable: true };
  // A pattern names whatever it matches rather than one path, so `.npmrc` can
  // be written through `.[n]pmrc` without ever being written out.
  if (target.glob && (powershell || !target.quoted)) return { dest: undefined, next: target.next, unreadable: true };
  if (writesNowhere(target.dest, target.quoted, powershell)) return { dest: undefined, next: target.next, unreadable: false };
  return { dest: target.dest, next: target.next, unreadable: false };
};

/**
 * Whether a parse error stops a line from being answered for.
 *
 * Upstream's grammar reports errors for both shells and refuses only a
 * PowerShell line over one, because a bash error still leaves the commands its
 * parser could read. This reading has no partial reading to offer, so a line it
 * cannot read asks for either shell.
 */
export const shouldRequireConfirmationForAutoApproveParse = (shell: CommandShell, hasError: boolean): boolean =>
  shell === 'powershell' && hasError;

/** A PowerShell method call, which runs code no rule about the cmdlet before it has seen. */
const POWERSHELL_METHOD_CALL = /^(?:::[A-Za-z_]\w*\s*\(|\.[A-Za-z_]\w*\s*\()/u;

/** A PowerShell assignment, which sets state on a line a rule about its commands has approved. */
const POWERSHELL_ASSIGNMENT = /^\$[\w:]+(?:\s*[-+*/%]?=)(?!=)/u;

/**
 * A bash or PowerShell line, split into the commands it runs and the files it writes.
 *
 * Both shells run one command per separator and hand the rest of the line to
 * the first, so the split happens outside quotes and stops at nothing else. A
 * character either shell would expand, a heredoc, or a name glued together from
 * pieces, is not a line this can read: `unanalyzable` says so, and the caller
 * asks.
 *
 * A shell this does not know is `undefined` rather than an empty reading, and
 * so is a quote left open at the end of the line - neither is a line a rule
 * should be matched against.
 */
export const splitCommand: CommandSplitter = (line, shell) => {
  if (shell !== 'bash' && shell !== 'powershell') return undefined;
  const powershell = shell === 'powershell';
  const subCommands: string[] = [];
  const writeDests: string[] = [];
  let unanalyzable = false;
  let groups = 0;
  let quote: "'" | '"' | undefined;
  let current = '';
  let i = 0;

  const endCommand = (): void => {
    const text = current.trim();
    if (text !== '') subCommands.push(text);
    current = '';
  };

  /**
   * Takes the stream a redirect names off the command before it: the `2` of
   * `2> err.log` is the shell's word and not an argument, so a rule that names
   * a command exactly still names this one.
   */
  const stripStream = (): void => {
    current = current.replace(powershell ? /(?:^|\s)[*\d]+$/u : /(?:^|\s)\d+$/u, '');
  };

  while (i < line.length) {
    const c = line[i]!;

    if (quote === "'") {
      if (powershell && c === "'" && line[i + 1] === "'") {
        current += "''";
        i += 2;
        continue;
      }
      if (c === "'") quote = undefined;
      current += c;
      i += 1;
      continue;
    }

    if (quote === '"') {
      if (c === (powershell ? '`' : '\\')) {
        if (i + 1 >= line.length) return undefined;
        current += line.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === '"') {
        quote = undefined;
        current += c;
        i += 1;
        continue;
      }
      // A substitution inside a double-quoted string runs a command all the same.
      if (c === '`' || (c === '$' && line[i + 1] === '(')) unanalyzable = true;
      current += c;
      i += 1;
      continue;
    }

    if (c === (powershell ? '`' : '\\')) {
      if (i + 1 >= line.length) return undefined;
      current += line.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      current += c;
      i += 1;
      continue;
    }
    // A script block holds commands this reading does not name, and PowerShell
    // runs what is inside one - `Where-Object { Remove-Item $_ }` runs `Remove-Item`.
    if (powershell && c === '{') unanalyzable = true;
    // A method call or an assignment runs or changes something no rule about
    // the cmdlet before it has seen - `[System.IO.File]::Delete('x')` deletes a
    // file behind a rule that named only `Get-ChildItem`.
    if (powershell && (POWERSHELL_METHOD_CALL.test(line.slice(i, i + 80)) || POWERSHELL_ASSIGNMENT.test(line.slice(i, i + 80)))) {
      unanalyzable = true;
    }
    // PowerShell groups an expression in parentheses, and a line that leaves one
    // open was cut off - `if ($x -eq` is not a line that runs `if`.
    if (powershell && (c === '(' || c === ')')) groups += c === '(' ? 1 : -1;
    // A substitution runs the command written inside it, which is a command this
    // reading does not name - `echo $(rm -rf /)` runs `rm` however it is spelled.
    if (c === '`' || (c === '$' && line[i + 1] === '(')) {
      unanalyzable = true;
      current += c;
      i += 1;
      continue;
    }
    // A comment runs to the end of its line, and holds no command.
    if (c === '#' && (i === 0 || /\s/u.test(line[i - 1]!))) {
      const brk = line.indexOf('\n', i);
      if (brk < 0) break;
      i = brk;
      continue;
    }
    if (c === '\n' || c === ';') {
      endCommand();
      i += 1;
      continue;
    }
    if (c === '|') {
      endCommand();
      i += line[i + 1] === '|' ? 2 : 1;
      continue;
    }
    if (c === '&') {
      if (line[i + 1] === '&') {
        endCommand();
        i += 2;
        continue;
      }
      // `&>` is a redirect rather than a second command.
      if (line[i + 1] === '>') {
        i += 1;
        continue;
      }
      // PowerShell's `&` calls what follows rather than running it beside.
      if (powershell) {
        unanalyzable = true;
        current += c;
        i += 1;
        continue;
      }
      endCommand();
      i += 1;
      continue;
    }
    if (c === '<' || c === '>') {
      stripStream();
      const redirect = readRedirect(line, i, powershell);
      if (redirect.unreadable) unanalyzable = true;
      if (redirect.dest !== undefined) writeDests.push(redirect.dest);
      i = Math.max(redirect.next, i + 1);
      continue;
    }

    current += c;
    i += 1;
  }

  if (quote !== undefined) return undefined;
  endCommand();
  if (shouldRequireConfirmationForAutoApproveParse(shell, groups !== 0)) return undefined;
  return { subCommands, writeDests, unanalyzable };
};

/** One rule key, compiled once, as the two regular expressions a match needs. */
interface CompiledRule {
  /** The key as written, which is what a rule with configured casing matches with. */
  readonly regex: RegExp;
  /**
   * The same expression, insensitive to case, which is what PowerShell matches with.
   *
   * A rule whose key carries a case-sensitive group is matched in the casing it was
   * written in, so this is then the case-sensitive expression itself.
   */
  readonly regexCaseInsensitive: RegExp;
}

/** Every rule of a table, split by what each one says. */
interface CompiledRules {
  readonly allow: CompiledRule[];
  readonly deny: CompiledRule[];
  readonly allowCommandLine: CompiledRule[];
  readonly denyCommandLine: CompiledRule[];
}

/**
 * A pattern with each case-sensitive group written as a plain group.
 *
 * A group written `(?-i:X)` asks for X to be matched with case. In a key that carries
 * no `i` flag the rest of the expression already is, so `(?:X)` says the same thing.
 * The rewrite is taken whether or not the runtime has regular expression modifiers,
 * so a rule reads the same on every runtime.
 */
const withoutCaseSensitiveGroups = (pattern: string): string => pattern.replace(/(^|[^\\])((?:\\\\)*)\(\?-i:/gu, '$1$2(?:');

/** A rule key written as a regular expression, `/.../flags`, and the parts it is read into. */
const RULE_KEY = /^\/(?<pattern>.+)\/(?<flags>[dgimsuvy]*)$/u;

/**
 * A rule key as a regular expression, and whether it may be matched in another casing.
 *
 * A key written `/.../flags` is the expression itself, and one that matches the
 * empty string forever is a key that matches nothing rather than one that hangs
 * a matcher. Any other key is a prefix: the word it names, ended at a word
 * boundary, and a key naming a path matches either separator so a rule written
 * for one platform holds on the other.
 *
 * A key with a case-sensitive group is matched in the casing it was written in,
 * because an insensitive copy would let that group match another casing: `git -C`
 * would then hold for `git -c`, which sets configuration that runs code. With an
 * `i` flag the rewrite would change what the key says, so a runtime that cannot
 * read the modifier gets a key that matches nothing.
 */
const ruleRegexOf = (key: string): { readonly regex: RegExp; readonly caseSensitiveOnly: boolean } => {
  const written = RULE_KEY.exec(key);
  const pattern = written?.groups?.['pattern'];
  if (pattern !== undefined) {
    const flags = (written?.groups?.['flags'] ?? '').replaceAll('g', '');
    if (pattern === '.*') return { regex: new RegExp(pattern), caseSensitiveOnly: false };
    const plain = withoutCaseSensitiveGroups(pattern);
    const caseSensitiveOnly = plain !== pattern && !flags.includes('i');
    try {
      const regex = new RegExp(caseSensitiveOnly ? plain : pattern, flags === '' ? undefined : flags);
      return { regex: leadsToEndlessLoop(regex) ? NEVER_MATCHES : regex, caseSensitiveOnly };
    } catch {
      return { regex: NEVER_MATCHES, caseSensitiveOnly: false };
    }
  }
  if (key === '') return { regex: NEVER_MATCHES, caseSensitiveOnly: false };
  let prefixed: string;
  if (key.includes('/') || key.includes('\\')) {
    const separated = key.replace(/[/\\]/gu, '%%PATH_SEP%%');
    prefixed = `^(?:\\.[/\\\\])?${escapeRegExpCharacters(separated).replace(/%%PATH_SEP%%*/gu, '[/\\\\]')}`;
  } else {
    prefixed = escapeRegExpCharacters(key);
  }
  return { regex: new RegExp(`^${prefixed}\\b`), caseSensitiveOnly: false };
};

/**
 * Whether a regular expression matches without consuming anything.
 *
 * Such an expression leaves a matcher on the same character forever, so a key
 * that carries one is read as matching nothing instead. Every probe is a string
 * the expression can match something of, so one that matches nothing of any of
 * them is one that never gets anywhere.
 */
const leadsToEndlessLoop = (regex: RegExp): boolean => {
  for (const probe of ['', 'a', ' ', '\n', '2', '!', ' ']) {
    const found = regex.exec(probe);
    if (found === null || found[0].length !== 0) return false;
  }
  return true;
};

/** A rules table, split by what each entry says. */
const compileRules = (rules: TerminalAutoApproveRules): CompiledRules => {
  const compiled: CompiledRules = { allow: [], deny: [], allowCommandLine: [], denyCommandLine: [] };
  for (const [key, value] of Object.entries(rules)) {
    const { regex, caseSensitiveOnly } = ruleRegexOf(key);
    const rule: CompiledRule = {
      regex,
      regexCaseInsensitive: caseSensitiveOnly || regex.flags.includes('i') ? regex : new RegExp(regex.source, `${regex.flags}i`),
    };
    if (typeof value === 'object' && value !== null) {
      if (typeof value.approve !== 'boolean') continue;
      if (value.approve) (value.matchCommandLine === true ? compiled.allowCommandLine : compiled.allow).push(rule);
      else (value.matchCommandLine === true ? compiled.denyCommandLine : compiled.deny).push(rule);
      continue;
    }
    if (value === true) compiled.allow.push(rule);
    else if (value === false) compiled.deny.push(rule);
  }
  return compiled;
};

/**
 * Whether any of these rules names this command.
 *
 * PowerShell reads its own command names without regard to case, so a rule
 * matches there the same way; a full-command-line rule keeps the casing it was
 * configured with, as PowerShell itself does with an argument. PowerShell also
 * writes a command in parentheses as an expression over its output, which the
 * rules name without the parenthesis.
 */
const matchesRule = (command: string, rules: readonly CompiledRule[], powershell: boolean): boolean => rules.some((rule) => {
  if ((powershell ? rule.regexCaseInsensitive : rule.regex).test(command)) return true;
  return powershell && command.startsWith('(') && rule.regexCaseInsensitive.test(command.slice(1));
});

/** Whether any of these rules names the whole command line, which is matched with the casing it was written in. */
const matchesLine = (line: string, rules: readonly CompiledRule[]): boolean => rules.some((rule) => rule.regex.test(line));

/** A variable a command sets for itself alone, which no rule about command names can speak for. */
const TRANSIENT_VARIABLE = /^[A-Z_][A-Z0-9_]*=/iu;

/**
 * Whether a command is a `sed` that edits its files in place.
 *
 * An in-place edit writes a file without naming it in a redirect, so no rule
 * about commands can speak for it: `sed -i s/x/y/ file` writes `file`, and the
 * caller is asked. The forms are VS Code's `SedFileWriteParser.canHandle`:
 * `-i`, `-I`, `--in-place`, and the BSD backup suffix that follows either flag.
 */
const sedWritesInPlace = (command: string): boolean => {
  if (!/^sed\s+/u.test(command)) return false;
  return /(?:^|\s)(-[a-zA-Z]*[iI][a-zA-Z]*\S*|--in-place(?:=\S*)?|(-i|-I)\s*'[^']*'|(-i|-I)\s*"[^"]*")(?:\s|$)/u.test(command);
};

/**
 * What the commands of a line add up to.
 *
 * One denied command denies the line, and one that matches no allow rule leaves
 * the line unapproved: every command of a line runs, so every one of them has
 * to be answered for. A command that sets a variable for itself is denied
 * rather than matched, because what it runs afterwards is not what the line
 * says.
 */
const matchCommands = (subCommands: readonly string[], rules: CompiledRules, powershell: boolean): CommandApprovalResult => {
  let approved = true;
  for (const subCommand of subCommands) {
    if (sedWritesInPlace(subCommand)) return 'denied';
    if (TRANSIENT_VARIABLE.test(subCommand)) return 'denied';
    if (matchesRule(subCommand, rules.deny, powershell)) return 'denied';
    if (!matchesRule(subCommand, rules.allow, powershell)) approved = false;
  }
  return approved ? 'approved' : 'noMatch';
};

/** A glob, as the edit patterns are written, as the expression that matches a whole path against it. */
const globRegexOf = (pattern: string): RegExp => {
  let source = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === '*') {
      if (pattern[i + 1] !== '*') {
        source += '[^/]*';
        i += 1;
        continue;
      }
      // `**/` crosses folders as often as it likes; a bare `**` is any path.
      if (pattern[i + 2] === '/') {
        source += '(?:[^/]*/)*';
        i += 3;
        continue;
      }
      source += '.*';
      i += 2;
      continue;
    }
    if (c === '?') {
      source += '[^/]';
      i += 1;
      continue;
    }
    if (c === '{' || c === '[') {
      const close = pattern.indexOf(c === '{' ? '}' : ']', i + 1);
      if (close !== -1) {
        const body = pattern.slice(i + 1, close);
        source += c === '{' ? `(?:${body.split(',').map(escapeRegExpCharacters).join('|')})` : `[${body}]`;
        i = close + 1;
        continue;
      }
    }
    source += escapeRegExpCharacters(c);
    i += 1;
  }
  return new RegExp(`^${source}$`);
};

/**
 * Whether the edit patterns approve a write to this path.
 *
 * A pattern that denies is read before one that allows, so a table that allows
 * everything and denies one folder denies that folder wherever the entries were
 * written. Nothing matching the path at all is not an approval: the table is
 * the whole of what a write is allowed by.
 */
const patternsAllow = (path: string, patterns: TerminalAutoApprovePatterns): boolean => {
  // In the patterns' own separators. A pattern is written with `/`, and on
  // Windows a path has `\`: the denial `.git` pattern never matched
  // `C:\repo\.git\config` while the allow-all one did, so a denial was never
  // read there. Only on Windows, where a backslash is a separator and not a
  // character a name may hold.
  const spelled = process.platform === 'win32' ? path.replaceAll('\\', '/') : path;
  const entries = Object.entries(patterns)
    .map(([pattern, approved]) => ({ regex: globRegexOf(pattern), approved }));
  if (entries.some((one) => one.approved === false && one.regex.test(spelled))) return false;
  return entries.some((one) => one.approved === true && one.regex.test(spelled));
};

/** A destination whose name a shell finishes reading rather than the text: a variable, a substitution, a home directory. */
const SHELL_EXPANDS = /[$(){}`~%]/u;

/**
 * The path a write destination lands on, with every symbolic link on the way
 * followed, or `undefined` when the text does not name one path.
 *
 * A link can point outside the folder a command was allowed to write in, so it
 * is followed before anything is decided about where the write goes - including
 * for a file that is not there yet, whose nearest existing folder is what a link
 * would have to be on. A path this may not look at is `undefined` as well,
 * because a check that cannot be made is not one that passed.
 */
const realPathOf = (path: string): string | undefined => {
  let rest = '';
  let at = path;
  for (;;) {
    try {
      const real = realpathSync(at);
      return rest === '' ? real : join(real, rest);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM') return undefined;
      const up = dirname(at);
      if (up === at) return undefined;
      rest = rest === '' ? basename(at) : join(basename(at), rest);
      at = up;
    }
  }
};

/** Whether a path is the folder or is under it. */
const isInside = (path: string, folder: string): boolean =>
  path === folder || path.startsWith(folder.endsWith(sep) ? folder : `${folder}${sep}`);

/**
 * Whether a write destination is one the rules approve.
 *
 * The destination has to name a path, land in the folder the command runs in,
 * and match the edit patterns. A path that leaves the folder by `..`, or by a
 * link on the way, does not, and neither does a name the shell expands: what
 * such a write lands on is not what the line says.
 */
const writeAllowed = (dest: string, folder: string, patterns: TerminalAutoApprovePatterns | undefined): boolean => {
  const named = dest.trim();
  if (named === '' || SHELL_EXPANDS.test(named) || patterns === undefined) return false;
  const literal = isAbsolute(named) ? normalize(named) : resolve(folder, named);
  const real = realPathOf(literal);
  if (real === undefined) return false;
  for (const candidate of real === literal ? [literal] : [literal, real]) {
    if (!isInside(candidate, folder)) return false;
    if (!patternsAllow(candidate, patterns)) return false;
  }
  return true;
};

/** What a command line is checked against. */
export interface CommandApprovalOptions {
  /** The rules to match against. Omitted means the default table; `{}` means no rule at all. */
  rules?: TerminalAutoApproveRules;
  /** The shell the line is written for. Defaults to bash. */
  shell?: CommandShell;
  /** The folder the command runs in, which is the only one a write may land in. */
  workingDirectory?: string;
  /** The patterns a write target must match. Omitted means no write is approved. */
  editPatterns?: TerminalAutoApprovePatterns;
}

/**
 * The rules that decide whether a shell command runs without a question.
 *
 * The reader is an argument rather than a call, so a deployment that reads a
 * command line another way can hand in its own without changing this.
 */
export class CommandAutoApprover {
  private readonly split: CommandSplitter;

  constructor(split: CommandSplitter = splitCommand) {
    this.split = split;
  }

  /**
   * What the rules say about a command line: `approved`, `denied` or `noMatch`.
   *
   * An empty line is approved, because it runs nothing. A line whose commands
   * are approved but whose writes are not is `noMatch` rather than `denied`:
   * the rules spoke about the command and about nothing else.
   */
  evaluate(line: string, options: CommandApprovalOptions = {}): CommandApprovalResult {
    const trimmed = line.trimStart();
    if (trimmed === '') return 'approved';
    const rules = compileRules(options.rules ?? DEFAULT_TERMINAL_AUTO_APPROVE_RULES);
    if (matchesLine(trimmed, rules.denyCommandLine)) return 'denied';

    const read = this.split(trimmed, options.shell ?? 'bash');
    if (read === undefined || read.unanalyzable) return 'noMatch';

    let result = matchCommands(read.subCommands, rules, options.shell === 'powershell');
    if (result !== 'denied' && matchesLine(trimmed, rules.allowCommandLine)) result = 'approved';
    if (result !== 'approved' || read.writeDests.length === 0) return result;

    const folder = options.workingDirectory;
    if (folder === undefined) return 'noMatch';
    return read.writeDests.every((dest) => writeAllowed(dest, folder, options.editPatterns)) ? 'approved' : 'noMatch';
  }
}

/**
 * VS Code's git rules, `gitAutoApproveRules.ts` at `a959ba62444`: the read-only
 * sub-commands, and the options that turn one into a write or an execution.
 *
 * Each pattern takes `-C <path>` and `--no-pager` after `git`. The uppercase
 * `-C` changes directory and is matched case-sensitively inside the pattern;
 * a lowercase `-c` injects configuration and does not fit.
 */
const GIT_AUTO_APPROVE_RULES: Readonly<Record<string, boolean>> = {
  '/^git(\\s+(-(?-i:C)\\s+\\S+|--no-pager))*\\s+status\\b/': true,
  '/^git(\\s+(-(?-i:C)\\s+\\S+|--no-pager))*\\s+log\\b/': true,
  '/^git(\\s+(-(?-i:C)\\s+\\S+|--no-pager))*\\s+log\\b.*\\s--output(=|\\s|$)/': false,
  '/^git(\\s+(-(?-i:C)\\s+\\S+|--no-pager))*\\s+show\\b/': true,
  '/^git(\\s+(-(?-i:C)\\s+\\S+|--no-pager))*\\s+show\\b.*\\s--output(=|\\s|$)/': false,
  '/^git(\\s+(-(?-i:C)\\s+\\S+|--no-pager))*\\s+diff\\b/': true,
  '/^git(\\s+(-(?-i:C)\\s+\\S+|--no-pager))*\\s+diff\\b.*\\s--[^\\w\\s]*o[^\\w\\s]*u[^\\w\\s]*t[^\\w\\s]*p[^\\w\\s]*u[^\\w\\s]*t[^\\w\\s]*(=|\\s|$)/': false,
  '/^git(\\s+(-(?-i:C)\\s+\\S+|--no-pager))*\\s+ls-files\\b/': true,

  // `git grep -O` and `--open-files-in-pager` may run an external pager.
  '/^git(\\s+(-(?-i:C)\\s+\\S+|--no-pager))*\\s+grep\\b/': true,
  '/^git(\\s+(-(?-i:C)\\s+\\S+|--no-pager))*\\s+grep\\b.*\\s(?-i:-[aIivwhHEGPFnlLqzco]*[^\\w\\s]*O\\S*)(\\s|$)/': false,
  '/^git(\\s+(-(?-i:C)\\s+\\S+|--no-pager))*\\s+grep\\b.*\\s(?-i:--[^\\w\\s]*o[^\\w\\s]*p\\S*)(\\s|$)/': false,

  // `git branch -d`, `-D` and `--delete` delete a branch, `-m` and `-M`
  // rename one, and `--force` is dangerous wherever it applies.
  '/^git(\\s+(-(?-i:C)\\s+\\S+|--no-pager))*\\s+branch\\b/': true,
  '/^git(\\s+(-(?-i:C)\\s+\\S+|--no-pager))*\\s+branch\\b.*\\s-(d|D|m|M|-delete|-force)\\b/': false,
};

/**
 * VS Code's PowerShell rules, `powershellAutoApproveRules.ts` at `a959ba62444`.
 *
 * The list is explicit rather than a verb prefix: a PowerShell module can
 * define any cmdlet it likes with a standard verb, so `Select-*` is not a rule
 * about what `Select-Custom` does.
 */
const POWERSHELL_AUTO_APPROVE_RULES: Readonly<Record<string, boolean>> = {
  'Get-ChildItem': true,
  'Get-Content': true,
  'Get-Date': true,
  'Get-Random': true,
  'Get-Location': true,
  'Set-Location': true,
  'Write-Host': true,
  'Write-Output': true,
  'Out-String': true,
  'Split-Path': true,
  'Join-Path': true,
  'Start-Sleep': true,
  'Where-Object': true,
  'Select-Object': true,
  'Select-String': true,
  'Measure-Object': true,
  'Compare-Object': true,
  'Format-List': true,
  'Format-Table': true,
  'Sort-Object': true,
};

/** VS Code's sort rules, `sortAutoApproveRules.ts` at `a959ba62444`: the command, and what writes or executes from it. */
const SORT_AUTO_APPROVE_RULES: Readonly<Record<string, boolean>> = {
  '/^sort\\b(?!-)/': true,

  // `-o` writes its output to a file, and `-S` can ask for enough memory to
  // stop the machine answering.
  '/^sort\\b.*\\s-(o|S)\\b/': false,

  // GNU sort reads unique long-option abbreviations, so `--co` is the shortest
  // spelling of `--compress-program`. The quotes and escapes a shell removes
  // are allowed between the characters.
  '/^sort\\b.*\\s(?:\\$?[\'"]|\\\\)*-(?:\\$?[\'"]|\\\\)*-(?:\\$?[\'"]|\\\\)*c(?:\\$?[\'"]|\\\\)*o/': false,
};

/*
 * VS Code's `DEFAULT_TERMINAL_AUTO_APPROVE_RULES`, `commandAutoApprover.ts:590`,
 * at `a959ba62444`. It is what applies when no client has pushed rules of its
 * own, and it is the table a later pass can diff against upstream.
 *
 * The three tables above are spread into it at the lines upstream spreads them,
 * so the order of the keys is the same.
 */
export const DEFAULT_TERMINAL_AUTO_APPROVE_RULES: Readonly<TerminalAutoApproveRules> = {
  // Safe readonly commands
  cd: true,
  echo: true,
  ls: true,
  dir: true,
  pwd: true,
  cat: true,
  head: true,
  tail: true,
  findstr: true,
  wc: true,
  tr: true,
  cut: true,
  cmp: true,
  which: true,
  basename: true,
  dirname: true,
  realpath: true,
  readlink: true,
  stat: true,
  file: true,
  od: true,
  du: true,
  df: true,
  sleep: true,
  nl: true,

  grep: true,

  // Safe git sub-commands
  ...GIT_AUTO_APPROVE_RULES,

  // Docker readonly sub-commands
  '/^docker\\s+(ps|images|info|version|inspect|logs|top|stats|port|diff|search|events)\\b/': true,
  '/^docker\\s+(container|image|network|volume|context|system)\\s+(ls|ps|inspect|history|show|df|info)\\b/': true,
  '/^docker\\s+compose\\s+(ps|ls|top|logs|images|config|version|port|events)\\b/': true,

  // PowerShell
  ...POWERSHELL_AUTO_APPROVE_RULES,

  // Package manager read-only commands
  '/^npm\\s+(ls|list|outdated|view|info|show|explain|why|root|prefix|bin|search|doctor|fund|repo|bugs|docs|home|help(-search)?)\\b/': true,
  '/^npm\\s+config\\s+(list|get)\\b/': true,
  '/^npm\\s+pkg\\s+get\\b/': true,
  '/^npm\\s+audit$/': true,
  '/^npm\\s+cache\\s+verify\\b/': true,
  '/^yarn\\s+(list|outdated|info|why|bin|help|versions)\\b/': true,
  '/^yarn\\s+licenses\\b/': true,
  '/^yarn\\s+audit\\b(?!.*\\bfix\\b)/': true,
  '/^yarn\\s+config\\s+(list|get)\\b/': true,
  '/^yarn\\s+cache\\s+dir\\b/': true,
  '/^pnpm\\s+(ls|list|outdated|why|root|bin|doctor)\\b/': true,
  '/^pnpm\\s+licenses\\b/': true,
  '/^pnpm\\s+audit\\b(?!.*\\bfix\\b)/': true,
  '/^pnpm\\s+config\\s+(list|get)\\b/': true,

  // Safe lockfile-only installs
  'npm ci': true,
  '/^npm\\s+ci\\s+\\S/': false,
  '/^yarn\\s+install\\s+--frozen-lockfile\\b/': true,
  '/^yarn\\s+install\\s+--frozen-lockfile\\s+\\S/': false,
  '/^pnpm\\s+install\\s+--frozen-lockfile\\b/': true,
  '/^pnpm\\s+install\\s+--frozen-lockfile\\s+\\S/': false,

  // Safe commands with dangerous arg blocking
  column: true,
  '/^column\\b.*\\s-c\\s+[0-9]{4,}/': false,
  date: true,
  '/^date\\b.*\\s(-s|--set)\\b/': false,
  find: true,
  '/^find\\b.*\\s-(delete|exec|execdir|fprint|fprintf|fls|ok|okdir)\\b/': false,
  rg: true,
  '/^rg\\b.*\\s(--pre|--hostname-bin)\\b/': false,
  sed: true,
  '/^sed\\b.*\\s(-[a-zA-Z]*(e|f)[a-zA-Z]*|--expression|--file)\\b/': false,
  '/^sed\\b.*s\\/.*\\/.*\\/[ew]/': false,
  // Quoted positional script whose first command is e/r/R/w/W. The opening quote is
  // captured so the closing quote must match it, and whitespace and `!` are allowed
  // around the optional address since sed ignores them. The option prefix also skips
  // the separate operand consumed by -l/--line-length.
  '/^sed\\b(?:\\s+(?:(?:-l|--line-length)\\s+\\S+|--line-length=\\S+|-\\S+))*\\s+([\'"])\\s*(?:(?:\\d+|\\$|\\/(?:\\\\.|[^\\/])*\\/)(?:\\s*,\\s*(?:\\d+|\\$|\\/(?:\\\\.|[^\\/])*\\/))?)?\\s*!?\\s*[erRwW](?:\\s|\\1)/': false,
  // Same dangerous commands after a `;` or `{` separator inside a quoted script.
  // Escaped characters are consumed before testing for the matching closing quote.
  '/^sed\\b(?:\\s+(?:(?:-l|--line-length)\\s+\\S+|--line-length=\\S+|-\\S+))*\\s+([\'"])(?:\\\\.|(?!\\1).)*[;{]\\s*(?:(?:\\d+|\\$|\\/(?:\\\\.|[^\\/])*\\/)(?:\\s*,\\s*(?:\\d+|\\$|\\/(?:\\\\.|[^\\/])*\\/))?)?\\s*!?\\s*[erRwW](?:\\s|\\1|[;}])/': false,
  // Unquoted positional script form (e.g. `sed 1e id`, `sed w file`, `sed /pat/e file`)
  '/^sed\\b(?:\\s+(?:(?:-l|--line-length)\\s+\\S+|--line-length=\\S+|-\\S+))*\\s+(?:(?:\\d+|\\$|\\/(?:\\\\.|[^\\/])*\\/)(?:\\s*,\\s*(?:\\d+|\\$|\\/(?:\\\\.|[^\\/])*\\/))?)?\\s*!?\\s*[erRwW](?:\\s|$)/': false,
  ...SORT_AUTO_APPROVE_RULES,
  tree: true,
  '/^tree\\b.*\\s-o\\b/': false,
  '/^xxd$/': true,
  '/^xxd\\b(\\s+-\\S+)*\\s+[^-\\s]\\S*$/': true,

  // Dangerous commands
  rm: false,
  rmdir: false,
  del: false,
  'Remove-Item': false,
  ri: false,
  rd: false,
  erase: false,
  dd: false,
  kill: false,
  ps: false,
  top: false,
  'Stop-Process': false,
  spps: false,
  taskkill: false,
  'taskkill.exe': false,
  curl: false,
  wget: false,
  'Invoke-RestMethod': false,
  'Invoke-WebRequest': false,
  irm: false,
  iwr: false,
  chmod: false,
  chown: false,
  'Set-ItemProperty': false,
  sp: false,
  'Set-Acl': false,
  jq: false,
  xargs: false,
  eval: false,
  'Invoke-Expression': false,
  iex: false,
};
