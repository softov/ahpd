import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/*
 * The packages, as their source rather than their build.
 *
 * `@ahpd/agent-claude` imports `@ahpd/sdk` the way anything else would, and
 * that specifier resolves through the package's `exports` to `dist` - which is
 * a test suite that passes against whatever was last built rather than against
 * what is written. These three aliases are the same mapping `tsconfig.json`
 * makes with `paths`, so the checker and the runner agree.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@ahpd/sdk': fileURLToPath(new URL('./packages/sdk/src/index.ts', import.meta.url)),
      '@ahpd/agent-claude': fileURLToPath(new URL('./packages/agent-claude/src/index.ts', import.meta.url)),
      '@ahpd/agent-cofold': fileURLToPath(new URL('./packages/agent-cofold/src/index.ts', import.meta.url)),
      '@ahpd/agent-acp': fileURLToPath(new URL('./packages/agent-acp/src/index.ts', import.meta.url)),
      '@ahpd/agent-pi': fileURLToPath(new URL('./packages/agent-pi/src/index.ts', import.meta.url)),
    },
  },
  test: {
    globalSetup: ['./tools/test-tmpdir.ts'],
    /*
     * cofold's packages, through this runner rather than node's own loader.
     *
     * An externalized dependency keeps node's module cache, which `vi.resetModules()`
     * cannot clear, so a fresh module load would hand back the same instance and
     * the same process-wide state. A case that restarts a cofold run needs a
     * second copy of that state, and only a module this runner owns can be
     * reset. The packages are built `dist`, so inlining costs a transform.
     */
    server: { deps: { inline: [/@cofold\//] } },
  },
});
