/** Five-field AHP cron: what an expression means, and when it next comes round. */

/**
 * A parsed expression, as the sets each field allows.
 *
 * Sets rather than the source text, because the question asked of this a
 * thousand times a day is "does this minute match" and not "what did somebody
 * type" - and because parsing once is what makes a bad expression a refusal at
 * the moment it is written rather than a schedule that silently never fires.
 */
export interface Cron {
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  doms: ReadonlySet<number>;
  months: ReadonlySet<number>;
  dows: ReadonlySet<number>;
  /**
   * Whether the day fields were narrowed, which decides how they combine.
   *
   * Unix cron's one genuine oddity: when both day-of-month and day-of-week are
   * restricted, an occurrence matches when *either* does - `0 0 1 * 1` is the
   * first of the month **and** every Monday. When one is `*` the other simply
   * applies. Getting this backwards turns a weekly job into a yearly one.
   */
  domRestricted: boolean;
  dowRestricted: boolean;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** One field's bounds, and the names it also accepts. */
interface Field {
  name: string;
  min: number;
  max: number;
  names?: string[];
}

const FIELDS: Field[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTHS },
  // 7 as well as 0, both meaning Sunday, which is what every crontab accepts.
  { name: 'day of week', min: 0, max: 7, names: DAYS },
];

/** A single value, by number or by name. */
function valueOf(text: string, field: Field): number {
  const named = field.names?.indexOf(text.toLowerCase());
  if (named !== undefined && named >= 0) return named + (field.names === MONTHS ? 1 : 0);
  if (!/^\d+$/.test(text)) throw new Error(`${text} is not a ${field.name}`);
  const value = Number(text);
  if (value < field.min || value > field.max) {
    throw new Error(`${value} is out of range for ${field.name} (${field.min}-${field.max})`);
  }
  return value;
}

/** One field: a comma-separated list of values, ranges and steps. */
function parseField(text: string, field: Field): Set<number> {
  const out = new Set<number>();
  for (const term of text.split(',')) {
    if (term === '') throw new Error(`Empty ${field.name}`);
    const [range, step] = term.split('/') as [string, string | undefined];
    if (term.split('/').length > 2) throw new Error(`${term} has more than one step`);
    let by = 1;
    if (step !== undefined) {
      if (!/^\d+$/.test(step) || Number(step) === 0) {
        throw new Error(`${step} is not a step for ${field.name}; a step must be a positive integer`);
      }
      by = Number(step);
    }
    let from: number;
    let to: number;
    if (range === '*') {
      from = field.min;
      to = field.max;
    }
    else if (range.includes('-')) {
      const [a, b] = range.split('-') as [string, string];
      if (range.split('-').length > 2) throw new Error(`${range} is not a range`);
      from = valueOf(a, field);
      to = valueOf(b, field);
      if (to < from) throw new Error(`${range} runs backwards`);
    }
    else {
      from = valueOf(range, field);
      // A step on a single value means from there to the end of the field,
      // which is what crontab does with `5/10`.
      to = step === undefined ? from : field.max;
    }
    for (let at = from; at <= to; at += by) out.add(at);
  }
  return out;
}

/**
 * Read an expression, or say what is wrong with it.
 *
 * Throws rather than returning undefined: an unparseable schedule is a thing
 * somebody typed and must be told about, and the one place it is read is the
 * moment they write it.
 */
export function parseCron(expression: string): Cron {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`A schedule has five fields; ${expression.trim() === '' ? 'this one has none' : `this one has ${fields.length}`}`);
  }
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string];
  const dows = parseField(dow, FIELDS[4] as Field);
  // Both spellings of Sunday collapse to one, so a weekday test is a lookup.
  if (dows.has(7)) { dows.delete(7); dows.add(0); }
  return {
    minutes: parseField(minute, FIELDS[0] as Field),
    hours: parseField(hour, FIELDS[1] as Field),
    doms: parseField(dom, FIELDS[2] as Field),
    months: parseField(month, FIELDS[3] as Field),
    dows,
    domRestricted: dom !== '*',
    dowRestricted: dow !== '*',
  };
}

// ------------------------------------------------------------- the time zone

/** A wall-clock reading: what a clock on that wall says. */
interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const readers = new Map<string, Intl.DateTimeFormat>();

/** Cached, because this is called once per candidate day and building one is not free. */
function readerFor(timeZone: string): Intl.DateTimeFormat {
  let held = readers.get(timeZone);
  if (!held) {
    held = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    readers.set(timeZone, held);
  }
  return held;
}

/** What the clock in that zone said at that instant. */
function wallAt(instant: number, timeZone: string): Wall {
  const parts = readerFor(timeZone).formatToParts(new Date(instant));
  const found: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') found[part.type] = Number(part.value);
  }
  return {
    year: found.year as number,
    month: found.month as number,
    day: found.day as number,
    hour: found.hour as number,
    minute: found.minute as number,
  };
}

/** That zone's offset from UTC, in minutes, at that instant. */
function offsetAt(instant: number, timeZone: string): number {
  const wall = wallAt(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  // To the minute: the reading has no seconds, so the instant must not either.
  return (asUtc - Math.floor(instant / 60000) * 60000) / 60000;
}

/**
 * The instant at which that zone's clock reads that.
 *
 * Two passes, because the offset depends on the answer: the first guess uses
 * the offset in force at roughly the right time and the second uses the one in
 * force at the instant the first produced, which is what gets the hour after a
 * DST change right. Returns undefined for a wall time that does not exist -
 * the hour a spring-forward skips - because a schedule pointing into the gap
 * has no occurrence that day rather than an occurrence at some other time.
 */
function instantOf(wall: Wall, timeZone: string): number | undefined {
  const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  let instant = guess - offsetAt(guess, timeZone) * 60000;
  const again = guess - offsetAt(instant, timeZone) * 60000;
  if (again !== instant) instant = again;
  const back = wallAt(instant, timeZone);
  if (back.hour !== wall.hour || back.minute !== wall.minute || back.day !== wall.day) return undefined;
  return instant;
}

// ------------------------------------------------------------- the next time

/** How far ahead to look before calling an expression unreachable. `0 0 30 2 *` is. */
const HORIZON_DAYS = 1500;

/** Whether that calendar day is one this expression fires on. */
function dayMatches(cron: Cron, year: number, month: number, day: number): boolean {
  if (!cron.months.has(month)) return false;
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const byDom = cron.doms.has(day);
  const byDow = cron.dows.has(dow);
  if (cron.domRestricted && cron.dowRestricted) return byDom || byDow;
  if (cron.domRestricted) return byDom;
  if (cron.dowRestricted) return byDow;
  return true;
}

/**
 * The first occurrence strictly after that instant, or undefined.
 *
 * Walked a day at a time rather than a minute at a time: a minute-by-minute
 * search over the horizon is half a million time-zone conversions to answer a
 * question about February.
 */
export function nextOccurrence(cron: Cron, after: Date, timeZone: string): Date | undefined {
  const from = after.getTime();
  const start = wallAt(from, timeZone);
  const minutes = [...cron.minutes].sort((a, b) => a - b);
  const hours = [...cron.hours].sort((a, b) => a - b);

  for (let ahead = 0; ahead <= HORIZON_DAYS; ahead++) {
    // Calendar arithmetic in UTC on the *wall* date, which is date arithmetic
    // and not instant arithmetic - adding 24 hours to an instant lands on the
    // same date twice a year.
    const at = new Date(Date.UTC(start.year, start.month - 1, start.day + ahead));
    const year = at.getUTCFullYear();
    const month = at.getUTCMonth() + 1;
    const day = at.getUTCDate();
    if (!dayMatches(cron, year, month, day)) continue;
    for (const hour of hours) {
      for (const minute of minutes) {
        const instant = instantOf({ year, month, day, hour, minute }, timeZone);
        // Undefined is the spring-forward gap; earlier than `after` is the
        // hour a fall-back repeats, where the first pass is already behind us.
        if (instant === undefined || instant <= from) continue;
        return new Date(instant);
      }
    }
  }
  return undefined;
}
