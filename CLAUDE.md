# CLAUDE.md — LODESTAR project memory

LODESTAR is a desktop mining-intelligence companion for *Elite Dangerous*. **`LODESTAR_SSOT.md` is the law of this project** — read it first, every session. This file is the condensed orientation; the SSOT always wins on conflict.

## Hard constraints (Prime Directive — gate every decision)

1. **ToS three-zone model.** GREEN: read-only journal/API consumption + analysis/planning/display, no game input ever. YELLOW: one discrete, player-commanded keybind action per explicit voice command, player present and flying, guardrailed in code + tests. **RED — never build under any framing:** autonomous flight, screen-reading that drives controls, unattended synthetic input, AFK anything, any perception→control loop, chained/looped macros, auto-fire, route injection. All flying is delegated to the player + the game's own Supercruise Assist / Docking Computer. If a request smells RED, refuse and propose the compliant alternative.
2. **All AI/ML is local.** Zero cloud inference or training, ever. LLM = Ollama on the **AI GPU: RTX 3060, 12 GB, CUDA index 1** (`CUDA_DEVICE_ORDER=PCI_BUS_ID`, `CUDA_VISIBLE_DEVICES=1`, UUID-verified `GPU-5612e762…`). STT = faster-whisper (AI GPU, load-on-demand). TTS = Piper (CPU). ML + Bayesian calibration = local. The game runs on the RTX 5070 Ti (index 0) — never allocate on it. VRAM budget + load/unload policy: SSOT §8.2. The compliance suite must always fail if a cloud AI path appears.
3. **Privacy.** Wing/community/Discord sharing is opt-in (defaults OFF), anonymizable, revocable; external API data is cached, rate-limited, age-stamped in the UI.
4. **Clean-room originality.** Never copy code/data/assets from existing mining tools (incl. EliteMining).

## Operator's standing non-negotiables

- **No mocks, stubs, placeholders, FIXMEs, or TODOs in product code** (lint + CI enforced). Test doubles/recorded fixtures are allowed **only for external services** (EDSM, Spansh, Inara, EDDN, cAPI, Discord, Ollama, sidecars).
- **TDD for every step:** failing test first → implement → refactor. Coverage ≥90% line / ≥85% branch per package.
- **Adversarial review at every step** before commit: architecture + design + red-team passes over the diff (SSOT §4.8). Blocking findings are fixed first.
- **Every commit leaves the repo green** (build + lint + test + compliance).
- Repo: `https://github.com/R3AP3RW1LLY/lodestar` (public, AGPL-3.0-only).

## Stack & layout

Electron + React 18 + TS (strict) + Vite + Tailwind (cockpit-MFD theme: near-black, Elite-orange `#FF7100`, cyan) + Zustand + Framer Motion + react-three-fiber + Recharts. Node 24, pnpm workspaces + Turborepo, better-sqlite3 (WAL), Vitest + Playwright, pino logging. Python sidecars (pinned venvs, stdio JSON-RPC) for ML + STT.

- `apps/desktop` — Electron main/preload/renderer (wiring only)
- Dependency direction (checker-enforced, SSOT §3.2): `apps/desktop` → anything; feature pkgs (`ai`,`ml`,`voice`,`overlay`,`carrier`,`wing`,`community`,`integrations`) → `core`|`intelligence`|`data`|`shared`; `core` → `intelligence`|`data`|`shared`; `intelligence` and `data` → `shared` only. `intelligence` is pure (no I/O/DB/network/settings). **Firewall: `ai` must never import `voice` or reach the keybind bridge — the LLM can never acquire input capability (compliance-tested).**
- `packages/{core,data,intelligence,ai,ml,integrations,voice,overlay,carrier,wing,community,shared,compliance,scripts}`; `services/{wing-relay,community-api,ml-sidecar,stt-sidecar}`
- Three-layer AI: **Layer 1** `intelligence` (all numbers, pure + deterministic) · **Layer 2** `ai` (local Ollama, tools ARE Layer-1 functions — a frozen read-only tool allowlist, never does math) · **Layer 3** `ml` (local models + Bayesian calibration of Layer-1 weights; trains ONLY on journal/player-confirmed provenance, never community/seed data)

## Conventions

- TS: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; no `any`, no enums; `Result<T,E>` for fallible ops; files kebab-case.
- Commits: Conventional Commits referencing SSOT steps — `feat(assay): step 2.4 — mine/skip verdict engine`.
- All external HTTP through the egress gateway (allowlist SSOT §5.4: manual redirects with per-hop re-check; loopback = literal `127.0.0.0/8`/`::1` only; install-time artifacts via the separate downloader with in-repo SHA-256 pins); direct `fetch`/socket APIs outside the sanctioned modules are lint-banned. Secrets via Electron `safeStorage` (refuse, never plaintext-fallback) + gitignored `.env`; never in repo, logs, or SQLite plaintext.
- SQLite migrations: forward-only, in `packages/data`; numbers 001–013 are pre-assigned in SSOT §5.5. DDL truth lives in migrations; SSOT §5.5 is the registry.
- Fixtures: the repo history is treated as public from commit #1 — synthetic-first; real captures only via the allowlist scrubber with PII-absence tests (SSOT Step 1.1).

## Session Protocol (STAGE 2 loop — follow exactly; full text SSOT §10)

1. **Orient:** read the SSOT; find the lowest step not `[x] DONE`.
2. **Confirm scope:** state the step + acceptance criteria; ask if ambiguous or the phase isn't operator-approved.
3. **Compliance gate:** SSOT §2.4 checklist. RED-adjacent → stop, propose compliant alternative.
4. **Test first** (failing for the right reason) → 5. **Implement only that step** → 6. **Verify** with the step's exact "Verify by" + `pnpm lint && pnpm test && pnpm compliance`.
7. **Adversarial review** (architecture/design/red-team) → fix blockers.
8. **Update SSOT:** mark `[x] DONE`, edit diverged steps, append §11 changelog line.
9. **Commit + PR** (`main` is PR-gated — no direct pushes): branch `feat/step-X.Y-<slug>` → Conventional Commit referencing the step → push → open PR → wait for all 5 CI checks green → self-merge → delete branch.
10. **Phase gate:** run the Phase Definition of Done, whole-phase review, summarize, **pause for operator approval**.

Never build ahead of the current step. Never let the SSOT drift from the code. At phase gates, wait for the operator.
