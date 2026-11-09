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
 * A log: called as a function it writes at info, and each method writes at its
 * own level, as VS Code's `ILogService` is called.
 */
export interface Logger {
  (line: string): void;
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
  const logger = ((line: string) => { to(line, 'info'); }) as Logger;
  for (const level of LOG_LEVELS) logger[level] = (line: string) => { to(line, level); };
  return logger;
};

/** Whether a log already has the methods of every level. */
const isLogger = (log: unknown): log is Logger => typeof log === 'function'
  && LOG_LEVELS.every((level) => typeof (log as unknown as Record<string, unknown>)[level] === 'function');
