// LODESTAR lint wall (SSOT §4.1 / Step 0.3). Scope: product source under
// src/. Type-aware strict rules; no `any`, no non-null assertions outside
// tests, no enums. Prettier disables stylistic conflicts.
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import react from "eslint-plugin-react";
import jsxA11y from "eslint-plugin-jsx-a11y";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/build/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/test/fixtures/**",
    ],
  },
  // Stale disable directives are an error everywhere (a disable that no longer
  // suppresses anything is dead weight hiding a bypass).
  { linterOptions: { reportUnusedDisableDirectives: "error" } },
  {
    files: [
      "packages/*/src/**/*.{ts,tsx}",
      "apps/*/src/**/*.{ts,tsx}",
      "services/*/src/**/*.{ts,tsx}",
    ],
    extends: [...tseslint.configs.strictTypeChecked],
    plugins: { "@eslint-community/eslint-comments": eslintComments },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSEnumDeclaration",
          message: "Use union types instead of enums (SSOT §4.1).",
        },
      ],
      // Every rule suppression must carry a `-- reason` and target specific
      // rules; blanket `eslint-disable` is banned. Keeps the wall auditable.
      "@eslint-community/eslint-comments/require-description": ["error", { ignore: [] }],
      "@eslint-community/eslint-comments/no-unlimited-disable": "error",
      "@eslint-community/eslint-comments/no-aggregating-enable": "error",
    },
  },
  {
    files: ["**/*.tsx"],
    ...react.configs.flat.recommended,
    // Explicit version — plugin's auto-detect crashes under ESLint 10.
    settings: { react: { version: "19.2" } },
  },
  {
    files: ["**/*.tsx"],
    ...jsxA11y.flatConfigs.recommended,
  },
  {
    files: ["**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      // The new JSX transform needs no React import.
      "react/react-in-jsx-scope": "off",
    },
  },
  {
    // Renderer code runs sandboxed with no Node — banning node globals here
    // turns "process is not defined" runtime crashes into lint errors.
    files: ["apps/*/src/renderer/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "process", message: "The renderer has no Node runtime (sandboxed)." },
        { name: "require", message: "The renderer has no Node runtime (sandboxed)." },
        { name: "__dirname", message: "The renderer has no Node runtime (sandboxed)." },
        { name: "Buffer", message: "The renderer has no Node runtime (sandboxed)." },
        { name: "global", message: "The renderer has no Node runtime (sandboxed)." },
      ],
    },
  },
  {
    // Egress firewall (SSOT §5.4 / Step 0.10): raw network APIs are banned in
    // product code. All HTTP goes through the egress gateway; the sanctioned
    // exceptions (the gateway itself, the artifact downloader, and — when they
    // land — the EDDN listener, wing relay client, and loopback Ollama client)
    // are re-permitted in the block below. Test files are exempt (test doubles).
    files: ["packages/*/src/**/*.ts", "apps/*/src/**/*.{ts,tsx}", "services/*/src/**/*.ts"],
    ignores: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message: "Route HTTP through the egress gateway (@lodestar/integrations), not raw fetch.",
        },
        { name: "XMLHttpRequest", message: "Route HTTP through the egress gateway, not XHR." },
        {
          name: "WebSocket",
          message: "WebSocket to non-loopback is banned outside sanctioned modules (SSOT §5.4).",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "node:net",
              message: "Raw sockets are banned outside sanctioned egress modules (SSOT §5.4).",
            },
            {
              name: "node:tls",
              message: "Raw TLS is banned outside sanctioned egress modules (SSOT §5.4).",
            },
            {
              name: "node:dgram",
              message: "Raw UDP is banned outside sanctioned egress modules (SSOT §5.4).",
            },
            { name: "node:http", message: "Use the egress gateway, not node:http." },
            { name: "node:https", message: "Use the egress gateway, not node:https." },
            { name: "axios", message: "Use the egress gateway, not axios." },
            { name: "undici", message: "Use the egress gateway, not undici." },
            { name: "node-fetch", message: "Use the egress gateway, not node-fetch." },
          ],
        },
      ],
      // eval/Function-constructor can conjure fetch dynamically; ban both.
      "no-eval": "error",
      "no-implied-eval": "error",
      // Close the member-access + dynamic-import bypasses that no-restricted-*
      // globals/imports miss (globalThis.fetch, window.fetch, import("axios")).
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSEnumDeclaration",
          message: "Use union types instead of enums (SSOT §4.1).",
        },
        {
          selector:
            "MemberExpression[property.name='fetch'], MemberExpression[property.value='fetch']",
          message:
            "Route HTTP through the egress gateway, not fetch (incl. globalThis/window.fetch).",
        },
        {
          selector: "MemberExpression[object.name='globalThis'][property.name='WebSocket']",
          message: "WebSocket is banned outside sanctioned egress modules (SSOT §5.4).",
        },
        {
          selector:
            "ImportExpression > Literal[value=/^(axios|undici|node-fetch|node:(net|tls|dgram|http|https))$/]",
          message: "Dynamic import of a network module is banned outside the gateway (SSOT §5.4).",
        },
        {
          selector:
            "CallExpression[callee.name='require'] > Literal[value=/^(axios|undici|node-fetch|node:(net|tls|dgram|http|https))$/]",
          message: "require() of a network module is banned outside the gateway (SSOT §5.4).",
        },
      ],
    },
  },
  {
    // Sanctioned egress modules: the gateway core and the artifact downloader
    // legitimately touch fetch/sockets. (EDDN/wing/Ollama modules get added
    // here when they land in later phases.)
    files: [
      "packages/integrations/src/gateway/**/*.ts",
      "packages/integrations/src/downloader/**/*.ts",
    ],
    rules: {
      "no-restricted-globals": "off",
      "no-restricted-imports": "off",
    },
  },
  {
    // Sanctioned LOOPBACK WebSocket client (SSOT §5.4/§5.6, Step 2.10): the overlay
    // connects ONLY to our own 127.0.0.1 push server, token-authenticated. Re-permit
    // just the `WebSocket` global here — fetch/XHR and raw node sockets stay banned.
    files: ["packages/overlay/src/ws/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message: "Route HTTP through the egress gateway (@lodestar/integrations), not raw fetch.",
        },
        { name: "XMLHttpRequest", message: "Route HTTP through the egress gateway, not XHR." },
      ],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-type-assertion": "off",
    },
  },
  prettier,
);
