import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/*
 * The packages, as their source rather than their build.
 *
 * `@ahpd/agent-claude` imports `@ahpd/sdk` the way anything else would, and
 * that specifier resolves through the package's `exports` to `dist` - which is
 * a test suite that passes against whatever was last built rather than against
 * what is written. These two aliases are the same mapping `tsconfig.json`
 * makes with `paths`, so the checker and the runner agree.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@ahpd/sdk': fileURLToPath(new URL('./packages/sdk/src/index.ts', import.meta.url)),
      '@ahpd/agent-claude': fileURLToPath(new URL('./packages/agent-claude/src/index.ts', import.meta.url)),
    },
  },
});
