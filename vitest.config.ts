import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      // The Chrome extension ships separately but its riskiest logic —
      // working out which chat is open from someone else's DOM — runs
      // in the same test command as everything else.
      "extension/**/*.test.js",
      // RLS and SECURITY DEFINER functions, run on the real migrations
      // in PGlite (Postgres in WASM) — see supabase/tests/harness.ts.
      "supabase/tests/**/*.test.ts",
    ],
    // Dummy secrets — encryption.ts / webhook-signature.ts read these
    // at module load. Tests never hit a real Meta/Supabase service, so
    // any 32-byte hex / non-empty string will do; keep them lexically
    // identical to the CI build env so behaviour matches.
    env: {
      ENCRYPTION_KEY:
        "0000000000000000000000000000000000000000000000000000000000000000",
      META_APP_SECRET: "test-meta-app-secret",
    },
    clearMocks: true,
    // supabase/tests build a database from every migration in a
    // beforeAll; with all test files running in parallel that can take
    // longer than the 10s default on a busy machine.
    hookTimeout: 30_000,
  },
});
