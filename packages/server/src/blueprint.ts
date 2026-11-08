/**
 * VS Code's automation blueprint: one automation as a portable `.automation.md`
 * file, which `ahpd automation export --vscode` writes and `import --vscode`
 * reads.
 *
 * The format is VS Code's, from `automationBlueprint.ts`, rule for rule: YAML
 * frontmatter holding `version`, `id`, `name`, `description` and `schedule`,
 * and the prompt as the body. VS Code refuses a file with any other key, so
 * nothing of ahpd's own is written into one. A blueprint carries no target, no
 * owner and no run state: the folder, the provider and whether it is on belong
 * to the host that imports it.
 */

import { parseYaml } from '@cofold/yaml';
import { bag, isRecord, parseCron } from '@ahpd/sdk';
import type { AutomationEntry, Bag } from '@ahpd/sdk';

export const AUTOMATION_BLUEPRINT_FILE_SUFFIX = '.automation.md';
export const AUTOMATION_BLUEPRINT_VERSION = 1;

const AUTOMATION_BLUEPRINT_ID_PATTERN = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const AUTOMATION_BLUEPRINT_PROPERTIES = new Set(['version', 'id', 'name', 'description', 'schedule']);
const AUTOMATION_BLUEPRINT_MANUAL_SCHEDULE_PROPERTIES = new Set(['kind']);
const AUTOMATION_BLUEPRINT_HOURLY_SCHEDULE_PROPERTIES = new Set(['kind']);
const AUTOMATION_BLUEPRINT_CRON_SCHEDULE_PROPERTIES = new Set(['kind', 'expression', 'timeZone']);

/** The schedules a blueprint holds, as VS Code's editor names them. */
export type AutomationInterval = 'manual' | 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'cron';

/** When a blueprint runs, in the host's own time zone. */
export interface AutomationSchedule {
  readonly interval: AutomationInterval;
  /** Five-field AHP cron expression. Required for `cron`. */
  readonly cronExpression?: string;
  /** Hour of the day, 0-23. Ignored for `manual`, `hourly` and `cron`. */
  readonly scheduleHour: number;
  /** Minute of the hour, 0-59. Ignored for `manual`, `hourly` and `cron`. */
  readonly scheduleMinute: number;
  /** Day of the week, 0 (Sunday) through 6 (Saturday). Only used for `weekly`. */
  readonly scheduleDay: number;
}

/** A portable automation definition, without a target or any run state. */
export interface AutomationBlueprint {
  readonly version: typeof AUTOMATION_BLUEPRINT_VERSION;
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly prompt: string;
  readonly schedule: AutomationSchedule;
}

export type AutomationBlueprintParseErrorCode =
  | 'invalidFrontmatter'
  | 'unknownProperty'
  | 'invalidField'
  | 'unsupportedVersion'
  | 'invalidId'
  | 'unsupportedSchedule'
  | 'unsupportedTimeZone'
  | 'missingPrompt';

/** The sentence VS Code shows for each refusal of a file. */
const parseErrorMessage = (code: AutomationBlueprintParseErrorCode, property = ''): string => {
  switch (code) {
    case 'invalidFrontmatter': return 'The file must start with valid YAML frontmatter.';
    case 'unknownProperty': return `The property '${property}' is not supported.`;
    case 'invalidField': return `The property '${property}' is missing or invalid.`;
    case 'unsupportedVersion': return `Automation blueprint version ${property} is not supported.`;
    case 'invalidId': return `The blueprint id '${property}' is invalid.`;
    case 'unsupportedSchedule': return `The cron expression '${property}' cannot be represented by the current Automation editor.`;
    case 'unsupportedTimeZone': return `The time zone '${property}' is not supported. Use 'local' so the schedule follows the importing user's time zone.`;
    case 'missingPrompt': return 'The Automation prompt must follow the frontmatter.';
  }
};

/** A file the format refuses, with VS Code's code and its sentence. */
export class AutomationBlueprintParseError extends Error {
  readonly code: AutomationBlueprintParseErrorCode;
  readonly property: string | undefined;

  constructor(code: AutomationBlueprintParseErrorCode, property?: string) {
    super(parseErrorMessage(code, property));
    this.code = code;
    this.property = property;
  }
}

/** The zone a blueprint's `local` means on this host, as VS Code reads it. */
export const localTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** One blueprint from the text of its file. Throws `AutomationBlueprintParseError`. */
export function parseAutomationBlueprint(content: string): AutomationBlueprint {
  const { header, body } = parseFrontMatter(content);

  assertKnownProperties(header, AUTOMATION_BLUEPRINT_PROPERTIES);
  const version = readRequiredInteger(header, 'version');
  if (version !== AUTOMATION_BLUEPRINT_VERSION) {
    throw new AutomationBlueprintParseError('unsupportedVersion', String(version));
  }

  const id = readRequiredString(header, 'id');
  if (id.length > 64 || !AUTOMATION_BLUEPRINT_ID_PATTERN.test(id)) {
    throw new AutomationBlueprintParseError('invalidId', id);
  }

  const name = readRequiredString(header, 'name');
  const description = readOptionalString(header, 'description');
  const schedule = readSchedule(header);
  const prompt = body.trim();
  if (!prompt) {
    throw new AutomationBlueprintParseError('missingPrompt');
  }

  return {
    version: AUTOMATION_BLUEPRINT_VERSION,
    id,
    name,
    ...(description ? { description } : {}),
    prompt,
    schedule,
  };
}

/** One blueprint as the text of its file, exactly as VS Code writes it. */
export function serializeAutomationBlueprint(blueprint: AutomationBlueprint): string {
  const lines = [
    '---',
    `version: ${String(AUTOMATION_BLUEPRINT_VERSION)}`,
    `id: ${quoteYamlString(blueprint.id)}`,
    `name: ${quoteYamlString(blueprint.name)}`,
  ];
  if (blueprint.description) {
    lines.push(`description: ${quoteYamlString(blueprint.description)}`);
  }
  lines.push('schedule:');
  switch (blueprint.schedule.interval) {
    case 'manual':
      lines.push('  kind: manual');
      break;
    case 'hourly':
      lines.push('  kind: hourly');
      break;
    case 'daily':
    case 'weekdays':
    case 'weekly':
    case 'cron':
      lines.push(
        '  kind: cron',
        `  expression: ${quoteYamlString(toCronExpression(blueprint.schedule))}`,
        '  timeZone: local',
      );
      break;
  }
  lines.push('---', '', blueprint.prompt.trim(), '');
  return lines.join('\n');
}

/**
 * One automation as a blueprint, or a refusal that says what the format cannot
 * hold.
 *
 * The name is the title and the id is made from it, as VS Code's export does.
 * The folder, the provider, the owner and whether it is on are left out: a
 * blueprint has no target. The schedule keeps its hour and minute and drops
 * its zone: `timeZone: local` is the zone of whoever imports the file.
 */
export function automationToBlueprint(automation: AutomationEntry): AutomationBlueprint {
  const named = automation.resource.replace(/^ahp-automation:\//u, '');
  const definition = bag(automation.definition);
  const title = typeof definition.title === 'string' ? definition.title.trim() : '';
  const name = title || named;
  const text = bag(definition.message).text;
  const prompt = typeof text === 'string' ? text.trim() : '';
  if (!prompt) throw new Error(`${named} has no message, and a VS Code automation file needs one.`);
  return {
    version: AUTOMATION_BLUEPRINT_VERSION,
    id: createAutomationBlueprintId(name),
    name,
    prompt,
    schedule: projectSchedule(named, definition.triggers),
  };
}

/** The file name VS Code gives an automation's blueprint. */
export function createAutomationBlueprintFileName(name: string): string {
  return `${createAutomationBlueprintId(name)}${AUTOMATION_BLUEPRINT_FILE_SUFFIX}`;
}

/**
 * The triggers a blueprint's schedule becomes on this host, as VS Code's agent
 * host store writes them: none for `manual`, and one schedule in `zone`
 * otherwise.
 */
export function scheduleTrigger(schedule: AutomationSchedule, zone: string = localTimeZone()): Bag[] {
  if (schedule.interval === 'manual') return [];
  const expression = schedule.interval === 'hourly' ? `${String(schedule.scheduleMinute)} * * * *` : toCronExpression(schedule);
  return [{
    id: 'schedule',
    kind: 'schedule',
    schedule: { expression, timeZone: zone },
    misfirePolicy: 'runOnce',
  }];
}

function createAutomationBlueprintId(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/--+|\.\.+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .slice(0, 64)
    .replace(/[^a-z0-9]+$/g, '');
  return normalized || 'automation';
}

/** The weekday names a cron expression may use, Sunday first, as VS Code reads them. */
const CRON_WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/**
 * An automation's triggers as a blueprint schedule, refused where the format
 * cannot hold them.
 *
 * The format holds one schedule or none, in the importer's zone, and catches a
 * missed run up. A schedule is read as VS Code's agent host store projects
 * one: every minute past the hour is hourly, a daily, weekday or weekly time
 * is one of those, and any other expression is a cron schedule with the
 * expression as it is.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/sessions/contrib/providers/agentHost/browser/agentHostAutomationStore.ts#L1206-L1256
 */
function projectSchedule(named: string, raw: unknown): AutomationSchedule {
  const triggers = Array.isArray(raw) ? raw.map((one) => bag(one)) : [];
  if (triggers.some((trigger) => trigger.kind !== 'schedule')) {
    throw new Error(`${named} has an event trigger, and a VS Code automation file holds only a schedule.`);
  }
  if (triggers.length > 1) {
    throw new Error(`${named} has more than one schedule, and a VS Code automation file holds one.`);
  }
  const trigger = triggers[0];
  if (trigger === undefined) return { interval: 'manual', scheduleHour: 0, scheduleMinute: 0, scheduleDay: 0 };
  const held = bag(trigger.schedule);
  if (trigger.misfirePolicy === 'skip') {
    throw new Error(`${named} skips a missed run, and a VS Code automation file always catches one up.`);
  }
  const expression = typeof held.expression === 'string' ? held.expression.trim() : '';
  const cron: AutomationSchedule = { interval: 'cron', cronExpression: expression, scheduleHour: 0, scheduleMinute: 0, scheduleDay: 0 };
  const [minuteValue, hourValue, dayOfMonth, month, dayValue, ...remaining] = expression.split(/\s+/);
  if (remaining.length > 0 || dayOfMonth !== '*' || month !== '*') return cron;
  const scheduleMinute = parseCronValue(minuteValue, 0, 59);
  if (scheduleMinute === undefined) return cron;
  if (hourValue === '*' && dayValue === '*') return { interval: 'hourly', scheduleHour: 0, scheduleMinute, scheduleDay: 0 };
  const scheduleHour = parseCronValue(hourValue, 0, 23);
  if (scheduleHour === undefined) return cron;
  if (dayValue === '*') return { interval: 'daily', scheduleHour, scheduleMinute, scheduleDay: 0 };
  if (dayValue === '1-5' || dayValue?.toUpperCase() === 'MON-FRI' || dayValue === '1,2,3,4,5') {
    return { interval: 'weekdays', scheduleHour, scheduleMinute, scheduleDay: 0 };
  }
  const weekday = dayValue === undefined ? -1 : CRON_WEEKDAYS.indexOf(dayValue.toUpperCase());
  const scheduleDay = weekday >= 0 ? weekday : parseCronValue(dayValue, 0, 7);
  return scheduleDay === undefined ? cron : { interval: 'weekly', scheduleHour, scheduleMinute, scheduleDay: scheduleDay === 7 ? 0 : scheduleDay };
}

/**
 * The frontmatter as a mapping of scalars and mappings, and the text below it.
 *
 * VS Code reads every scalar as its text, so a number or a boolean here is
 * read back as the text it was written as, and an empty value as empty text.
 */
function parseFrontMatter(content: string): { header: Bag; body: string } {
  const opened = /^---[ \t]*\r?\n/.exec(content);
  if (opened === null) throw new AutomationBlueprintParseError('invalidFrontmatter');
  const rest = content.slice(opened[0].length);
  const closed = /^---[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (closed === null) throw new AutomationBlueprintParseError('invalidFrontmatter');
  let header: unknown;
  try {
    header = parseYaml(rest.slice(0, closed.index));
  }
  catch {
    throw new AutomationBlueprintParseError('invalidFrontmatter');
  }
  if (!isRecord(header)) throw new AutomationBlueprintParseError('invalidFrontmatter');
  return { header, body: rest.slice(closed.index + closed[0].length) };
}

function readSchedule(root: Bag): AutomationSchedule {
  const node = root.schedule;
  if (!isRecord(node)) {
    throw new AutomationBlueprintParseError('invalidField', 'schedule');
  }

  const kind = readRequiredString(node, 'kind');
  if (kind === 'manual') {
    assertKnownProperties(node, AUTOMATION_BLUEPRINT_MANUAL_SCHEDULE_PROPERTIES, 'schedule.');
    return { interval: 'manual', scheduleHour: 0, scheduleMinute: 0, scheduleDay: 0 };
  }
  if (kind === 'hourly') {
    assertKnownProperties(node, AUTOMATION_BLUEPRINT_HOURLY_SCHEDULE_PROPERTIES, 'schedule.');
    return { interval: 'hourly', scheduleHour: 0, scheduleMinute: 0, scheduleDay: 0 };
  }
  if (kind !== 'cron') {
    throw new AutomationBlueprintParseError('invalidField', 'schedule.kind');
  }

  assertKnownProperties(node, AUTOMATION_BLUEPRINT_CRON_SCHEDULE_PROPERTIES, 'schedule.');
  const expression = readRequiredString(node, 'expression');
  const timeZone = readRequiredString(node, 'timeZone');
  if (timeZone !== 'local') {
    throw new AutomationBlueprintParseError('unsupportedTimeZone', timeZone);
  }
  return fromCronExpression(expression);
}

function toCronExpression(schedule: AutomationSchedule): string {
  switch (schedule.interval) {
    case 'manual':
      throw new Error('Manual Automation schedules do not have cron expressions.');
    case 'hourly':
      throw new Error('Hourly Automation schedules do not have cron expressions.');
    case 'daily':
      return `${String(schedule.scheduleMinute)} ${String(schedule.scheduleHour)} * * *`;
    case 'weekdays':
      return `${String(schedule.scheduleMinute)} ${String(schedule.scheduleHour)} * * 1-5`;
    case 'weekly':
      return `${String(schedule.scheduleMinute)} ${String(schedule.scheduleHour)} * * ${String(schedule.scheduleDay)}`;
    case 'cron':
      if (!schedule.cronExpression) {
        throw new AutomationBlueprintParseError('unsupportedSchedule');
      }
      return schedule.cronExpression;
  }
}

/**
 * A blueprint's cron expression as a schedule: a daily, weekday or weekly time
 * where it is one, and a cron schedule otherwise, refused where it is no
 * five-field AHP cron expression, as VS Code's validator refuses one.
 */
function fromCronExpression(expression: string): AutomationSchedule {
  try {
    parseCron(expression);
  }
  catch {
    throw new AutomationBlueprintParseError('unsupportedSchedule', expression);
  }
  const cron: AutomationSchedule = { interval: 'cron', cronExpression: expression, scheduleHour: 0, scheduleMinute: 0, scheduleDay: 0 };
  const [minuteValue, hourValue, dayOfMonth, month, dayValue, ...remaining] = expression.trim().split(/\s+/);
  if (remaining.length > 0 || dayOfMonth !== '*' || month !== '*') return cron;
  const scheduleMinute = parseCronValue(minuteValue, 0, 59);
  if (scheduleMinute === undefined) return cron;
  const scheduleHour = parseCronValue(hourValue, 0, 23);
  if (scheduleHour === undefined) return cron;
  if (dayValue === '*') return { interval: 'daily', scheduleHour, scheduleMinute, scheduleDay: 0 };
  if (dayValue === '1-5') return { interval: 'weekdays', scheduleHour, scheduleMinute, scheduleDay: 0 };
  const scheduleDay = parseCronValue(dayValue, 0, 7);
  if (scheduleDay === undefined) return cron;
  return { interval: 'weekly', scheduleHour, scheduleMinute, scheduleDay: scheduleDay === 7 ? 0 : scheduleDay };
}

function parseCronValue(value: string | undefined, minimum: number, maximum: number): number | undefined {
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return parsed >= minimum && parsed <= maximum ? parsed : undefined;
}

function assertKnownProperties(node: Bag, known: ReadonlySet<string>, prefix = ''): void {
  const unknown = Object.keys(node).find((key) => !known.has(key));
  if (unknown !== undefined) {
    throw new AutomationBlueprintParseError('unknownProperty', `${prefix}${unknown}`);
  }
}

/** A scalar's text, as VS Code's YAML reads every scalar; nothing for a mapping or a list. */
function scalarOf(value: unknown): string | undefined {
  if (value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function readRequiredString(node: Bag, name: string): string {
  const value = readOptionalString(node, name);
  if (!value) {
    throw new AutomationBlueprintParseError('invalidField', name);
  }
  return value;
}

function readOptionalString(node: Bag, name: string): string | undefined {
  if (!(name in node)) {
    return undefined;
  }
  const value = scalarOf(node[name]);
  if (value === undefined) {
    throw new AutomationBlueprintParseError('invalidField', name);
  }
  return value.trim();
}

function readRequiredInteger(node: Bag, name: string): number {
  const value = name in node ? scalarOf(node[name]) : undefined;
  if (value === undefined || !/^-?\d+$/.test(value)) {
    throw new AutomationBlueprintParseError('invalidField', name);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new AutomationBlueprintParseError('invalidField', name);
  }
  return parsed;
}

function quoteYamlString(value: string): string {
  return JSON.stringify(value);
}
