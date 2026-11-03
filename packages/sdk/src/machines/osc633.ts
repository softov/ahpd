/**
 * The marks VS Code's shell integration scripts write, read out of a shell's
 * output.
 *
 * VS Code's `Osc633Parser`
 * (https://github.com/microsoft/vscode/blob/122ec4fe4431e8435c42e9b609e3a43a60877383/src/vs/platform/agentHost/node/osc633Parser.ts),
 * whose `parseSegments` its agent host runs over the raw output of every
 * terminal it injects the scripts into. Each OSC 633 sequence becomes an event
 * and leaves the output; every other byte, other OSC sequences included, stays
 * where it was.
 *
 * The reference's parser holds a sequence that arrives in two chunks until its
 * end arrives. Here that buffer is the store's own: `unfinished` in
 * `terminals.ts` holds the end of a chunk that may be the start of a mark, and
 * hands this a whole sequence. So this reads one payload at a time and keeps
 * nothing between calls.
 *
 * The reference's `const enum` of event types is a union of their names here,
 * because this package's source also runs under Node's type stripping, which
 * erases types and has no enums.
 */

/** 633;A - Prompt start. Used to detect shell integration is active. */
export interface Osc633PromptStartEvent {
  type: 'PromptStart';
}

/** 633;B - Command start (where user inputs command). */
export interface Osc633CommandStartEvent {
  type: 'CommandStart';
}

/** 633;C - Command executed (output begins). */
export interface Osc633CommandExecutedEvent {
  type: 'CommandExecuted';
}

/** 633;D[;exitCode] - Command finished. */
export interface Osc633CommandFinishedEvent {
  type: 'CommandFinished';
  exitCode: number | undefined;
}

/** 633;E;commandLine[;nonce] - Explicit command line. */
export interface Osc633CommandLineEvent {
  type: 'CommandLine';
  commandLine: string;
  nonce: string | undefined;
}

/** 633;P;Key=Value - Property (e.g. Cwd). */
export interface Osc633PropertyEvent {
  type: 'Property';
  key: string;
  value: string;
}

export type Osc633Event =
  | Osc633PromptStartEvent
  | Osc633CommandStartEvent
  | Osc633CommandExecutedEvent
  | Osc633CommandFinishedEvent
  | Osc633CommandLineEvent
  | Osc633PropertyEvent;

/**
 * Decode escaped values in OSC 633 messages.
 * Handles `\\` -> `\` and `\xAB` -> character with code 0xAB.
 */
function deserializeOscMessage(message: string): string {
  if (message.indexOf('\\') === -1) {
    return message;
  }
  return message.replaceAll(
    /\\(\\|x([0-9a-f]{2}))/gi,
    (_match: string, op: string, hex?: string) => (hex ? String.fromCharCode(parseInt(hex, 16)) : op),
  );
}

/**
 * What one OSC 633 sequence meant, from its payload - the part after `633;`,
 * and nothing when it names an event the store does not read.
 *
 * `E` carries the command line the shell actually ran, and the nonce it was
 * given, so a line some program printed cannot pass for the shell's. Both are
 * escaped by the script: a `;` in a line is `\x3b`, so the first bare `;` is
 * the one before the nonce.
 */
export function osc633Of(payload: string): Osc633Event | undefined {
  const semiIdx = payload.indexOf(';');
  if ((semiIdx === -1 ? payload.length : semiIdx) !== 1) {
    return undefined;
  }

  const command = payload[0];
  const argsRaw = semiIdx === -1 ? '' : payload.substring(semiIdx + 1);

  switch (command) {
    case 'A':
      return { type: 'PromptStart' };
    case 'B':
      return { type: 'CommandStart' };
    case 'C':
      return { type: 'CommandExecuted' };
    case 'D': {
      const exitCode = argsRaw.length > 0 ? parseInt(argsRaw, 10) : undefined;
      return {
        type: 'CommandFinished',
        exitCode: exitCode !== undefined && !isNaN(exitCode) ? exitCode : undefined,
      };
    }
    case 'E': {
      const nonceIdx = argsRaw.indexOf(';');
      const commandLine = deserializeOscMessage(nonceIdx === -1 ? argsRaw : argsRaw.substring(0, nonceIdx));
      const nonce = nonceIdx === -1 ? undefined : argsRaw.substring(nonceIdx + 1);
      return { type: 'CommandLine', commandLine, nonce };
    }
    case 'P': {
      const deserialized = deserializeOscMessage(argsRaw);
      const eqIdx = deserialized.indexOf('=');
      if (eqIdx === -1) {
        return undefined;
      }
      return {
        type: 'Property',
        key: deserialized.substring(0, eqIdx),
        value: deserialized.substring(eqIdx + 1),
      };
    }
    default:
      return undefined;
  }
}
