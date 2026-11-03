import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored minified opus-recorder encoder worker (served statically).
    "public/opus/**",
    // Netlify adapter build output (functions, edge functions, bundled
    // static assets). Generated on every deploy, never hand-edited.
    ".netlify/**",
  ]),

  // The Chrome extension. Plain browser JavaScript, not Next.js and
  // not TypeScript, so the shared config matches none of it and it
  // was going unlinted — which is the wrong state for code that runs
  // inside someone else's browser on web.whatsapp.com.
  //
  // Declaring the globals rather than switching on a whole browser
  // env: `chrome` is the one API surface that matters here, and
  // spelling it out means a typo like `chrom.storage` is still an
  // error instead of being waved through by a broad env.
  {
    files: ["extension/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        chrome: "readonly",
        console: "readonly",
        document: "readonly",
        fetch: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        window: "readonly",
        URL: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": "warn",
    },
  },
]);

export default eslintConfig;
