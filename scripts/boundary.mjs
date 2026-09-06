import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Whether every package imports only what it declares.
 *
 * The architectural claim this repository makes is that `@ahpd/server` imports
 * nothing that runs an agent. That claim was untrue once - `catalogue` reached
 * for the Claude SDK's session listing from inside the host - and it compiled,
 * because a hoisted `node_modules` resolves anything installed anywhere in the
 * workspace whether the package that imports it declares it or not.
 *
 * pnpm makes that hard to reintroduce and this makes it loud: read what each
 * package's sources import, read what its `package.json` declares, and report
 * the difference. Static, so it needs no install layout and cannot be fooled by
 * one - it is asking what the code says rather than what resolved today.
 *
 * `devDependencies` are deliberately not allowed: they are absent for anybody
 * who installs the package, so a `src/` importing one is a package that works
 * here and breaks there.
 */

const ROOT = new URL('..', import.meta.url).pathname;

/** Every `.ts` under a directory, recursively. */
const sources = (dir) => readdirSync(dir).flatMap((entry) => {
  const path = join(dir, entry);
  if (statSync(path).isDirectory()) return sources(path);
  return path.endsWith('.ts') ? [path] : [];
});

/**
 * The package a specifier names, or nothing when it names no package.
 *
 * Relative paths and `node:` builtins are not dependencies. A scoped specifier
 * carries two segments before any subpath, an unscoped one carries one.
 */
const packageOf = (specifier) => {
  if (specifier.startsWith('.') || specifier.startsWith('node:')) return undefined;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

/*
 * The four shapes an import takes, and no prose.
 *
 * Anchored to the start of a line and forbidden from crossing one, because the
 * first version of this matched the words `from` and `import` inside comments
 * and reported half a sentence as a package name. The multi-line form is caught
 * by its closing brace, which is what sits at the start of a line.
 */
const IMPORTS = [
  /(?:^|\n)[ \t]*(?:import|export)\s[^;\n]*?\bfrom\s*['"]([^'"\n]+)['"]/g,
  /(?:^|\n)[ \t]*\}\s*from\s*['"]([^'"\n]+)['"]/g,
  /(?:^|\n)[ \t]*import\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
];

let wrong = 0;
for (const name of readdirSync(join(ROOT, 'packages'))) {
  const dir = join(ROOT, 'packages', name);
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);

  const used = new Map();
  for (const file of sources(join(dir, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of IMPORTS) {
      for (const [, specifier] of text.matchAll(pattern)) {
        const owner = packageOf(specifier);
        if (owner !== undefined && !declared.has(owner)) {
          used.set(owner, [...(used.get(owner) ?? []), file.slice(ROOT.length)]);
        }
      }
    }
  }

  if (used.size === 0) {
    process.stdout.write(`${manifest.name}: ${String(declared.size)} declared, none undeclared\n`);
    continue;
  }
  wrong += used.size;
  for (const [owner, files] of used) {
    process.stdout.write(`${manifest.name}: imports ${owner}, which it does not declare\n`);
    for (const file of files) process.stdout.write(`  ${file}\n`);
  }
}

if (wrong > 0) {
  process.stdout.write('\nDeclare it, or move the code to the package that already does.\n');
  process.exit(1);
}
