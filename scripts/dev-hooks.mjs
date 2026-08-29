import { existsSync } from 'node:fs';

/**
 * Resolves the `.js` specifiers TypeScript source writes to the `.ts` on disk.
 *
 * Node strips types from a `.ts` file, but resolves what that file imports
 * literally - and `nodenext` source spells its own imports `./host.js`,
 * because that is what will be there after a build. So running the source
 * directly looks for a file that only exists once it has been compiled, which
 * is the one thing running the source directly is meant to avoid.
 *
 * Only relative specifiers from a TypeScript parent, and only when the `.ts`
 * is really there: a package that ships `.js` beside a same-named `.ts` should
 * still get its `.js`, and anything under `node_modules` is already built.
 */
export async function resolve(specifier, context, next) {
  const parent = context.parentURL ?? '';
  if (
    specifier.startsWith('.')
    && specifier.endsWith('.js')
    && (parent.endsWith('.ts') || parent.endsWith('.tsx'))
    && !parent.includes('/node_modules/')
  ) {
    const asTs = specifier.slice(0, -3);
    for (const ext of ['.ts', '.tsx']) {
      if (existsSync(new URL(asTs + ext, parent))) {
        return next(asTs + ext, context);
      }
    }
  }
  return next(specifier, context);
}
