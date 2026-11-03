/**
 * The parts of an `AGENTS.md` that its owner owns, and how to read and change
 * them without touching the rest of the file.
 *
 * The file is the bot's: it may rewrite any part of it, in any shape, and the
 * parser takes what it finds rather than refusing a file. Two parts belong to
 * the owner and are all this module knows: the frontmatter keys `version`,
 * `name` and `description`, and the text under the `## Instructions` heading,
 * which runs to the next `##` heading or the end of the file. A part the file
 * does not have reads as empty.
 *
 * The writer changes those parts in place and keeps every other byte, because
 * everything else in the file is the bot's own writing - comments, other
 * frontmatter keys, other sections. The frontmatter is edited by line rather
 * than re-stringified whole for the same reason: a key a person or the bot put
 * there is not this module's to reformat.
 */

/** The layout version `writeAgents` writes when neither the parts nor the file names one. */
export const AGENTS_VERSION = 1;

/**
 * The YAML the plugin host hands the plugin, which the host reads its own
 * files with.
 *
 * Taken as a value rather than imported, so the package runs with no YAML
 * dependency of its own: the daemon gives the plugin its own subset, and a
 * test gives it the parser the other plugin tests use.
 */
export interface Yaml {
  /** A YAML text as data, with the subset the host reads its own files with. */
  parseYaml(text: string): unknown;
  /** A value as YAML text that `parseYaml` reads back as the same value. */
  stringifyYaml(value: unknown): string;
}

/** The heading whose section is the owner's, and from where the section's text begins. */
const INSTRUCTIONS = /^##[ \t]+Instructions[ \t]*(?:\r?\n|$)/m;

/** A level-2 heading, which is where the Instructions section ends. */
const HEADING = /^##(?:[ \t]|$)/m;

/** The frontmatter keys the owner owns, in the order the writer adds the ones a file lacks. */
const OWNED = ['version', 'name', 'description'] as const;

/** What an `AGENTS.md` says in the parts its owner owns. */
export interface AgentsParts {
  /** The layout version the frontmatter names, or `undefined` when it names none. */
  version: number | undefined;
  /** The bot's name, or empty. */
  name: string;
  /** One line about the bot, or empty. */
  description: string;
  /** The text under `## Instructions`, without the blank lines at each end, or empty. */
  instructions: string;
}

/** A file as the parts the writer changes and the parts it leaves alone. */
interface Split {
  /** The opening `---` line, or empty when the file has no frontmatter. */
  head: string;
  /** The YAML between the two fences, or empty. */
  front: string;
  /** The closing `---` line, or empty when the file has no frontmatter. */
  close: string;
  /** Everything after the closing fence, or the whole text when there is none. */
  body: string;
  /** Whether the file has a frontmatter to edit. */
  has: boolean;
}

/**
 * The file as its frontmatter and its body.
 *
 * A frontmatter is a `---` line first and a `---` line on a line of its own
 * somewhere below. A file that opens with anything else, or opens with `---`
 * and never closes it, has no frontmatter: it is all body, and the writer puts
 * one on top of it.
 */
function split(text: string): Split {
  const opened = /^---[ \t]*\r?\n/.exec(text);
  if (opened === null) return { head: '', front: '', close: '', body: text, has: false };
  const rest = text.slice(opened[0].length);
  const closed = /^---[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (closed === null) return { head: '', front: '', close: '', body: text, has: false };
  return {
    head: opened[0],
    front: rest.slice(0, closed.index),
    close: closed[0],
    body: rest.slice(closed.index + closed[0].length),
    has: true,
  };
}

/**
 * The frontmatter as a mapping, or nothing.
 *
 * The parser the plugin host gives the plugin, which is the one the record
 * collections read their frontmatter with, so a file means here what it means
 * there. A frontmatter that is not a mapping, or that the parser rejects, is
 * no frontmatter rather than a refusal: the file belongs to the bot, and a
 * broken one is still read for what it does say.
 */
function fields(yaml: Yaml, front: string): Record<string, unknown> | undefined {
  try {
    const parsed = yaml.parseYaml(front);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  }
  catch {
    return undefined;
  }
}

/** The text of the Instructions section, without the blank lines at each end. */
function instructionsOf(body: string): string {
  const region = sectionOf(body);
  if (region === undefined) return '';
  return body.slice(region.start, region.end)
    .replace(/^(?:[ \t]*\r?\n)+/, '')
    .replace(/(?:\r?\n[ \t]*)+$/, '');
}

/** Where the Instructions section's text starts and ends in the body, or `undefined` when there is no section. */
function sectionOf(body: string): { start: number; end: number } | undefined {
  const heading = INSTRUCTIONS.exec(body);
  if (heading === null) return undefined;
  const start = heading.index + heading[0].length;
  const next = HEADING.exec(body.slice(start));
  return { start, end: next === null ? body.length : start + next.index };
}

/** A part the file does not have as an empty value. */
const said = (fields: Record<string, unknown> | undefined, key: string): string => {
  const value = fields?.[key];
  return typeof value === 'string' ? value : '';
};

/** A layout version, where the frontmatter names an integer one. */
const versionOf = (fields: Record<string, unknown> | undefined): number | undefined => {
  const value = fields?.['version'];
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
};

/**
 * The parts an `AGENTS.md` says its owner owns.
 *
 * A file with no frontmatter, or with one that names none of the keys, reads
 * its version as `undefined` and its name and description as empty. A file
 * with no Instructions section reads its instructions as empty - what a bot
 * leaves of a section it removed, and what an edit in the UI writes again.
 */
export function readAgents(yaml: Yaml, text: string): AgentsParts {
  const { front, body } = split(text);
  const parsed = fields(yaml, front);
  return {
    version: versionOf(parsed),
    name: said(parsed, 'name'),
    description: said(parsed, 'description'),
    instructions: instructionsOf(body),
  };
}

/** One frontmatter entry, quoted or written as a block exactly as the parser reads it back. */
const entry = (yaml: Yaml, key: string, value: unknown): string => yaml.stringifyYaml({ [key]: value });

/** A frontmatter key and the text its entry takes, from its line to the last line of its value. */
interface Span {
  /** The key's name. */
  key: string;
  /** Where the key's line starts. */
  start: number;
  /** Where the line after the value's last line starts. */
  end: number;
}

/** The index just after the line that holds `at`. */
const afterLine = (text: string, at: number): number => {
  const newline = text.indexOf('\n', at);
  return newline === -1 ? text.length : newline + 1;
};

/** The index of the quote that closes the one at `at`, skipping escapes and `''`, or `-1`. */
const closingQuote = (text: string, at: number): number => {
  const quote = text[at];
  for (let pos = at + 1; pos < text.length; pos += 1) {
    const char = text[pos];
    if (quote === '"' && char === '\\') { pos += 1; continue; }
    if (char === quote) {
      if (quote === "'" && text[pos + 1] === "'") { pos += 1; continue; }
      return pos;
    }
  }
  return -1;
};

/**
 * The keys in a frontmatter, each with the text its entry takes.
 *
 * A key's entry runs to the end of the line that holds the last of its value:
 * a quoted value may go on over several lines, and a block scalar's indented
 * lines are its value too. What follows - a comment, a blank line - is not the
 * entry's, so replacing a key leaves it where it was. A column-0 line inside a
 * quoted value is part of that value, not a key of its own.
 */
function spansIn(front: string): Span[] {
  const spans: Span[] = [];
  let at = 0;
  while (at < front.length) {
    const lineEnd = afterLine(front, at);
    const line = front.slice(at, lineEnd).replace(/\r?\n$/, '');
    const key = /^([A-Za-z0-9_.-]+)[ \t]*:/.exec(line);
    if (key === null) {
      at = lineEnd;
      continue;
    }
    const colon = key[0].length - 1;
    const rest = line.slice(colon + 1).trimStart();
    let end = lineEnd;
    if (rest[0] === '"' || rest[0] === "'") {
      const close = closingQuote(front, at + line.length - rest.length);
      end = close === -1 ? front.length : afterLine(front, close);
    }
    else if (rest === '' || /^[|>][0-9+-]*[ \t]*(?:#.*)?$/.test(rest)) {
      // A block scalar, or a key with its value below it: the value runs while
      // the lines are indented or blank, and ends at the first column-0 line
      // after its last content.
      let last = lineEnd;
      let pos = lineEnd;
      while (pos < front.length) {
        const next = afterLine(front, pos);
        const content = front.slice(pos, next).replace(/\r?\n$/, '');
        if (content.trim() === '') { pos = next; continue; }
        if (!/^[ \t]/.test(content)) break;
        last = next;
        pos = next;
      }
      end = last;
    }
    spans.push({ key: key[1] ?? '', start: at, end });
    at = end;
  }
  return spans;
}

/**
 * The frontmatter with the owner's keys set and every other byte as it was.
 *
 * A key that is there has its own line and whatever lines its value took - a
 * quoted scalar's or a block's - replaced by the new entry, and a comment or a
 * blank line after it stays. Keys the frontmatter lacks are added at the top,
 * so a file a person wrote by hand keeps its shape below them. A key a bot
 * wrote twice is written twice with the new value, which is still the value the
 * parser reads last.
 */
function setFields(yaml: Yaml, front: string, values: Record<string, unknown>): string {
  const spans = spansIn(front);
  const seen = new Set(spans.map((span) => span.key));
  let out = front;
  for (let at = spans.length - 1; at >= 0; at -= 1) {
    const span = spans[at];
    if (span === undefined || !(OWNED as readonly string[]).includes(span.key)) continue;
    out = out.slice(0, span.start) + entry(yaml, span.key, values[span.key]) + out.slice(span.end);
  }
  return OWNED.filter((key) => !seen.has(key)).map((key) => entry(yaml, key, values[key])).join('') + out;
}

/**
 * What is wrong with instructions as the format can hold them, or nothing.
 *
 * The Instructions section ends at the next `##` line, so a line of the
 * instructions that starts with one would read back as the end of the section:
 * the write is refused rather than cutting the text in silence.
 */
export function instructionsProblem(instructions: string): string | undefined {
  const line = instructions.split(/\r?\n/).find((one) => /^##(?:[ \t]|$)/.test(one));
  return line === undefined ? undefined : `the instructions have a line that starts with "## ": ${line}`;
}

/** A line ending before text that does not already begin one. */
const gap = (body: string, eol: string): string =>
  body === '' || body.startsWith('\n') || body.startsWith('\r\n') ? '' : eol;

/**
 * The file with the owner's parts changed and every other byte kept.
 *
 * The version is the parts' own, or the one the frontmatter already names, or
 * `AGENTS_VERSION` - a write that says nothing about a layout does not move a
 * file from the layout it is in. A missing Instructions section is added after
 * the frontmatter, and a missing frontmatter is added on top, so a file the
 * bot wrote before this layout reads with its old text below the new section.
 */
export function writeAgents(yaml: Yaml, text: string, parts: AgentsParts): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const { head, front, close, body, has } = split(text);
  const version = parts.version ?? versionOf(fields(yaml, front)) ?? AGENTS_VERSION;
  const values: Record<string, unknown> = {
    version,
    name: parts.name,
    description: parts.description,
  };
  const edited = setFields(yaml, front, values);

  const region = sectionOf(body);
  const kept = region === undefined
    ? `${eol}## Instructions${eol}${eol}${parts.instructions}${eol}${gap(body, eol)}${body}`
    : body.slice(0, region.start) + eol + parts.instructions + eol + (region.end < body.length ? eol : '') + body.slice(region.end);

  return has
    ? head + edited + close + kept
    : `---${eol}${edited}---${eol}${kept}`;
}
