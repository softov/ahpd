/**
 * One line of the daemon's log, as VS Code writes one.
 *
 * VS Code's log files hold `2026-11-09 14:02:11.123 [warning] message`: spdlog's
 * pattern `%Y-%m-%d %H:%M:%S.%e [%l] %v`, whose level words are spdlog's own.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/log/node/spdlogLog.ts#L29
 */

import { styleText } from 'node:util';
import { LOG_LEVELS } from '@ahpd/sdk';
import type { LogLevel } from '@ahpd/sdk';

/** The lowest level the daemon writes, or none at all. */
export type LogThreshold = LogLevel | 'off';

/** The clock a line's time is read on. */
export type LogTime = 'local' | 'utc';

/** The word in a line's brackets: spdlog's name for each level. */
const TAG: Readonly<Record<LogLevel, string>> = { trace: 'trace', debug: 'debug', info: 'info', warn: 'warning', error: 'error' };

/** The colour of each level's tag; info has none. */
const COLOUR: Readonly<Record<LogLevel, 'gray' | 'yellow' | 'red' | undefined>> = {
  trace: 'gray', debug: 'gray', info: undefined, warn: 'yellow', error: 'red',
};

/** Whether a line at `level` is written under `threshold`. */
export const written = (level: LogLevel, threshold: LogThreshold): boolean =>
  threshold !== 'off' && LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(threshold);

const two = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD HH:MM:SS.mmm` on the local clock, or the same on UTC with a `Z`. */
export const timeOf = (at: Date, time: LogTime): string => {
  if (time === 'utc') return `${at.toISOString().slice(0, 23).replace('T', ' ')}Z`;
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} `
    + `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}.${String(at.getMilliseconds()).padStart(3, '0')}`;
};

/**
 * The line as written: the time, the level's tag, the message.
 *
 * Coloured through `styleText` against `stream`, which colours only where the
 * stream is a terminal and `NO_COLOR` and `FORCE_COLOR` allow it, so a
 * detached daemon's `daemon.log` holds plain text. The tag carries the colour,
 * and an error's message is red too, so it is found by eye in a long log.
 */
export const logLine = (message: string, level: LogLevel, time: LogTime, stream: NodeJS.WritableStream, at = new Date()): string => {
  const colour = COLOUR[level];
  const tag = `[${TAG[level]}]`;
  const said = colour === undefined ? tag : styleText(colour, tag, { stream });
  const body = level === 'error' ? styleText('red', message, { stream }) : message;
  return `${timeOf(at, time)} ${said} ${body}`;
};
