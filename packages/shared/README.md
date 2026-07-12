# @lodestar/shared

Shared TypeScript primitives: domain types, branded units (tons, credits, ly), Result/error types, logger interface, IPC channel contracts. Zero runtime dependencies.

Exposed as source (`exports` → `./src/index.ts`); consumers bundle or test against the TypeScript directly — nothing is emitted. Current contents: `APP_VERSION` (Step 0.1); Result/units/errors/logging/channels primitives arrive in Step 0.2. See [LODESTAR_SSOT.md](../../LODESTAR_SSOT.md).
