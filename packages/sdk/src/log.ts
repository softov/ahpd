/**
 * A log line's level, and a log that takes one.
 *
 * The levels are VS Code's log service's, by the names its `LogLevelToString`
 * gives them, and each carries the OTLP severity VS Code's host sends a record
 * of it at.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/log/common/log.ts#L909-L918
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/otlp/otlpLogEmitter.ts#L62-L75
 */

/** How much a line matters, lowest first. */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

/** Every level, lowest first, so an index compares two of them. */
export const LOG_LEVELS: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error'];

/** The OTLP `severityNumber` of each level: the lowest of its band. */
export const LOG_SEVERITY: Readonly<Record<LogLevel, number>> = { trace: 1, debug: 5, info: 9, warn: 13, error: 17 };

/**
 * A log: each method writes at its own level, as VS Code's `ILogService` is
 * called, and called as a function it writes at the level given, info when none
 * is, as VS Code's `ILogger.log` takes one. A function form is what lets a
 * module that is handed a plain `(line) => void` pass a line's level through.
 */
export interface Logger {
  (line: string, level?: LogLevel): void;
  trace(line: string): void;
  debug(line: string): void;
  info(line: string): void;
  warn(line: string): void;
  error(line: string): void;
}

/** What a `Logger` writes through: the line and its level. */
export type LogWrite = (line: string, level: LogLevel) => void;

/**
 * A `Logger` over a writer.
 *
 * A plain `(line) => void` is a writer too: it receives the level as a second
 * argument it ignores. So a log handed in from outside, which may be either,
 * becomes a `Logger` here before anything calls a method on it, and one that
 * already is one keeps its own methods.
 */
export const loggerOf = (write: LogWrite | ((line: string) => void) | Logger): Logger => {
  if (isLogger(write)) return write;
  const to = write as LogWrite;
  const logger = ((line: string, level: LogLevel = 'info') => { to(line, level); }) as Logger;
  for (const level of LOG_LEVELS) logger[level] = (line: string) => { to(line, level); };
  return logger;
};

/** Whether a log already has the methods of every level. */
const isLogger = (log: unknown): log is Logger => typeof log === 'function'
  && LOG_LEVELS.every((level) => typeof (log as unknown as Record<string, unknown>)[level] === 'function');

/** The words programs write for a level, by the level each one is here. */
const WORDS: Readonly<Record<string, LogLevel>> = {
  trace: 'trace', debug: 'debug', info: 'info', notice: 'info',
  warn: 'warn', warning: 'warn', error: 'error', err: 'error', fatal: 'error', critical: 'error', crit: 'error', panic: 'error',
};

/** pino's numbered levels, which a JSON line may carry in place of a word. */
const NUMBERED: Readonly<Record<number, LogLevel>> = { 10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'error' };

/** A time a program put at the front of its own line: ISO or spdlog's, with a zone or none. */
const STAMP = String.raw`\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?`;

/** A level in brackets, or as a word after the program's own time: either case. */
const LEADING = new RegExp(String.raw`^\s*(?:${STAMP}\s+)?(?:\[(\w+)\]|(\w+)(?=[:\s]))[:\s]\s*`, 'u');

/** A level word that opens a line with no time before it: `WARN x`, `WARNING:x` or `Warning: x`, and not `info about`. */
const BARE = /^\s*([A-Z]+(?=[:\s])|[A-Z][a-z]+(?=:))[:\s]\s*/u;

/**
 * The level a line another program wrote says it is, and the line without the
 * time and the level it opened with.
 *
 * A server's stderr is a log of its own, and the common shapes say their level:
 * Rust's `2026-11-09T16:18:54Z  WARN target: message`, `[WARN] message`,
 * `Warning: message`, logfmt's `level=warn`, and a JSON line's `level`. A line
 * that says none answers nothing, and its caller logs it at the level it
 * chooses: a level read from the words of a sentence would be wrong too often.
 */
export const levelIn = (line: string): { level: LogLevel; text: string } | undefined => {
  const trimmed = line.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { level?: unknown };
      const said = typeof parsed.level === 'number' ? NUMBERED[parsed.level] : typeof parsed.level === 'string' ? WORDS[parsed.level.toLowerCase()] : undefined;
      if (said !== undefined) return { level: said, text: trimmed };
    }
    catch { /* not JSON after all; read on */ }
  }
  const stamped = new RegExp(`^\\s*${STAMP}\\s+`, 'u').test(trimmed);
  const leading = LEADING.exec(trimmed);
  const word = leading?.[1] ?? (stamped ? leading?.[2] : undefined);
  const known = word === undefined ? undefined : WORDS[word.toLowerCase()];
  if (leading !== null && known !== undefined) return { level: known, text: trimmed.slice(leading[0].length) };
  const bare = BARE.exec(trimmed);
  const plain = bare === null ? undefined : WORDS[(bare[1] as string).toLowerCase()];
  if (bare !== null && plain !== undefined) return { level: plain, text: trimmed.slice(bare[0].length) };
  const logfmt = /(?:^|\s)level=("?)(\w+)\1(?=\s|$)/u.exec(trimmed);
  const field = logfmt === null ? undefined : WORDS[(logfmt[2] as string).toLowerCase()];
  if (field !== undefined) return { level: field, text: trimmed };
  return undefined;
};
