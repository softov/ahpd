import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Whether every catalog path still names a field.
 *
 * A catalog is keyed by field path, so a renamed key, a removed enum value or
 * a misspelt block leaves an entry that nothing reads, and nothing says so.
 * This lists each one: a path in `options` the manifest's `optionsSchema` does
 * not declare, a path in `session` the package's sources do not declare, and a
 * block or a field that is not one a lookup reads.
 *
 * Static, as `scripts/boundary.mjs` is. An `options` key and its enum values
 * are read from the manifest. A `session` key is one the sources declare as
 * `<key>: {` or `<key>: build(`, or register as `registerSessionConfig('<key>'`, and an enum value
 * is one the sources, or the type declarations of a dependency, hold as a
 * quoted string: a list of modes may come from the package that defines it.
 * A `views` path is `<surface>.<componentId>.<prop>`, and the plugin makes its
 * views at run time, so only that shape is checked: `text` or `label`, a string.
 *
 * With no argument it reads the sdk's own catalogs and every package whose
 * manifest names `ahpd.i18n`. Each argument is one package folder instead.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Every `.ts` under a directory, recursively, outside `node_modules`. */
const sources = (dir) => readdirSync(dir).flatMap((entry) => {
  const path = join(dir, entry);
  if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : sources(path);
  return path.endsWith('.ts') ? [path] : [];
});

/** A value that is one object, or `undefined` for anything else. */
const object = (value) => typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;

/** A string as a regular expression that matches it literally. */
const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The folder a package's catalogs are in: `ahpd.i18n`, or `src/i18n` for a package with no manifest. */
const folderOf = (dir, manifest) => {
  const ahpd = object(manifest.ahpd);
  if (typeof ahpd?.i18n === 'string') return join(dir, ahpd.i18n);
  return ahpd === undefined && existsSync(join(dir, 'src', 'i18n')) ? join(dir, 'src', 'i18n') : undefined;
};

const packages = process.argv.length > 2
  ? process.argv.slice(2)
  : readdirSync(join(ROOT, 'packages')).map((name) => join(ROOT, 'packages', name));

const problems = [];

for (const dir of packages) {
  const manifestPath = join(dir, 'package.json');
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const folder = folderOf(dir, manifest);
  if (folder === undefined || !existsSync(folder)) continue;
  const ahpd = object(manifest.ahpd);
  const options = object(object(ahpd?.optionsSchema)?.properties) ?? {};
  const text = existsSync(join(dir, 'src')) ? sources(join(dir, 'src')).map((path) => readFileSync(path, 'utf8')).join('\n') : '';
  const declarations = Object.keys(manifest.dependencies ?? {})
    .map((name) => join(dir, 'node_modules', name))
    .filter((path) => existsSync(path))
    .flatMap((path) => sources(path).filter((one) => one.endsWith('.d.ts')))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');

  /** Whether the sources declare `key` as a session key. */
  const sessionKey = (key) => new RegExp(`(?:^|[\\s{,'"])${literal(key)}['"]?\\s*:\\s*(?:\\{|[A-Za-z_$][\\w$]*\\()|registerSessionConfig\\(\\s*['"]${literal(key)}['"]`).test(text);
  /** Whether the sources hold `value` as a quoted string. */
  const quoted = (value) => [text, declarations].some((one) => one.includes(`'${value}'`) || one.includes(`"${value}"`));

  for (const file of readdirSync(folder).filter((name) => name.endsWith('.json')).sort()) {
    const where = relative(ROOT, join(folder, file)) || join(folder, file);
    const say = (path, why) => problems.push(`${where}: ${path.join('.')} ${why}`);
    let catalog;
    try {
      catalog = JSON.parse(readFileSync(join(folder, file), 'utf8'));
    }
    catch (error) {
      problems.push(`${where}: does not parse: ${error.message}`);
      continue;
    }
    if (object(catalog) === undefined) {
      problems.push(`${where}: is not a JSON object`);
      continue;
    }

    /** One field of a key: a string where a lookup reads one, and a name a lookup reads. */
    const field = (path, name, value, enumOk) => {
      if (name === 'title' || name === 'description') {
        if (typeof value !== 'string') say([...path, name], 'is not a string');
        return;
      }
      if (name === 'items') {
        const items = object(value);
        if (items === undefined) return say([...path, name], 'is not an object');
        for (const [one, leaf] of Object.entries(items)) {
          if (one !== 'title') say([...path, name, one], 'matches no field');
          else if (typeof leaf !== 'string') say([...path, name, one], 'is not a string');
        }
        return;
      }
      if (name === 'enum') {
        const labels = object(value);
        if (labels === undefined) return say([...path, name], 'is not an object');
        for (const [one, leaf] of Object.entries(labels)) {
          if (!enumOk(one)) say([...path, name, one], 'matches no enum value');
          else if (typeof leaf !== 'string') say([...path, name, one], 'is not a string');
        }
        return;
      }
      say([...path, name], 'matches no field');
    };

    for (const [block, body] of Object.entries(catalog)) {
      if (block === 'meta' && ahpd !== undefined) {
        const meta = object(body);
        if (meta === undefined) { say([block], 'is not an object'); continue; }
        for (const [name, leaf] of Object.entries(meta)) {
          if (name !== 'title' && name !== 'description') say([block, name], 'matches no field');
          else if (typeof leaf !== 'string') say([block, name], 'is not a string');
        }
        continue;
      }
      if (block === 'views') {
        const surfaces = object(body);
        if (surfaces === undefined) { say([block], 'is not an object'); continue; }
        for (const [surface, ids] of Object.entries(surfaces)) {
          const components = object(ids);
          if (components === undefined) { say([block, surface], 'is not an object'); continue; }
          for (const [id, props] of Object.entries(components)) {
            const words = object(props);
            if (words === undefined) { say([block, surface, id], 'is not an object'); continue; }
            for (const [prop, leaf] of Object.entries(words)) {
              if (prop !== 'text' && prop !== 'label') say([block, surface, id, prop], 'matches no field');
              else if (typeof leaf !== 'string') say([block, surface, id, prop], 'is not a string');
            }
          }
        }
        continue;
      }
      if (block !== 'options' && block !== 'session') { say([block], 'is not a block a lookup reads'); continue; }
      const keys = object(body);
      if (keys === undefined) { say([block], 'is not an object'); continue; }
      for (const [key, entry] of Object.entries(keys)) {
        const declared = block === 'options' ? object(options[key]) : undefined;
        if (block === 'options' ? declared === undefined : !sessionKey(key)) { say([block, key], 'matches no field'); continue; }
        const fields = object(entry);
        if (fields === undefined) { say([block, key], 'is not an object'); continue; }
        const enumOk = block === 'options'
          ? (value) => Array.isArray(declared.enum) && declared.enum.some((one) => String(one) === value)
          : quoted;
        for (const [name, value] of Object.entries(fields)) field([block, key], name, value, enumOk);
      }
    }
  }
}

for (const line of problems) console.log(line);
process.exitCode = problems.length > 0 ? 1 : 0;
