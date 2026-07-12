# LODESTAR — SINGLE SOURCE OF TRUTH (SSOT)

> **This document is the law of the project.** Every session orients from it, every step is tracked in it, and it must never drift from the code. How to update it is defined in §4.7. The build loop that consumes it is defined in §10 (Session Protocol).

**Status markers used throughout:** `[ ] TODO` · `[~] IN PROGRESS` · `[x] DONE`
*(These markers are project tracking inside this document only. The codebase itself never contains TODO/FIXME comments, stubs, mocks-as-product-code, or placeholder implementations — see §4.1.)*

---

## 1. PROJECT CHARTER

**Name:** LODESTAR — *Mining Command Intelligence for Elite Dangerous.* ("lode" = ore vein; "lodestar" = guiding star.)

**One-liner:** LODESTAR does all the *thinking* of a mining operation — finding the richest hotspots, pricing the galaxy, planning the run, judging every prospected rock in real time — and coaches the Commander through the flying, getting as close to an autonomous mining bot as is possible without ever crossing Frontier's ToS.

### 1.1 The Assisted Loop (the product's core workflow)

Docked → the Commander asks the AI for a plan → LODESTAR ranks hotspots, prices sell stations, and returns a full round-trip plan → the player enters the route and flies out using the game's **Supercruise Assist** → drops into the ring → fires prospectors while **Assay** calls MINE/SKIP in real time → mines the good rocks while **Manifest** tracks tons/hr and cargo % → cargo full, player uses **Supercruise Assist + Docking Computer** to reach and dock at the best sell station LODESTAR identified → sells → LODESTAR logs the run and queues the next. The human's only manual burden is initiating each phase and doing the mining itself.

### 1.2 THE PRIME DIRECTIVE — HARD CONSTRAINTS (restated verbatim; these gate every decision)

These constraints are absolute. If any task would violate one, the task is refused and a compliant alternative proposed.

#### 1.2.1 Elite Dangerous Terms of Service — the Three-Zone Model

Frontier's EULA prohibits automation/bot software that plays the game for the player or grants an unfair advantage. LODESTAR is **not a bot** and must never become one. Every feature falls into exactly one zone:

- **GREEN ZONE (build freely):** Read-only consumption of game data + external APIs, plus all analysis, scoring, planning, prediction, and display. **No game input of any kind.** This is standard journal-reading tooling.
- **YELLOW ZONE (build with guardrails):** Player-in-the-loop assistance only — a **single, discrete, player-commanded keybind action** (VoiceAttack-class), e.g. saying "mining mode" fires one bound sequence. The player must be present and flying. **No chained/autonomous loops, no auto-firing of weapons or lasers, no navigation or flight control.**
- **RED ZONE (NEVER build, under any framing):** Autonomous flight; computer-vision/screen-reading that drives ship controls; synthetic input that mines, flies, docks, or sells unattended; AFK farming; any closed perception→control loop.

**All actual flying is delegated to the game's own official modules** (Supercruise Assist, Docking Computer). LODESTAR plans and coaches; the human and the game's autopilot fly. Do not implement route *injection* into the game — present routes for the player to enter.

#### 1.2.2 All AI/ML runs locally on the dedicated AI GPU — never in the cloud

- **Zero cloud inference.** No OpenAI/Anthropic/hosted-model calls for any LODESTAR AI or ML feature. Everything runs on the local dedicated NVIDIA AI GPU.
- **LLM:** Ollama, pinned to the AI GPU via `CUDA_VISIBLE_DEVICES` (device index confirmed with `nvidia-smi`). Default model: a Q4_K_M-quantized 7–8B instruct model (e.g. Qwen2.5-7B-Instruct or Llama-3.1-8B-Instruct), ~5 GB VRAM.
- **Speech-to-text (Yellow Zone only):** faster-whisper (small/base), local on the AI GPU, loaded only while voice is active.
- **Text-to-speech:** Piper, on CPU (no VRAM cost).
- **Classical ML** (yield predictor, prospector classifier) and the **Bayesian calibration loop**: trained and inferred locally on the AI GPU. No data leaves the machine for training.
- **The game runs on the separate RTX 5070 Ti** — set via Windows Graphics settings / NVIDIA Control Panel per-app. LODESTAR's AI must never contend for the 5070 Ti.
- **VRAM budgeting** on the AI GPU is shared between Ollama and Whisper — §8 defines the budget and load/unload strategy (`keep_alive`, unload Whisper when idle).

> **HARDWARE ERRATUM (2026-07-12, operator-approved):** The build prompt named an "RTX 3060 Ti (8 GB)". The machine's actual AI GPU is an **NVIDIA GeForce RTX 3060, 12,288 MiB VRAM, CUDA index 1 under `CUDA_DEVICE_ORDER=PCI_BUS_ID`** (UUID `GPU-5612e762-42fc-f272-2350-a477ed53878d`, verified via `nvidia-smi` on 2026-07-12). Every reference to "3060 Ti" in the source prompt binds to this card. The game GPU is the RTX 5070 Ti (16 GB, CUDA index 0). The VRAM budget in §8 is written against the real 12 GB.

#### 1.2.3 Privacy & data provenance

- Wing sharing and community hotspot contributions are **strictly opt-in** and support anonymization (no CMDR name / location shared without consent).
- Cache all external API data locally, honor each service's rate limits and terms, and surface data-age indicators in the UI.

#### 1.2.4 Originality

- LODESTAR is a **clean-room** design inspired by the *category* of mining companion tools. Do **not** copy code from any existing project (including EliteMining). Build from first principles.

### 1.3 Operator's standing non-negotiables (2026-07-12)

1. **100% build** — every phase completes; every commit leaves the repo green (build + tests + lint pass).
2. **No mocks, stubs, placeholders, FIXMEs, or TODOs in product code.** Every step lands fully working, tested code. *Clarified scope (operator-approved):* test suites MAY use recorded real fixtures, local fake servers, and test doubles **for external services only** (Spansh, EDSM, Inara, EDDN, cAPI, Discord, Ollama); product features are never stubbed or faked.
3. **TDD-driven:** tests are written before implementation for every step (red → green → refactor).
4. **Adversarial review at every step:** each step's output is reviewed by independent architecture, design, and red-team reviewers before its commit; findings are fixed first (§4.8).
5. **Lives at** `https://github.com/R3AP3RW1LLY/lodestar` (private, AGPL-3.0-only).

---

## 2. COMPLIANCE & GUARDRAILS

### 2.1 Zone table

| Zone | Definition | LODESTAR examples | Input to game? |
| --- | --- | --- | --- |
| **GREEN** | Read-only data consumption, analysis, planning, display | Journal watcher, Assay verdicts, Vein Finder, Ledger, Cartographer, Manifest, Outfitter, Commander's Assistant, ML/calibration, carrier planning, wing telemetry, community sharing, Discord debriefs, **read-only Overlay, Smart Alerts (display + TTS)** | **Never** |
| **YELLOW** | Player-in-the-loop, single discrete player-commanded action; player present and flying | Ops voice→keybind bridge (one bound action per utterance) — the only Yellow feature | One discrete keybind per explicit player command |
| **RED** | Autonomy of any kind | — never built — | Forbidden |

### 2.2 The "we do NOT build" list (explicit, non-exhaustive)

1. Autonomous flight, navigation, docking, or undocking of any kind.
2. Computer-vision or screen-reading that feeds ship controls (any perception→control loop).
3. Synthetic input that mines, flies, docks, sells, or travels unattended.
4. AFK farming, scheduling of unattended play, or "resume mining while away."
5. Chained/looped/conditional keybind macros; auto-fire of any weapon, mining laser, or launcher.
6. Route injection into the game (clipboard-assist for the player's own manual paste is allowed; direct game-state manipulation is not).
7. Reading or writing game process memory; injecting DLLs; patching game files.
8. Any cloud AI/ML inference or training, under any framing (including "just this once" fallbacks).
9. Circumvention of any external API's rate limits, auth, or terms.
10. Sharing any player-identifying data without explicit, revocable, opt-in consent.

### 2.3 Flight delegation rule

All actual flying is performed by the player using the game's own official modules — **Supercruise Assist** and **Docking Computer**. LODESTAR presents plans, routes, and callouts for the player to act on. The player enters routes into the galaxy map themselves. **Engaging any game assist/autopilot module is a player-only action:** the Supercruise Assist toggle, Docking Computer engage, and any autopilot/route-following bind are permanently classified FORBIDDEN for the voice bridge (Step 7.2) — LODESTAR initiating autonomous flight via a "single keybind" would still be LODESTAR initiating autonomous flight.

**Interpretation of record for §1.2.1's "fires one bound sequence":** one spoken command maps to **exactly one game action = one keypress/chord**. No phrase may ever map to more than one keystroke; multi-step "sequences" are chained macros and are RED (§2.2.5).

### 2.4 Compliance checklist (every new feature/step must pass)

- [ ] **Zone declared.** The step states GREEN or YELLOW. RED is auto-refused.
- [ ] **No game input** (GREEN), or exactly one discrete, player-commanded, non-chainable keybind action (YELLOW).
- [ ] **No perception→control loop:** no output of this feature feeds synthetic input without a fresh, explicit human command in between.
- [ ] **Player presence:** YELLOW features verify player presence (recent explicit arm + in-cockpit status) before emitting anything.
- [ ] **Local AI only:** no new network dependency for inference/training; egress allowlist (§5.4) unchanged or consciously extended with justification — never with an AI/ML host.
- [ ] **Privacy:** any new outbound data is opt-in, anonymizable, and documented in the consent panel.
- [ ] **Provenance:** external data is cached, rate-limited, and age-stamped in the UI.
- [ ] **Originality:** no code, assets, or data files copied from existing mining tools.

A step that cannot check every box does not ship. If a requested capability fails this checklist, the request is refused and the nearest compliant alternative is proposed (per §10).

---

## 3. ARCHITECTURE REFERENCE

### 3.1 Stack

| Concern | Choice |
| --- | --- |
| Shell | Electron (electron-builder, electron-updater), `contextIsolation: true`, no `nodeIntegration` in renderers |
| UI | React 18 + TypeScript + Vite; Tailwind CSS; Framer Motion; Zustand; react-three-fiber/Three.js (3D ring map); Recharts (analytics) |
| Core service | Node 24 + TypeScript in the Electron main process; journal watcher (chokidar for rotation/live files, **polling tailer for the active journal** — see Step 1.3); typed event bus; better-sqlite3 (WAL mode); IPC via contextBridge + a localhost-only WebSocket server (app main, Step 1.9) for overlay/aux windows; single-instance lock (Step 0.4); pino logger with rotation (Step 0.4); shared sidecar supervisor (Step 2.7) owning Piper/ML/STT lifecycles + shutdown ordering |
| AI Layer 1 | `@lodestar/intelligence` — pure, deterministic TypeScript. All numbers computed here. |
| AI Layer 2 | `@lodestar/ai` — Ollama over `http://127.0.0.1:11434`, tool/function-calling; tools ARE Layer-1 functions |
| AI Layer 3 | `@lodestar/ml` — Python sidecar (pinned venv; PyTorch CUDA on the AI GPU) spoken to over stdio JSON-RPC; Bayesian calibration in TypeScript (closed-form, CPU) |
| Voice | faster-whisper (Python sidecar, AI GPU, load-on-demand); Piper TTS (CPU sidecar binary) |
| Persistence | SQLite file per profile under `%APPDATA%/lodestar/`; migrations via a versioned migration runner in `@lodestar/data` |
| Monorepo | pnpm workspaces + Turborepo |

**Visual theme:** cockpit-MFD aesthetic — near-black panels, Elite-orange primary (`#FF7100` family), cyan accents, angular clip-path panels, subtle scanlines/glow, sound cues.

### 3.2 Monorepo map

| Package | Purpose (one line) |
| --- | --- |
| `apps/desktop` | Electron main/preload + React renderer; window management (Command Deck, Overlay); wiring only, no domain logic |
| `packages/shared` | Domain types, branded units (tons, credits, ly, %), `Result<T,E>` error primitives, logger interface; zero runtime deps |
| `packages/core` | Journal watcher + JSONL tailer, live-file parsers, typed event bus, domain state reducers, session tracker, SQLite access, IPC/WS bridge |
| `packages/data` | SQLite schema + migration runner, bundled hotspot seed dataset + provenance, data-age utilities |
| `packages/intelligence` | Layer 1: hotspot scoring, overlap detection, market/sell optimization, run planner, loadout advisor — pure functions, exhaustively unit-tested |
| `packages/ai` | Layer 2: Ollama client (GPU-pinned), tool registry mapping Layer-1 functions, chat orchestration, debrief writer |
| `packages/ml` | Layer 3: yield predictor + prospector classifier (Python sidecar contract + TS client), Bayesian calibration loop, local model registry |
| `packages/integrations` | EDSM/Spansh/Inara clients, EDDN listener, cAPI OAuth PKCE, Discord webhook — all through the egress-allowlisted HTTP gateway with caching + rate limiting |
| `packages/voice` | STT/TTS sidecar contracts + the guardrailed voice→keybind bridge (Yellow Zone, §7) |
| `packages/overlay` | Overlay window contents (read-only HUD components) |
| `packages/carrier` | Carrier state tracking, Tritium fuel math, expedition planner, cargo-transfer ledger |
| `packages/wing` | Wing relay client, shared-session state, consent/anonymization |
| `packages/community` | Community hotspot submission/sync client, validation, anonymization |
| `services/wing-relay` | Self-hostable WebSocket relay for wing telemetry (Phase 9) |
| `services/community-api` | Self-hostable community hotspot endpoint with server-side validation (Phase 10) |
| `services/ml-sidecar` | Python (pinned venv): yield predictor + prospect classifier training/inference on the AI GPU (Phase 6) |
| `services/stt-sidecar` | Python (pinned venv): faster-whisper STT on the AI GPU, load-on-demand (Phase 7) |
| `packages/compliance` | The compliance test suite — banned patterns, egress, guardrail red-team tests (`turbo run compliance`, uncached) |
| `packages/scripts` | Repo tooling: banned-pattern checker, dependency-direction checker, journal scrubber (each with its own tests) |

**Dependency direction (enforced by the Step 0.3 checker; every package above is classified):**
- `apps/desktop` → may import any package (it is wiring).
- Feature packages (`ai`, `ml`, `voice`, `overlay`, `carrier`, `wing`, `community`, `integrations`) → may import `core`, `intelligence`, `data`, `shared`.
- `core` → may import `intelligence`, `data`, `shared` (core composes pure intelligence with I/O and persistence).
- `data` → `shared` only. `intelligence` → `shared` only (**pure — no I/O, no DB, no settings, no network**).
- Nothing imports `apps/desktop`. Nothing imports `ai` except `apps/desktop` and `community` (debrief consumer).
- **Firewall (compliance-tested, not just linted): `ai` must never import `voice` or reach the keybind bridge/emitter by any path** — the LLM can never acquire an input capability. The bridge/emitter may be imported only by `apps/desktop` main.

### 3.3 Three-layer AI

- **Layer 1 — Deterministic Intelligence Engine (`intelligence`):** every number the product shows is computed here by pure, tested functions. Reference score shape: `price × overlap_multiplier × reserve_weight × ring_match − distance_penalty − sell_leg_penalty` (weights owned by the calibration loop, §8.5). Zero hallucination: Layer 2 is *forbidden by construction* from producing numeric claims that don't come from a tool result.
- **Layer 2 — Commander's Assistant (`ai`):** a local instruct model (Ollama) with tool-calling whose tools ARE Layer-1 functions: `find_hotspots`, `plan_run`, `best_sell_station`, `analyze_session`, `query_history`, `get_personal_bests`, `get_price_trends`, `recommend_loadout`, `get_status` (ship/session), `plan_carrier_expedition`, `get_carrier_status`, `get_wing_board`. It translates natural language → tool calls → narrates, plans multi-step, writes debriefs. Never does raw math or controls anything. **Every registered tool is read-only/compute-only — a frozen allowlist test (Step 5.3) fails if any tool with side effects is ever registered.**
- **Layer 3 — Local ML (`ml`):** yield predictor (ring type + reserve + history → expected tons/hr), prospector "worth-it" classifier, and the Bayesian yield-calibration loop that retunes Layer-1 weights from estimate-vs-actual run outcomes. Trained + inferred locally (§8).

### 3.4 Local AI/ML + GPU strategy

- **AI GPU:** NVIDIA RTX 3060, 12,288 MiB, **CUDA index 1** under `CUDA_DEVICE_ORDER=PCI_BUS_ID` (UUID `GPU-5612e762…` — sidecars verify by UUID at startup, not index alone, and refuse to start on the wrong card).
- **Game GPU:** RTX 5070 Ti (index 0) — the game is bound to it via Windows Graphics settings; LODESTAR never allocates on it. The onboarding wizard (Phase 11) checks and explains this.
- **Pinning:** by **UUID, not index** — `CUDA_VISIBLE_DEVICES=GPU-5612e762-42fc-f272-2350-a477ed53878d` (with `CUDA_DEVICE_ORDER=PCI_BUS_ID` as belt-and-braces); UUIDs survive driver/BIOS reordering. LODESTAR cannot inject env into an already-running Ollama tray service, so Step 5.1 is detect → validate → instruct: it verifies where Ollama actually allocates and walks the user through setting the user-level env + restarting Ollama if wrong (spawning its own `ollama serve` only when nothing owns port 11434). Sidecars set the env themselves and assert the visible device's UUID at startup.
- **VRAM budget and load/unload policy:** §8.2. Headline: LLM (~6.2 GiB incl. KV cache) + Whisper small int8 (~0.9 GiB) fit concurrently in 12 GiB with ≥4 GiB headroom; Whisper still unloads after 60 s idle and the LLM honors `keep_alive` so the card returns to near-zero when LODESTAR is quiet.
- **No cloud, enforced:** all HTTP flows through one gateway with a compile-time + runtime host allowlist; a CI compliance test fails if any AI/ML package gains a non-localhost network path (§5.4, Steps 0.10–0.11, 5.7).

---

## 4. GLOBAL CONVENTIONS

### 4.1 Code standards

- **TypeScript:** `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. No `any` (lint error), no non-null assertions outside tests, no `enum` (use union types).
- **No stubs/placeholders/TODOs in product code.** Banned in committed code: `TODO`, `FIXME`, `XXX`, `HACK`, `stub`, `placeholder`, `not implemented`, `throw new Error("unimplemented")`. Enforced by a lint rule + CI grep (Step 0.11). Every function committed is fully implemented and tested.
- **Errors:** fallible operations return `Result<T, DomainError>` from `@lodestar/shared`; exceptions only at process boundaries. Every `DomainError` has a stable `code`, human message, and cause chain.
- **Logging:** structured JSON logger (pino + `pino-roll` rotation — implemented in Step 0.4, interface in `shared`) to local rotating files under `%APPDATA%/lodestar/logs/`; levels trace→fatal; pino redaction paths configured for secrets so no log line ever contains API keys, tokens, webhook URLs, WS tokens, or (unless sharing is opted-in) CMDR-identifying data. Logs never leave the machine.
- **Naming:** files kebab-case; types PascalCase; functions/vars camelCase; module-level data constants SCREAMING_SNAKE_CASE (singleton *instances* like `nullLogger` stay camelCase); DB tables snake_case; events `Domain.PastTenseVerb` (e.g. `Prospector.RockJudged`).

### 4.2 Testing strategy (TDD is mandatory)

- **Red → green → refactor for every step.** The failing test is written and run first; the implementation makes it pass; refactor keeps it green. Commits within a step may be squashed, but the step's final commit contains both tests and implementation.
- **Levels:**
  - *Unit* (Vitest): pure logic, parsers, reducers, scoring. Target **≥90% line / ≥85% branch coverage** per `packages/*`, enforced in CI per package.
  - *Integration* (Vitest): tailer against real journal fixture files (including rotation/partial-write simulations), SQLite against a real temp DB, API clients against local fake servers replaying **recorded real payloads**, Ollama client against a local fake implementing the Ollama HTTP contract.
  - *E2E smoke* (Playwright for Electron): app boots, core screens render, IPC round-trips — run in CI on Windows.
  - *Compliance suite* (`turbo run compliance`): the red-team tests — egress allowlist, no-cloud guard, keybind-bridge guardrails, consent gating. **Failing compliance blocks every merge.**
- **Test doubles policy (operator-approved):** doubles/fakes/recorded fixtures are allowed **only** for external services (EDSM, Spansh, Inara, EDDN, cAPI, Discord, Ollama, sidecars) and hardware-bound seams. Product code is never stubbed. Live integration tests against real services exist behind an opt-in env flag (`LODESTAR_LIVE_TESTS=1`) and are excluded from CI.
- **Hardware/UI-bound verification:** where automation is impossible (TTS audio quality, overlay over the real game, GPU pinning under load), the step defines a scripted **manual verification** with exact commands and expected observations, recorded in the SSOT changelog when performed.

### 4.3 Commits

Conventional Commits, referencing the SSOT step: `feat(assay): step 2.4 — mine/skip verdict engine`. Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`, `perf`. One step = at least one commit; never commit a red build. Secrets never enter the repo (`.env` + OS keychain via Electron `safeStorage`; `.gitignore` enforced).

### 4.4 SSOT update rules

- A step moves `[ ] TODO` → `[~] IN PROGRESS` when work starts, → `[x] DONE` only after its **Verify by** has been executed and passed and the adversarial review (§4.8) is clean.
- Every completed step appends a dated line to §11 (Changelog): `YYYY-MM-DD — Step X.Y done — <one-line note; any divergence from plan>`.
- If reality diverges from the plan, the affected steps are **edited** (with a changelog note) rather than letting the SSOT go stale. Scope changes to hard constraints require operator approval; step-level tactical changes do not.

### 4.5 Definition of Done (global, applies to every step)

A step is done only when: it meets its acceptance criteria; its tests were written first and pass; overall coverage targets hold; it introduces no cloud AI/ML calls and passes the compliance suite; it passes the §2.4 checklist; the adversarial review found no unresolved blocking findings; the SSOT is updated; and the change is committed (and pushed).

### 4.6 Secrets & config

Runtime config lives in `%APPDATA%/lodestar/config.json` (non-secret) + Electron `safeStorage`-encrypted store (API keys, tokens, webhook URLs). Repo carries `.env.example` documenting every variable with dummy values only.

### 4.7 SSOT self-maintenance

This file is edited only via the Session Protocol (§10). Sections 1–3 (charter/compliance/architecture) change only with operator approval. Sections 5–9 evolve with the build. §11 Changelog is append-only.

### 4.8 Adversarial review protocol (every step, non-negotiable)

Before a step's commit, three independent reviews run against the step's diff + relevant SSOT section:

1. **Architecture review:** dependency direction, package boundaries, coupling, performance characteristics, failure modes.
2. **Design review:** API/UX shape, naming, domain-model fidelity to Elite Dangerous mechanics, test quality (do the tests actually pin behavior?).
3. **Red-team review:** ToS zones (§2), egress/no-cloud, privacy/consent, secrets handling, injection/abuse surfaces (prompt injection via journal strings, malicious relay peers, hostile community data), guardrail bypasses.

Findings are classified BLOCKING (must fix before commit) or NOTE (fix or record in §9). A phase additionally gets a whole-phase review pass at its gate.

---

## 5. DATA CONTRACTS

### 5.1 Journal events consumed (field shapes)

Journal files: `%USERPROFILE%\Saved Games\Frontier Developments\Elite Dangerous\Journal.*.log` — JSON Lines, UTF-8, rotated per session/size. All events carry `timestamp` (ISO 8601) and `event`. Shapes below list the fields LODESTAR consumes; parsers are tolerant of extra fields and versioned per journal schema drift.

| Event | Consumed fields | Used by |
| --- | --- | --- |
| `ProspectedAsteroid` | `Materials[{Name, Proportion}]`, `Content` (`$AsteroidMaterialContent_{Low,Medium,High};`), `MotherlodeMaterial?`, `Remaining` (0–100) — **journals carry no asteroid identity; each event is an independent observation** | Assay, ML |
| `AsteroidCracked` | `Body` | Assay (deep-core), Manifest |
| `MiningRefined` | `Type`/`Type_Localised` | Session tracker, Manifest |
| `LaunchDrone` | `Type` (`Prospector`/`Collection`/…) | Limpet efficiency |
| `SAASignalsFound` | `BodyName` (ring identity = the `"… A Ring"` suffix — there is no `Ring` field), `SystemAddress`, `BodyID`, `Signals[{Type, Count}]` — **also fires for planetary bio/geo signals (`$SAA_SignalType_…;`, `Genuses[]`); non-mineral signal types must be filtered out** | Hotspot DB, community sharing |
| `Scan` | `BodyName`, `BodyID`, `SystemAddress`, `ReserveLevel?` (`PristineResources`…`DepletedResources`), `Rings?[{Name, RingClass, MassMT, InnerRad, OuterRad}]` — note the game's own misspelling `eRingClass_Metalic`; **this is the only journal source of ring type + reserve level** | Hotspot DB, scoring, ring map |
| `Cargo` | `Vessel`, `Count`, `Inventory?[{Name, Count, Stolen}]` | Cargo %, Manifest |
| `MarketSell` | `MarketID`, `Type`, `Count`, `SellPrice`, `TotalSale`, `AvgPricePaid` | Session credits, Ledger calibration |
| `MarketBuy` | `MarketID`, `Type`, `Count`, `BuyPrice`, `TotalCost` | Limpet restock cost |
| `Docked` | `StationName`, `StationType`, `StarSystem`, `SystemAddress`, `MarketID`, `DistFromStarLS`, `LandingPads?` | State, run legs |
| `Undocked` | `StationName`, `MarketID` | State, run legs |
| `FSDJump` | `StarSystem`, `SystemAddress`, `StarPos [x,y,z]`, `JumpDist`, `FuelUsed`, `FuelLevel` | Location, travel-time split |
| `SupercruiseEntry` / `SupercruiseExit` | `StarSystem`, `Body?`, `BodyType?` | Activity detection |
| `Location` | `StarSystem`, `SystemAddress`, `StarPos`, `Docked`, `Body?`, `BodyType?` | Session bootstrap |
| `LoadGame` | `Commander`, `FID`, `Ship`, `ShipName`, `GameMode` (no location fields — distinct shape from `Location`) | Session bootstrap, relog detection |
| `Loadout` | `Ship`, `ShipName`, `Modules[{Slot, Item}]`, `CargoCapacity`, `MaxJumpRange` | Outfitter, planner |
| `Music` | `MusicTrack` | Activity hinting only (never control) |
| `CarrierStats` | `CarrierID`, `Callsign`, `Name`, `FuelLevel`, `JumpRangeCurr`, `JumpRangeMax`, `SpaceUsage{…}`, `Finance{…}` | Carrier ops |
| `CarrierJumpRequest` / `CarrierJump` | `CarrierID?`, `SystemName`, `Body?`, `DepartureTime?` — `CarrierJump` is only written while the player is aboard; absent it, state reconciles from the next `CarrierStats`/cAPI poll | Expedition tracking |
| `CarrierJumpCancelled` | `CarrierID` | Expedition tracking (clears pending jump) |
| `CarrierTradeOrder` | `CarrierID`, `Commodity`, `PurchaseOrder?`, `SaleOrder?`, `Price` | Carrier market mgmt |
| `CarrierDepositFuel` | `CarrierID`, `Amount`, `Total` | Tritium tracker |
| `CargoTransfer` | `Transfers[{Type, Count, Direction: toship\|tocarrier}]` | Transfer ledger |

### 5.2 Live status files (same directory, atomically rewritten by the game)

| File | Consumed shape |
| --- | --- |
| `Status.json` | `Flags` bitmask (bit0 Docked, bit1 Landed, bit4 Supercruise, bit5 FA-off, bit6 Hardpoints, bit9 CargoScoop, **bit16 FSD MassLocked, bit24 InMainShip** — the presence check for the Yellow-Zone arming model keys on bit 24, and the decode table must be validated against real captured states, never fixtures derived from this row), `Flags2`, `Pips [sys,eng,wep]` (half-pips), `FireGroup`, `GuiFocus`, `Fuel{FuelMain, FuelReservoir}`, `Cargo` (tons), `Balance`, `LegalState` — write cadence on state-change is not guaranteed periodic; staleness heuristics must be empirically calibrated (Step 7.5) |
| `Cargo.json` | `Vessel`, `Count`, `Inventory[{Name, Name_Localised, Count, Stolen}]` |
| `Market.json` | `MarketID`, `StationName`, `StarSystem`, `Items[{id, Name, Category, SellPrice, BuyPrice, MeanPrice, Demand, Stock}]` — written when the player opens a commodity market |
| `NavRoute.json` | `Route[{StarSystem, SystemAddress, StarPos, StarClass}]` — read-only; LODESTAR never writes it |
| `ModulesInfo.json` | `Modules[{Slot, Item, Power, Priority}]` |

Live files are read with retry-on-partial-write (the game rewrites them non-atomically at times); a parse failure is retried, never fatal.

### 5.3 External API clients — limits & caching

All external HTTP goes through **one gateway** (minimal core in Step 0.10, full client features in Step 4.6) that enforces: host allowlist (§5.4), **manual redirect handling — every 3xx hop's target is re-checked against the allowlist, max 3 hops, cross-host redirects to non-allowlisted hosts refused**, strict URL validation (parsed, no userinfo/`@`, no IP-encoding tricks), per-host token-bucket rate limits, response caching in SQLite with per-source TTL, `If-Modified-Since`/ETag where supported, exponential backoff with jitter on 429/5xx, and a data-age stamp attached to every payload for UI surfacing. **Loopback rule:** "localhost" endpoints (Ollama, sidecars, relay dev) are valid only as a literal loopback IP in `127.0.0.0/8` or `::1` — never a hostname — and the resolved peer address is re-verified at connect time.

| Source | Protocol | Rate policy (self-imposed ≤ documented limits) | Cache TTL | Notes |
| --- | --- | --- | --- | --- |
| EDSM | REST | ≤ 10 req/min sustained, backoff on 429 | systems/coords: 30 d; bodies/rings: 7 d | systems, bodies, ring metadata |
| Spansh | REST (async job API) | ≤ 6 req/min; poll jobs ≥ 2 s interval | routes: 24 h keyed by query | routing, neutron/carrier planners |
| Inara | inapi/v1 JSON | batched events, ≤ 2 req/min sustained; API key required | market reference: 2 h | app registration required (§9) |
| EDDN | ZeroMQ SUB `tcp://eddn.edcd.io:9500` (zlib) | n/a (listener) | live stream → `market_snapshots` | consume-only in v1 |
| Frontier cAPI | OAuth2 + PKCE, `auth.frontierstore.net` → `companion.orerve.net` | per Frontier guidance; token refresh; ≤ 1 profile poll/5 min | live, no cache beyond session | client-id approval pending (§9); feature-flagged |
| Discord | Webhook POST | ≤ 1 post/session end; honor 429 `retry_after` | n/a | opt-in, URL stored encrypted |
| Ollama | HTTP `127.0.0.1:11434` | local | n/a | never a remote host |
| Community endpoint | HTTPS (self-hosted, §Phase 10) | ≤ 4 req/min | sync: 24 h | opt-in |

### 5.4 Egress allowlist (compliance-enforced)

**Runtime allowlist (the gateway's compile-time union):** `www.edsm.net`, `spansh.co.uk`, `inara.cz`, `eddn.edcd.io`, `auth.frontierstore.net`, `companion.orerve.net`, `discord.com` (webhook path only, only when opted in), the user-configured community endpoint (only when opted in), literal-loopback addresses per §5.3 (Ollama, sidecars, relay dev), and — Phase 9 only, while the user is joined to a wing — the user-entered relay host, scoped to exactly that host+port, WebSocket only, for the session's lifetime (`wss://` default; plain `ws://` requires an explicit warning acknowledgment).

**Install/first-run artifact downloads are NOT part of the runtime allowlist.** They go through a separate, time-boxed **artifact downloader** (Step 0.10): GET-only, against pinned URLs with **SHA-256 hashes committed in-repo** (never hashes fetched alongside the artifact), invocable only from onboarding/settings flows, refusing everything else. Its permitted hosts: `github.com`/`objects.githubusercontent.com` (Piper release), `huggingface.co` (voice/whisper models), `registry.ollama.ai`/`ollama.com` (LLM pull — verified against a committed digest, not just the registry manifest), and for sidecar venv bootstrap `pypi.org`/`files.pythonhosted.org` (with `pip install --require-hashes` against committed lockfiles). Never for inference; never at steady-state runtime.

**Non-HTTP egress** exists in exactly two modules — the EDDN ZeroMQ subscriber (`integrations/eddn`, fixed host) and the wing relay WebSocket client (`wing/client`, consent-gated) — and socket APIs (`net`, `tls`, `dgram`, raw `WebSocket` to non-loopback) are lint-banned everywhere else.

**Anything else is refused at runtime and fails the compliance suite at CI.** The compliance suite includes: a positive test that a runtime-constructed unknown host is refused by the gateway; a redirect-escape test (allowlisted host 302→denied host must be refused); loopback-bypass fixtures (`localhost.attacker.com`, `127.0.0.1@evil.com`, decimal/hex IP encodings); and the deny-with-prejudice list of AI/ML inference hosts (OpenAI, Anthropic, Google, Azure, AWS Bedrock, etc.) that must stay refused forever. The allowlist governs LODESTAR-initiated **and** LODESTAR-triggered egress (e.g. an Ollama pull LODESTAR requests counts).

### 5.5 SQLite schema (table registry)

One SQLite DB per profile at `%APPDATA%/lodestar/lodestar.sqlite3`, WAL mode, foreign keys ON. Migrations are forward-only, versioned, and shipped in `@lodestar/data`. Authoritative DDL lives in the migration files; this registry names every table, its purpose, and the phase that introduces it.

| Table | Purpose | Phase |
| --- | --- | --- |
| `schema_migrations` | applied migration versions | 0 |
| `settings` | non-secret config KV (JSON values) | 0 |
| `sessions` | one row per mining session: timestamps, cmdr, ship, system/body/ring, totals (tons, credits, limpets launched/collected) | 1 |
| `session_events` | append-only typed event log per session (replay/debug source of truth) | 1 |
| `prospects` | every `ProspectedAsteroid`: content level, remaining %, motherlode, materials JSON, Assay verdict + reasoning, acted-on flag | 2 |
| `refinements` | every refined ton by commodity | 1 |
| `market_snapshots` | commodity sell prices per market with source + source-timestamp (journal/EDDN/Inara/cAPI), keyed by canonical commodity id — created in Phase 2 (migration 004); Phase 4's migration 006 extends it **additively only** (new columns via `ADD COLUMN` + indexes; no table rebuilds) | 2, 4 |
| `alert_rules` | user-defined alert rules (price thresholds, cargo-full %, per-rule cooldowns) | 4 |
| `chat_messages` | Assistant conversation history (messages + tool-call records) | 5 |
| `systems` / `stations` / `bodies` / `rings` | galaxy reference data (coords, pad sizes, ring type, reserve level) with `updated_at` | 4 |
| `hotspots` | ring hotspots: commodity, count, provenance (seed/journal/community), first-seen/last-confirmed | 4 |
| `overlaps` | detected hotspot overlaps: commodities, multiplicity, confidence, provenance | 4 |
| `runs` | planned runs: full plan JSON, estimated tons/hr + cr/hr, actuals after completion | 4 |
| `calibration_weights` | versioned Layer-1 weight vectors + posterior parameters, linked to the run that triggered each update | 6 |
| `ml_models` | local model registry: kind, version, file path, metrics, active flag | 6 |
| `carrier_state` / `carrier_fuel_log` | carrier snapshot + Tritium ledger | 8 |
| `expeditions` | expedition plans: legs JSON, fuel staging, status | 8 |
| `cargo_transfers` | ship↔carrier↔market transfer ledger | 8 |
| `wing_sessions` / `wing_snapshots` | wing membership (alias, share level, consent) + received telemetry snapshots | 9 |
| `community_submissions` | outbound contribution queue: payload, anonymized flag, status, remote id | 10 |
| `personal_bests` | best tons/hr, best rock, best session, with context | 3 |

**Migration number registry (forward-only, one owner step each):** 001 init (0.6) · 002 sessions (1.8) · 003 prospects (2.1) · 004 market + commodities (2.5) · 005 personal_bests (3.4) · 006 galaxy + market extensions (4.1) · 007 alert_rules (4.11) · 008 chat_messages (5.5) · 009 ml_models (6.3) · 010 calibration_weights (6.5) · 011 carrier tables (8.1) · 012 wing tables (9.2) · 013 community_submissions (10.3). New tables enter this registry before their migration is written.

### 5.6 IPC / WebSocket message shapes

- **Renderer ↔ main (Electron IPC via contextBridge):** typed request/response channels (`invoke`) + push channels (`send`). Single envelope: `{ v: 1, ts: string, channel: Channel, payload: … }` where `Channel` is a closed union defined in `@lodestar/shared`, **enumerated exhaustively in code and extended phase by phase** (initial set: `app.health`, `state.snapshot`, `state.delta`, `session.stats`, `settings.get/set`; each phase's steps name the channels they add). Every `invoke` response uses the **serialized result envelope** `{ ok: true, value } | { ok: false, error: { code, message, causeChain: string[] } }` with mapping helpers in `@lodestar/shared` — `Result`/`DomainError` never cross the wire as class instances. No untyped `ipcRenderer` access is exposed to the renderer.
- **Overlay/aux windows:** subscribe over `ws://127.0.0.1:<ephemeral port>` — the server **binds loopback only**, authenticates via a high-entropy per-launch token sent in the WebSocket subprotocol/header (never a query param, never logged; pino redaction covers it) — same envelope, push-only channels (`assay.verdict`, `session.stats`, `state.delta`, `alerts.*`).
- **Sidecars (ML/STT):** newline-delimited JSON-RPC 2.0 over stdio: `predict_yield`, `classify_prospect`, `train`, `transcribe_begin/chunk/end`, `health` (returns bound GPU UUID — checked against config).

---

## 6. PHASED BUILD PLAN

> Steps are atomic and strictly ordered. Work proceeds one step at a time per the Session Protocol (§10). Every step follows TDD (§4.2) and passes adversarial review (§4.8) before its commit. "Verify by" commands are run from the repo root.

### PHASE 0 — Foundation & Scaffolding

**Goal:** a runnable, empty Electron + React + TS app with full tooling, database, settings, and CI.
**Depends on:** none. **Compliance zone(s):** GREEN.

#### Step 0.1 — Wire monorepo tooling
- Status: [x] DONE
- Zone: GREEN
- Files: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `packages/shared/{package.json,tsconfig.json}`
- Work: install pnpm workspace deps (turbo, typescript, vitest); create `tsconfig.base.json` (strict flags per §4.1) and the `@lodestar/shared` package compiling an initial module (`version.ts` exporting the app version constant read by later steps). **Supply-chain posture from the first install:** dependency lifecycle scripts disabled by default via pnpm config, with an explicit `onlyBuiltDependencies` allowlist for the native modules that genuinely must build (better-sqlite3, electron, esbuild, …); committed lockfile with integrity hashes is the only install source in CI (`--frozen-lockfile`).
- Acceptance criteria:
  - `pnpm install` succeeds from clean checkout; `pnpm build` and `pnpm typecheck` pass via turbo.
  - Strict TS flags (§4.1) active in the base config and inherited.
  - Lifecycle-script allowlist in effect: a test package with a postinstall script outside the allowlist does not execute it (verified once, documented).
- Verify by: `pnpm install && pnpm build && pnpm typecheck`

#### Step 0.2 — `@lodestar/shared` primitives (TDD)
- Status: [x] DONE
- Zone: GREEN
- Files: `packages/shared/src/{result.ts,units.ts,errors.ts,logging.ts,channels.ts}` + colocated `*.test.ts`
- Work: implement `Result<T,E>` (ok/err, map, andThen, unwrapOr), branded unit types (`Tons`, `Credits`, `LightYears`, `Percent`) with constructors that validate ranges, `DomainError` (code, message, cause), the logger interface, and the closed `Channel` union with envelope type (§5.6). Tests first.
- Acceptance criteria:
  - All primitives fully implemented with property/unit tests; ≥95% line coverage in this package.
  - Invalid unit construction (negative tons, >100 percent) returns `err`, never throws.
- Verify by: `pnpm --filter @lodestar/shared test -- --coverage`

#### Step 0.3 — Lint wall: ESLint, Prettier, banned patterns, dependency direction
- Status: [ ] TODO
- Zone: GREEN
- Files: `eslint.config.js`, `.prettierrc.json`, `packages/scripts/src/{check-banned-patterns.ts,check-dependency-direction.ts}` + tests
- Work: flat ESLint config (typescript-eslint strict, react, no-`any`); the `@lodestar/scripts` workspace package containing: a banned-pattern checker failing on `TODO|FIXME|XXX|HACK|unimplemented|placeholder|stub(bed)?` in committed source (test files excluded for the words `fake`/`double` only — the marker words stay banned everywhere), and a dependency-direction checker enforcing the full §3.2 classification (every workspace package must be classified; unknown packages fail the check). Both wired into `pnpm lint`.
- Acceptance criteria:
  - `pnpm lint` passes on the clean tree; seeding a `// TODO` into any `src/` file makes it fail (demonstrated in the checker's own tests).
  - Importing `@lodestar/ai` from `@lodestar/intelligence` fails the direction check; importing `@lodestar/voice` from `@lodestar/ai` fails it; a package absent from the §3.2 classification fails it (each covered by test).
- Verify by: `pnpm lint && pnpm --filter @lodestar/scripts test` (checker self-tests)

#### Step 0.4 — Electron boots with typed IPC
- Status: [ ] TODO
- Zone: GREEN
- Files: `apps/desktop/src/main/{index.ts,windows.ts,ipc.ts}`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/{index.html,main.tsx,App.tsx}`, `apps/desktop/{electron.vite.config.ts,package.json}`
- Work: Electron main + preload (contextBridge exposing a typed `lodestar` API only) + Vite React renderer. Implement the first real IPC round-trip: `app.health` request returns `{version, dbStatus: "not-configured", journalStatus: "not-configured"}` — real values from real probes, evolving in later steps (an Ollama probe joins in Phase 5). Also in this step: `app.requestSingleInstanceLock()` (second launch focuses the first window — prevents double journal ingestion + SQLite contention) and the pino logger implementation with `pino-roll` rotation + secret-redaction paths (implements the `shared` logger interface).
- Acceptance criteria:
  - `pnpm --filter desktop dev` opens a window; renderer displays the health payload received over IPC.
  - `nodeIntegration` disabled, `contextIsolation` enabled, no untyped `ipcRenderer` exposure (asserted by a unit test on the preload surface).
  - Second app launch does not open a second window (tested via Playwright harness); log files rotate and redact seeded secret-shaped strings (tested).
- Verify by: `pnpm --filter desktop test && pnpm --filter desktop dev` (manual: window shows live health data)

#### Step 0.5 — Cockpit-MFD theme tokens + base components (TDD)
- Status: [ ] TODO
- Zone: GREEN
- Files: `apps/desktop/src/renderer/theme/{tokens.css,tailwind-preset.ts}`, `apps/desktop/src/renderer/components/{MfdPanel.tsx,MfdButton.tsx,MfdGauge.tsx,DataAgeBadge.tsx}` + tests
- Work: Tailwind wired with a preset defining the palette (near-black `#0A0A0F` panels, Elite-orange `#FF7100` primary, cyan `#00B3D6` accents), display + mono fonts, clip-path panel shapes, scanline/glow utilities; four base components with @testing-library tests (including `DataAgeBadge` which renders staleness from a timestamp — used by every external-data view per §1.2.3).
- Acceptance criteria:
  - Components render with tokens applied; `DataAgeBadge` shows `LIVE/<1m/…/STALE` buckets correctly across boundary cases (tested).
- Verify by: `pnpm --filter desktop test`

#### Step 0.6 — SQLite + migration runner + migration 001
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/data/src/{db.ts,migrator.ts,migrations/001-init.sql}`, `packages/core/src/persistence/db-service.ts` + tests
- Work: better-sqlite3 opened WAL-mode at the profile path (injectable for tests); a forward-only migration runner (transactional, records into `schema_migrations`, refuses gaps/divergence); migration 001 creates `schema_migrations` + `settings`. **Native-ABI strategy (applies to every native module: better-sqlite3, zeromq, the Phase-7 addon):** Vitest runs against the Node-ABI build; the Electron-ABI rebuild happens only in the desktop app's dev/package pipeline (electron-builder's install-app-deps), and the two never share one artifact — documented in the step, with the desktop dev script performing the rebuild into the app's isolated module directory. DB-behavior-in-Electron is covered by the Playwright smoke, not by Vitest.
- Acceptance criteria:
  - Migrator applies 001 to a fresh temp DB, is idempotent on re-run, and rejects an out-of-order migration (all tested).
  - The Electron app opens/creates the real profile DB at boot and `app.health.dbStatus` becomes `"ok"` (verified in the Playwright smoke).
  - `pnpm --filter @lodestar/data test` (Node ABI) and `pnpm --filter desktop dev` (Electron ABI) both work from the same checkout without re-running installs in between.
- Verify by: `pnpm --filter @lodestar/data test && pnpm --filter desktop dev` (health shows db ok)

#### Step 0.7 — Settings service + journal auto-detect + secret storage
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/core/src/settings/{settings-service.ts,journal-locator.ts}`, `apps/desktop/src/main/secrets.ts` + tests
- Work: typed settings service over the `settings` table (schema-validated JSON per key: journal path, Ollama endpoint `http://127.0.0.1:11434` — loopback-IP-literal only per §5.3, AI GPU UUID, consent flags all defaulting OFF). **Consent keys have exactly one canonical write surface** — the Privacy panel (10.5); until it ships they are read-only everywhere. Journal locator probing `%USERPROFILE%\Saved Games\Frontier Developments\Elite Dangerous` and validating it contains `Journal.*.log`. Secrets behind a `SecretsStore` interface in core with the Electron `safeStorage` adapter in the app (DPAPI on Windows — user-account-scoped; threat model documented: protects against other users/disk theft, not same-user malware); when `safeStorage.isEncryptionAvailable()` is false the store **refuses to save** with an actionable error — there is no plaintext fallback, ever.
- Acceptance criteria:
  - Settings round-trip with validation (bad shapes rejected as `Result.err`); defaults include every consent flag OFF (tested).
  - Journal locator finds the real directory on this machine or returns a typed `not-found` for manual configuration.
  - `SecretsStore` contract tested in core against a test adapter; the real `safeStorage` adapter round-trips (ciphertext ≠ plaintext) in the Playwright-Electron smoke; unavailable-encryption → typed refusal (tested).
- Verify by: `pnpm --filter @lodestar/core test && pnpm --filter desktop test`

#### Step 0.8 — Settings screen
- Status: [ ] TODO
- Zone: GREEN
- Files: `apps/desktop/src/renderer/screens/Settings.tsx` (+ section components) + tests, `apps/desktop/src/main/ipc.ts` (settings channels)
- Work: Settings screen (MFD-styled) editing journal path (with auto-detect button + live validation), Ollama endpoint + GPU selection (lists GPUs via `nvidia-smi` query surfaced from main), API keys (masked, stored via secrets). Consent flags render **read-only** with an "arrives in Phase 10 — Privacy panel" notice (single-authority rule from 0.7); no inert toggles.
- Acceptance criteria:
  - Every editable field persists and reloads; invalid journal path shows validation error; consent section is non-interactive and states its authority (tested); component tests cover save/load/error paths.
- Verify by: `pnpm --filter desktop test && pnpm --filter desktop dev` (manual: edit + relaunch retains values)

#### Step 0.9 — Command Deck shell
- Status: [ ] TODO
- Zone: GREEN
- Files: `apps/desktop/src/renderer/screens/CommandDeck.tsx`, `apps/desktop/src/renderer/{routes.tsx,components/StatusBar.tsx,components/NavRail.tsx}` + tests
- Work: app chrome — nav rail (Command Deck / Assay / Manifest / Vein Finder / Ledger / Cartographer / Assistant / Ops / Carrier / Wing / Settings; unbuilt modules render a real "arrives in Phase N" MFD notice driven by a feature-availability map, not dead links), status bar with live DB + journal connection indicators from `app.health` (the Ollama indicator joins in Phase 5 when its probe exists), and the empty Command Deck grid awaiting Phase 1 telemetry.
- Acceptance criteria:
  - Navigation works; status bar reflects real probe results (e.g. journal indicator red when path invalid — tested via injected health states).
- Verify by: `pnpm --filter desktop test && pnpm --filter desktop dev`

#### Step 0.10 — Minimal egress gateway + artifact downloader
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/integrations/src/gateway/{gateway.ts,allowlist.ts,url-guard.ts}`, `packages/integrations/src/downloader/artifact-downloader.ts` + tests
- Work: the enforcement core of §5.3/§5.4, built before anything can make a network request: URL guard (strict parse, no userinfo, loopback = literal `127.0.0.0/8`/`::1` only, IP-encoding tricks rejected), compile-time + runtime host allowlist, **manual redirect handling with per-hop allowlist re-check (max 3 hops)**, typed refusals, logging. Plus the separate install-time **artifact downloader**: GET-only, pinned URL + **in-repo committed SHA-256** verification, invocable only from onboarding/settings flows, its own host list per §5.4. Caching/rate-limiting/ETag arrive in Step 4.6 on this same core. A lint rule bans `fetch`/`net`/`axios`/`undici` outside the gateway, the downloader, and the (future, itself-typed-loopback) Ollama client.
- Acceptance criteria:
  - Allowlist refusal of an unknown constructed host; redirect-escape (allowlisted 302 → denied host) refused; loopback-bypass fixtures (`localhost.attacker.com`, `127.0.0.1@evil.com`, `0x7f000001`, `127.1`) all refused — each a named test.
  - Downloader refuses a hash mismatch and any non-pinned URL (tested against a local fake server); direct-fetch lint rule demonstrated by a violating fixture.
- Verify by: `pnpm --filter @lodestar/integrations test -- gateway downloader`

#### Step 0.11 — CI + compliance suite v1
- Status: [ ] TODO
- Zone: GREEN
- Files: `.github/workflows/ci.yml`, `packages/compliance/{package.json,src/*.test.ts}`
- Work: GitHub Actions on push/PR: lint → typecheck → unit/integration (**ubuntu AND windows-latest for `@lodestar/core` + `@lodestar/voice`** — the journal watcher, live-file retry, and bindings code are Windows-behavior-sensitive) → Playwright Electron smoke (windows-latest) → compliance job (uncached — `turbo.json` sets `compliance.cache: false` so a change anywhere can never replay a stale green). CI installs use `--frozen-lockfile` with lifecycle scripts restricted per 0.1. Compliance v1 (real, running tests): banned-pattern scan; dependency scan failing on any AI-vendor SDK (`openai`, `@anthropic-ai/*`, `@google/generative-ai`, `cohere-ai`, AWS Bedrock clients, etc.) in any lockfile; source scan failing on any non-allowlisted (§5.4) hostname literal in `packages/*/src`; socket-API scan (`net`/`tls`/`dgram`/non-loopback `WebSocket`) outside the two sanctioned modules; secret-pattern scan (`sk-`, `ghp_`, webhook URLs) over the tree; plus the Step 0.10 gateway tests promoted into the suite.
- Acceptance criteria:
  - CI green on the phase branch; each compliance rule demonstrated by a self-test that feeds it a violating fixture and asserts failure.
- Verify by: `pnpm compliance` locally + green CI run on GitHub

#### Step 0.12 — Phase 0 gate
- Status: [ ] TODO
- Zone: GREEN
- Files: `LODESTAR_SSOT.md` (§6 statuses, §11 changelog)
- Work: run the full Phase Definition of Done below; whole-phase adversarial review (§4.8); fix findings; summarize for operator; pause for approval.
- Acceptance criteria: every 0.x step `[x] DONE`; DoD checklist below passes end-to-end on a clean clone.
- Verify by: `git clean -xdf && pnpm install && pnpm build && pnpm lint && pnpm test && pnpm compliance` then `pnpm --filter desktop dev`

**Phase 0 Definition of Done:** clean clone → install → build → lint → test → compliance all green; app boots to Command Deck shell with live health indicators; settings persist including encrypted secrets; DB migrated; the egress gateway + downloader enforce §5.4 with tests; CI enforcing all of it on GitHub (including Windows unit runs and the uncached compliance job).

---

### PHASE 1 — Journal Core & Live Telemetry

**Goal:** real-time game state on screen.
**Depends on:** Phase 0. **Compliance zone(s):** GREEN.

#### Step 1.1 — Journal fixture corpus
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/core/test/fixtures/journal/**`, `packages/scripts/src/scrub-journal.ts` + tests
- Work: build the test corpus under the standing rule **"the repo is treated as public from commit #1"** (git history is permanent; OQ2 contemplates going public): fixtures are **synthetic-first** — hand-authored files covering every §5.1 event with realistic field values, mid-line truncation, partial last line, UTF-8 BOM, rotation pairs (`Journal.…01.log` → `…02.log`), and an in-progress file that grows. Where a real capture is genuinely needed (odd real-world formatting), it passes through an **allowlist scrubber**: only fields on a known-safe list survive; everything else (CMDR, FID, friends/chat, ship names/idents, balances, squadron, visited-system trails beyond the event under test, fine timestamps) is redacted or replaced by constants.
- Acceptance criteria:
  - Corpus covers all §5.1 events + all edge cases above; a scrubber test asserts the **absence of every PII-bearing field class** (not just three names) in every committed fixture; fixtures documented in a manifest file consumed by tests.
- Verify by: `pnpm --filter @lodestar/core test -- fixtures && pnpm --filter @lodestar/scripts test -- scrub`

#### Step 1.2 — JSONL tailer (TDD)
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/core/src/journal/tailer.ts` + tests
- Work: an incremental JSONL reader: byte-offset resume, tolerant of partial trailing lines (buffer until newline), BOM handling, file truncation/replacement detection (inode/size regression → reset), emitting parsed-line events with file+offset provenance. Pure logic over an injected file handle for exhaustive testing.
- Acceptance criteria:
  - All fixture edge cases pass: no event lost, none duplicated, partial line never emitted early; truncation resets cleanly (each a named test).
- Verify by: `pnpm --filter @lodestar/core test -- tailer`

#### Step 1.3 — Journal watcher (chokidar) + session file selection
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/core/src/journal/watcher.ts` + integration tests
- Work: watcher over the journal directory: pick newest `Journal.*.log` at start, backfill from file start, switch on rotation (new file appears), tail live appends, watch the §5.2 live files with debounce + retry-on-partial-write JSON reads. **The active journal file is tailed by polling (stat+read at a 100 ms interval)** — Windows ReadDirectoryChangesW notifications for a file being appended by another process are lazy/unreliable (NTFS metadata flush), so event-driven watching (chokidar) is used only for rotation detection and the atomically-rewritten live files. Emits into the event bus (1.4). Integration-tested against a temp dir where tests write/rotate real files.
- Acceptance criteria:
  - Integration test: simulated game session (append, rotate, live-file rewrite) produces the exact expected event sequence; watcher survives transient `EBUSY`/malformed JSON with a logged retry, never a crash.
  - Real-machine detection-latency measurement with the game running (journal write → event emitted) recorded in `docs/verification/phase-1.md`; p95 must be ≤ 250 ms with the 100 ms poll.
- Verify by: `pnpm --filter @lodestar/core test -- watcher`

#### Step 1.4 — Typed event bus
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/core/src/bus/event-bus.ts` + tests
- Work: an in-process typed pub/sub bus keyed by the closed event union (journal events, live-file updates, derived domain events): ordered synchronous dispatch, per-subscriber error isolation (a throwing subscriber is logged and detached, others unaffected), replay-last-value channels for state snapshots.
- Acceptance criteria:
  - Ordering, isolation, unsubscribe, and replay semantics each pinned by tests; a subscriber exception cannot break other subscribers (tested).
- Verify by: `pnpm --filter @lodestar/core test -- event-bus`

#### Step 1.5 — Journal event parsers (core set)
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/core/src/journal/events/*.ts` + tests
- Work: validated parsers for the non-carrier §5.1 events (carrier events arrive in Phase 8): schema-checked field extraction into domain types from `@lodestar/shared`, tolerant of unknown extra fields, collecting unknown-event + schema-drift telemetry into local logs. Every parser TDD'd against fixture lines including malformed variants.
- Acceptance criteria:
  - Each event: happy path + missing-field + wrong-type cases tested; malformed events yield `Result.err` with event context, never throw; unknown events pass through as `UnknownJournalEvent`.
- Verify by: `pnpm --filter @lodestar/core test -- events`

#### Step 1.6 — Live status file parsers
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/core/src/livefiles/{status.ts,cargo.ts,market.ts,navroute.ts,modules.ts}` + tests
- Work: parsers for §5.2 files including the `Flags`/`Flags2` bitmask decoded to a named boolean record (docked, supercruise, hardpoints, cargo scoop, mass-locked bit 16, in-main-ship bit 24, …), pips as `{sys,eng,wep}` halves, fuel, cargo tons.
- Acceptance criteria:
  - Bitmask decoding verified against **real captured** `Status.json` states recorded on this machine (docked, supercruise, deployed-hardpoints, FA-off, in-main-ship vs mass-locked) — not synthetic fixtures derived from §5.2's own table; captures allowlist-scrubbed per 1.1 before commit.
  - All parsers reject partial JSON with retryable errors.
- Verify by: `pnpm --filter @lodestar/core test -- livefiles`

#### Step 1.7 — Domain state reducers
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/core/src/state/{ship.ts,location.ts,cargo.ts,activity.ts,root.ts}` + tests
- Work: pure reducers folding bus events into the app state tree: ship (name, type, loadout summary, fuel), location (system, body, ring, docked station, coordinates), cargo (manifest with per-commodity tons + est. values once prices exist), activity classifier (docked / supercruise / in-ring mining / traveling — derived from event patterns, display-only). Root snapshot + delta emission.
- Acceptance criteria:
  - Replaying the full fixture session through the reducers yields the exact expected final state (golden test); each reducer's transitions unit-tested; activity classification correct across the fixture session timeline.
- Verify by: `pnpm --filter @lodestar/core test -- state`

#### Step 1.8 — Session tracker + persistence
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/core/src/session/{tracker.ts,repository.ts}`, `packages/data/src/migrations/002-sessions.sql` + tests
- Work: migration 002 (`sessions`, `session_events`, `refinements` per §5.5); session lifecycle rules, stated exactly: **starts** on first mining signal (`LaunchDrone` prospector / `MiningRefined` in a ring context); **relog** (journal rotation + `LoadGame`) within 20 min at the same body **continues** the same session (miners relog to reset asteroids); **ends** when session-commodity cargo reaches zero via sells (multi-station/partial sells accumulate into the same session), on explicit stop, or after 20 min with no mining activity; **`MarketSell` at the player's own carrier market is banking, not income** — excluded from credits/hr and flagged for Phase-8 reconciliation. Rolling tons refined, tons/hr, credits/hr (from `MarketSell` linkage), limpets launched; all events of an active session appended to `session_events`.
- Acceptance criteria:
  - Fixture replay produces a session row with exact expected totals and rates (golden numbers hand-computed in the test).
  - Dedicated fixtures for: relog-continues, two-station sell, own-carrier sell excluded, no-activity timeout — each pinned by a golden test.
  - Tracker survives app restart mid-session (resumes from DB + journal backfill — tested).
- Verify by: `pnpm --filter @lodestar/core test -- session`

#### Step 1.9 — IPC state bridge
- Status: [ ] TODO
- Zone: GREEN
- Files: `apps/desktop/src/main/{state-bridge.ts,ws-server.ts}`, `apps/desktop/src/preload/index.ts`, renderer store `apps/desktop/src/renderer/stores/game-state.ts` + tests
- Work: main-process subscription of the root state → `state.snapshot` (on subscribe) + `state.delta` (throttled ≤ 10 Hz) over IPC; Zustand store on the renderer side hydrating from snapshot + applying deltas; `session.stats` channel likewise. Also the **localhost WS push server** (consumed by the overlay from Step 2.10): binds `127.0.0.1` only, per-launch high-entropy token in the subprotocol header (§5.6), lifecycle owned by app main (start before any subscriber window, clean shutdown).
- Acceptance criteria:
  - Round-trip test (main emits → renderer store updates) via Playwright/Electron harness; throttling verified; renderer never receives non-envelope messages (type-checked end to end).
- Verify by: `pnpm --filter desktop test`

#### Step 1.10 — Command Deck live telemetry UI
- Status: [ ] TODO
- Zone: GREEN
- Files: `apps/desktop/src/renderer/screens/CommandDeck.tsx`, `components/{ShipPanel,LocationPanel,FuelPips,CargoPanel,ActivityPanel,SessionStatsPanel}.tsx` + tests
- Work: the Command Deck comes alive: ship, location, fuel + pips, cargo manifest with values, current activity, and the live session panel (tons refined, tons/hr, credits/hr). MFD styling, Framer Motion micro-transitions, 10 Hz smooth updates. **Offline/degraded states are first-class:** journal directory valid but no fresh writes → an unmistakable `GAME OFFLINE` state with the last-known snapshot timestamped (never stale data presented as live); no journal configured → guidance to Settings.
- Acceptance criteria:
  - Component tests drive the store with fixture states and assert rendered values, including the offline and not-configured states.
  - Manual verification with Elite Dangerous running shows live updates within 1 s of in-game events (recorded in changelog).
- Verify by: `pnpm --filter desktop test` + manual live-game check (documented script in `docs/verification/phase-1.md`)

**Phase 1 Definition of Done:** with the game running, the Command Deck shows correct live ship/location/fuel/pips/cargo/activity and a persisted session's tons/hr + credits/hr; full fixture-replay golden tests green; all Phase 0 gates still green.

---

### PHASE 2 — Assay (Prospector Engine)

**Goal:** the signature real-time MINE/SKIP feature.
**Depends on:** Phase 1. **Compliance zone(s):** GREEN (Overlay window is display-only; the Yellow-Zone voice arrives in Phase 7).

#### Step 2.1 — Prospect event capture + persistence
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/core/src/journal/events/{prospected-asteroid.ts,asteroid-cracked.ts}`, `packages/data/src/migrations/003-prospects.sql`, `packages/core/src/session/prospect-repository.ts` + tests
- Work: full-fidelity `ProspectedAsteroid` parsing (materials with proportions, content tier, motherlode, remaining %), `AsteroidCracked` linkage for deep-core outcomes; migration 003 (`prospects`); persistence keyed to the active session. (Journals carry no asteroid identity — every event is stored as an independent observation; no "same rock" claims.)
- Acceptance criteria:
  - Fixture prospects round-trip to DB with all fields; a partially-depleted observation (`Remaining < 100`) is stored as its own row with `remaining_pct` (tested).
- Verify by: `pnpm --filter @lodestar/core test -- prospect`

#### Step 2.2 — Canonical commodity dictionary
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/shared/src/commodities.ts` + tests
- Work: the single commodity-identity module every other feature joins through. The sources genuinely disagree on names — `ProspectedAsteroid.Materials[].Name` uses internal names (`Opal` for Void Opals, `LowTemperatureDiamond` for LTDs), `MiningRefined.Type` uses `$..._name;` symbols, `MarketSell.Type` uses lowercase internal names, `Market.json` uses symbols + `Name_Localised`, and EDDN/Inara use their own canonical names. One record per mineable commodity: canonical id, journal internal name, `$symbol;`, localised display name, EDDN name, Inara name, mineable methods. Mapping functions from every source scheme → canonical id.
- Acceptance criteria:
  - One fixture per naming scheme (prospect line, refined line, MarketSell line, Market.json item, EDDN message) maps to the same canonical id — tested for at minimum Void Opals, LTDs, Platinum, Painite, Rhodplumsite, Tritium.
  - Unknown names return a typed `unknown-commodity` result (never a silent miss).
- Verify by: `pnpm --filter @lodestar/shared test -- commodities`

#### Step 2.3 — Commodity × method threshold matrix
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/intelligence/src/assay/thresholds.ts` + tests, `packages/core/src/settings/threshold-overrides.ts` + tests
- Work: default worth-mining thresholds as a **commodity × method matrix** keyed by canonical id (provisional entries, each verified in-game/against current journal observations before defaults ship): **laser** — Platinum, Painite, Osmium, Palladium, Gold, Low Temperature Diamonds (icy), Bromellite (icy), Tritium (icy); **deep-core** — Void Opals, Low Temperature Diamonds, Alexandrite, Benitoite, Musgravite, Serendibite, Grandidierite, Monazite, **Rhodplumsite**, Painite, Bromellite; **subsurface** — Low Temperature Diamonds, Platinum, Painite, Bromellite, Tritium. Motherlode always-mine rule. Pure defaults live in `intelligence`; user overrides live in `core` settings (validated) and are merged by the caller.
- Acceptance criteria:
  - Every matrix entry uses a canonical id that exists in 2.2 (compile-time); every entry carries a verification note (in-game observed / community-documented) in the table source.
  - Overrides persist and win over defaults; invalid overrides rejected (tested in core); defaults module is pure (no imports beyond `shared`).
- Verify by: `pnpm --filter @lodestar/intelligence test -- thresholds && pnpm --filter @lodestar/core test -- threshold-overrides`

#### Step 2.4 — MINE/SKIP verdict engine (TDD, pure)
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/intelligence/src/assay/verdict.ts` + tests
- Work: pure function `(prospect, thresholds, priceBook, method) → Verdict` where `Verdict = {call: MINE|SKIP, score, reasons: Reason[]}` — reasons are structured (`proportion-above-threshold`, `motherlode`, `price-weighted-value/t`, `content-tier`, `already-depleted`) so UI and TTS render them verbatim. Value/t computed against best known price via canonical ids. **Precedence is explicit: depleted (`Remaining = 0`) → SKIP beats motherlode; otherwise motherlode → MINE.**
- Acceptance criteria:
  - Exhaustive table-driven tests: motherlode → MINE; depleted motherlode → SKIP (precedence pinned); boundary at threshold; multi-material rocks pick dominant value; every reason code exercised.
- Verify by: `pnpm --filter @lodestar/intelligence test -- verdict`

#### Step 2.5 — Price book v1 (journal `Market.json` + `MarketSell`)
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/core/src/market/price-book.ts`, `packages/data/src/migrations/004-market.sql` + tests
- Work: migration 004 (`market_snapshots`, designed so Phase 4's additions are purely additive); ingest `Market.json` on dock + `MarketSell` events into per-commodity best-known prices (canonical ids via 2.2) with source + age; expose the `priceBook` consumed by 2.4. (Galaxy-wide sources widen in Phase 4 — same table, same interface.)
- Acceptance criteria:
  - Docking at a station in fixtures updates prices; verdict value/t changes accordingly (integration test); ages stamped; a `Market.json` naming-scheme fixture joins correctly to a prospect-event fixture (cross-source test).
- Verify by: `pnpm --filter @lodestar/core test -- price-book`

#### Step 2.6 — Assay orchestrator (live pipeline)
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/core/src/assay/orchestrator.ts` + tests
- Work: the runtime glue that makes Assay real (legal under §3.2 since `core` → `intelligence`): subscribes to prospect events on the bus → merges thresholds + overrides → calls the pure verdict engine with the live price book → persists the verdict + reasons onto the prospect row → emits `assay.verdict` (IPC + WS) → hands the callout to the speech queue (2.7, once present) → computes the **acted-on flag** (a `MiningRefined`/`AsteroidCracked` of the verdict commodity within the following window marks the prospect acted-on).
- Acceptance criteria:
  - Fixture replay end-to-end: prospect line in → verdict persisted + emitted with correct reasons (integration test on the real bus + temp DB).
  - Acted-on correlation pinned by fixtures (mined-after-MINE, ignored-SKIP); pipeline never blocks the bus (async, tested).
- Verify by: `pnpm --filter @lodestar/core test -- assay-orchestrator`

#### Step 2.7 — Piper TTS callouts (CPU) + sidecar supervisor
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/core/src/sidecar/supervisor.ts`, `packages/voice/src/tts/{piper.ts,speech-queue.ts}`, `apps/desktop/src/main/tts-service.ts`, Settings TTS section (test-phrase button, voice/volume) + tests
- Work: the **shared sidecar supervisor** (spawn, health, restart-on-crash policy, ordered shutdown — reused by ML/STT in Phases 6–7) with Piper as its first client. First-run download of the pinned Piper release + one voice model via the Step 0.10 artifact downloader (in-repo SHA-256) into `%APPDATA%/lodestar/voices/`. Speech queue with **named priority classes — `ops-echo > safety > alert > verdict > ambient` — where a higher class preempts lower-class backlog** (Phase 7's confirmation echo depends on this), dedupe, cancel-on-superseded-verdict. Verdict callouts ("Platinum thirty-two percent — mine"); settings toggle, voice pick, volume, test-phrase button. CPU only — no GPU flags.
- Acceptance criteria:
  - Queue semantics fully unit-tested (priority preemption across all five classes, dedupe, cancel); supervisor lifecycle (spawn/health/crash-restart/shutdown order) tested with a scripted fake sidecar and integration-tested against the real Piper binary.
  - Manual audio check via the Settings test-phrase button, documented.
- Verify by: `pnpm --filter @lodestar/voice test && pnpm --filter @lodestar/core test -- supervisor` + manual: Settings test phrase audible

#### Step 2.8 — Prospector statistics
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/core/src/session/prospect-stats.ts` + tests, session stats channel extension
- Work: rolling hit rate (MINE verdicts ÷ prospected), average best-material %, per-commodity distribution, motherlode count — live per session and persisted at session end.
- Acceptance criteria:
  - Golden fixture session yields hand-computed stats; stats stream over `session.stats` (tested).
- Verify by: `pnpm --filter @lodestar/core test -- prospect-stats`

#### Step 2.9 — Assay UI panel
- Status: [ ] TODO
- Zone: GREEN
- Files: `apps/desktop/src/renderer/screens/Assay.tsx`, `components/{VerdictCard,ReasonList,ProspectHistory}.tsx` + tests
- Work: the Assay screen — big MINE/SKIP verdict card (orange MINE / dim SKIP, animated on arrival), structured reasons, rock composition bars, last-N prospect history with outcomes, live hit-rate strip, and the pre-first-prospect empty state ("fire a prospector limpet").
- Acceptance criteria:
  - Component tests over fixture verdict streams including the empty state.
  - **Real-clock latency test:** journal-line-parsed → verdict-computed → IPC-delivered ≤ 150 ms p95 (integration test, real timers — no injected clock).
- Verify by: `pnpm --filter desktop test`

#### Step 2.10 — Overlay v1 (read-only, click-through)
- Status: [ ] TODO
- Zone: GREEN
- Files: `apps/desktop/src/main/overlay-window.ts`, `packages/overlay/src/{OverlayApp.tsx,VerdictHud.tsx,CargoStrip.tsx}` + tests
- Work: a frameless, transparent, always-on-top, `setIgnoreMouseEvents(true)` window subscribing to the Step 1.9 WS server (loopback-only, token-in-subprotocol per §5.6); shows latest verdict + cargo %. Toggle from Command Deck + global shortcut. Documented requirement: game in borderless-windowed mode.
- Acceptance criteria:
  - Overlay receives pushes with no IPC access to main internals (WS only — asserted); click-through verified manually over the running game; WS rejects connections lacking the token, and the token never appears in logs (both tested).
- Verify by: `pnpm --filter desktop test` + manual over-game check per `docs/verification/phase-2.md`

**Phase 2 Definition of Done:** prospecting a rock in-game produces a displayed MINE/SKIP verdict with reasons — detection-to-render p95 ≤ 250 ms measured on this machine (100 ms poll + ≤150 ms pipeline) — with the spoken callout beginning ≤ 750 ms after detection (manual protocol); verdicts persist with stats and show on the in-game overlay; all tests + compliance green.

---

### PHASE 3 — Manifest (Analytics)

**Goal:** deep session insight.
**Depends on:** Phase 1. **Compliance zone(s):** GREEN.

#### Step 3.1 — Historical query layer
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/core/src/analytics/{repository.ts,aggregates.ts}` + tests
- Work: repository + aggregate queries over sessions/prospects/refinements: list/filter sessions (date, system, ring, commodity), per-session detail, cross-session aggregates (totals, averages, trends). Pure SQL + mapping, tested against a seeded temp DB with known numbers.
- Acceptance criteria: every aggregate returns hand-computed golden values on the seed; every hot query's `EXPLAIN QUERY PLAN` uses an index (asserted in CI); wall-clock timing on a 1k-session seed recorded as a documented manual benchmark (§4.2), not a CI gate.
- Verify by: `pnpm --filter @lodestar/core test -- analytics`

#### Step 3.2 — Per-commodity & per-ring breakdowns
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/core/src/analytics/breakdowns.ts` + tests
- Work: tons + credits + tons/hr by commodity, by ring, by ring-type, by method; best-performing pairings surfaced (e.g. "Platinum @ <ring>: 142 t/hr").
- Acceptance criteria: golden tests on seeded data; handles sessions spanning multiple rings correctly (split by time-in-ring).
- Verify by: `pnpm --filter @lodestar/core test -- breakdowns`

#### Step 3.3 — Productivity heatmaps (data)
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/core/src/analytics/heatmaps.ts` + tests
- Work: heatmap matrices — hour-of-day × day-of-week productivity (tons/hr), and ring × commodity yield heat — as pure data transforms consumed by the UI.
- Acceptance criteria: matrix cells match hand-computed goldens including empty-cell semantics (null vs zero distinguished).
- Verify by: `pnpm --filter @lodestar/core test -- heatmaps`

#### Step 3.4 — Personal bests
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/core/src/analytics/personal-bests.ts`, `packages/data/src/migrations/005-personal-bests.sql` + tests
- Work: migration 005; tracked bests: best tons/hr session, best credits/hr, best single rock (value), longest session, most tons in a session — each with context (ship, ring, date), updated transactionally at session end, emitting a `session.newBest` event for UI celebration.
- Acceptance criteria: bests update only when beaten (tested at boundaries); context stored; event emitted exactly once per new best.
- Verify by: `pnpm --filter @lodestar/core test -- personal-bests`

#### Step 3.5 — Manifest dashboards UI
- Status: [ ] TODO
- Zone: GREEN
- Files: `apps/desktop/src/renderer/screens/Manifest.tsx`, `components/manifest/*` + tests
- Work: Recharts dashboards — session list with sparklines, session drill-down (timeline, commodity mix, rate curve), trends view, heatmap views (3.3), personal-best board. MFD-styled, keyboard navigable. Zero-session first-run state designed explicitly (what a new user sees before their first mining run).
- Acceptance criteria: component tests over seeded fixture data **and** the zero-data state; every §Phase-3 data feature reachable in the UI.
- Verify by: `pnpm --filter desktop test`

#### Step 3.6 — CSV export
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/core/src/analytics/csv-export.ts`, save-dialog wiring + tests
- Work: RFC-4180-compliant CSV export for sessions / prospects / refinements with header rows, proper quoting/escaping, UTF-8 BOM option for Excel; export via native save dialog.
- Acceptance criteria: exports re-parse to identical data (round-trip test); quoting edge cases (commas, quotes, newlines in ring names) covered.
- Verify by: `pnpm --filter @lodestar/core test -- csv`

#### Step 3.7 — Limpet efficiency + time split
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/core/src/analytics/{limpets.ts,time-split.ts}` + tests
- Work: limpet efficiency and travel-vs-mining time segmentation (from the Phase-1 activity classifier) per session + trend. **Definition of record (journals emit no per-fragment collection events):** collector productivity = tons refined ÷ collection limpets launched; prospector spend = prospector limpets launched; both labeled exactly so in the UI — no fabricated "collected" count.
- Acceptance criteria: golden fixture session yields exact expected productivity + split per the definitions above; limpets remaining at session end reconciled against cargo (tested).
- Verify by: `pnpm --filter @lodestar/core test -- limpets time-split`

**Phase 3 Definition of Done:** Manifest renders history, breakdowns, heatmaps, bests, limpet efficiency, and time split from real accumulated data; CSV round-trips; all green.

---

### PHASE 4 — Intelligence Engine (Layer 1)

**Goal:** the deterministic brain — hotspots, prices, plans.
**Depends on:** Phases 1, 3. **Compliance zone(s):** GREEN.

#### Step 4.1 — Galaxy reference schema + repositories
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/data/src/migrations/006-galaxy.sql`, `packages/data/src/repositories/{systems,stations,bodies,rings,hotspots,overlaps,runs}.ts` + tests
- Work: migration 006 creating `systems`, `stations`, `bodies`, `rings`, `hotspots`, `overlaps`, `runs` and extending `market_snapshots` **additively only** (`ADD COLUMN` + new indexes — no rebuild of a table already holding Phase 2–3 user data) with indexes for the hot queries (spatial distance via stored coords, ring lookups, price-by-commodity); typed repositories.
- Acceptance criteria: repository CRUD + hot-query plans verified (`EXPLAIN QUERY PLAN` uses indexes — asserted in test); migration 006 applies cleanly over a DB populated with Phase-2 fixture data (tested); distance-query wall-clock over 20k seeded systems recorded as a documented manual benchmark.
- Verify by: `pnpm --filter @lodestar/data test -- galaxy`

#### Step 4.2 — Hotspot seed dataset + import
- Status: [ ] TODO
- Zone: GREEN
- Files: `resources/seed/hotspots-seed.json`, `resources/seed/PROVENANCE.md`, `packages/data/src/seed-import.ts` + tests
- Work: a clean-room seed dataset of well-known, publicly documented mining locations (famous rings/hotspots that are common community knowledge, e.g. widely published Platinum/Painite/LTD sites), each entry carrying an explicit provenance note; import pipeline into `rings`/`hotspots` with `source='seed'`. **No data files copied from other tools.** The DB grows primarily from the player's own `SAASignalsFound` scans (4.3) and later community sync (Phase 10).
- Acceptance criteria: every seed entry has provenance; import is idempotent; `PROVENANCE.md` states the clean-room policy and lists sources.
- Verify by: `pnpm --filter @lodestar/data test -- seed`

#### Step 4.3 — Hotspot recorder from own scans
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/core/src/journal/events/{saa-signals.ts,scan.ts}`, `packages/core/src/hotspots/recorder.ts` + tests
- Work: (recorder lives in `core` — it does I/O; `intelligence` stays pure): `SAASignalsFound` → upsert ring + hotspot rows (`source='journal'`, `last_confirmed` refresh on re-scan), **filtering out non-mineral signal types** (`$SAA_SignalType_Biological;` etc. — the same event fires for planetary surface signals), ring identity parsed from the `BodyName` `"… A Ring"` suffix; `Scan` events supply ring type (`RingClass`, tolerating the game's `eRingClass_Metalic` misspelling) and `ReserveLevel` — the only journal source of both; rings linked to bodies/systems from current location state.
- Acceptance criteria: fixture scan events create/update the right rows; biological/geological signals create nothing (tested); re-scan refreshes confirmation without duplicating; a `Scan` fixture populates ring type + reserve consumed by scoring (tested end-to-end with 4.5).
- Verify by: `pnpm --filter @lodestar/core test -- recorder`

#### Step 4.4 — Overlap model + candidate detection
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/intelligence/src/hotspots/overlaps.ts` + tests
- Work: honest overlap modeling — journals expose hotspot *counts*, not positions, so co-located hotspots are epistemically invisible from scan data alone. LODESTAR distinguishes: **confirmed overlaps** (user marks one in the UI after seeing it in-game, or community-sourced with confidence) vs **candidates** — multi-hotspot rings where overlap is *possible*, listed **unranked** (signal counts carry zero positional information, so no likelihood claims). Multiplicity, commodities, confidence, provenance per §5.5. The scoring function consumes confirmed overlaps with multipliers; candidates surface only as a "possible — verify in ring" badge, never a score boost. The `overlap_multiplier` values are verified against current game mechanics (post-Update-14 yields) before shipping.
- Acceptance criteria: candidate flagging + confirmation transitions fully tested; a confirmed overlap outranks the same ring unconfirmed (integration with 4.5 tested); candidates provably contribute no score boost (tested).
- Verify by: `pnpm --filter @lodestar/intelligence test -- overlaps`

#### Step 4.5 — Hotspot scoring function (TDD, pure)
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/intelligence/src/scoring/{score.ts,weights.ts}` + tests
- Work: `score = price × overlap_multiplier × reserve_weight × ring_match − distance_penalty − sell_leg_penalty` as a pure function over typed inputs, with the default weight vector in `weights.ts` (versioned — Phase 6 calibration will own updates); every term individually computed + exposed for UI explanation ("why this score").
- Acceptance criteria: property tests (monotonicity: higher price ⇒ ≥ score, farther ⇒ ≤ score, Pristine ≥ Depleted, etc.); golden ranking over a fixture galaxy matches hand-ordering; term breakdown sums exactly to the score.
- Verify by: `pnpm --filter @lodestar/intelligence test -- scoring`

#### Step 4.6 — Gateway client features (cache, rate limits, backoff)
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/integrations/src/gateway/{rate-limiter.ts,cache.ts,backoff.ts}` + tests, compliance-suite extension
- Work: build the client-quality layer onto the Step 0.10 enforcement core: per-host token buckets (§5.3 policies), SQLite response cache with TTL + ETag/`If-Modified-Since`, exponential backoff with jitter on 429/5xx, data-age stamping on every payload. All Phase-4+ clients consume the gateway exclusively (lint rule from 0.10 already bans direct fetch).
- Acceptance criteria: rate limiting, cache TTL/ETag, and backoff each tested against a local fake server; compliance suite re-runs the 0.10 refusal tests plus the deny-with-prejudice list (`api.openai.com`, `api.anthropic.com`, …) against the full gateway.
- Verify by: `pnpm --filter @lodestar/integrations test && pnpm compliance`

#### Step 4.7 — EDSM client
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/integrations/src/edsm/*.ts` + tests (recorded fixtures + local fake server)
- Work: sphere/cube system search, bodies + rings (type, reserve) enrichment for candidate systems, coordinate backfill — through the gateway, into the galaxy tables with `source='edsm'` + age stamps.
- Acceptance criteria: recorded-payload fixtures parse correctly; enrichment fills ring reserve levels used by scoring; 429 handling verified against the fake server.
- Verify by: `pnpm --filter @lodestar/integrations test -- edsm`

#### Step 4.8 — EDDN listener
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/integrations/src/eddn/{listener.ts,commodity-schema.ts}` + tests
- Work: ZeroMQ SUB to `tcp://eddn.edcd.io:9500`, zlib inflate, schema validation of `commodity/3` messages, filtered ingestion (mining-relevant commodities, canonical ids via 2.2) into `market_snapshots` with source timestamps; reconnect with backoff; kill-switch setting. **EDDN is an unauthenticated open firehose — spoofable by design:** ingestion applies plausibility bounds (price within historical band per commodity, sane demand values) and outlier rejection; EDDN-sourced prices are advisory — the Ledger's actual sell recommendation weights first-party sources (own journal `Market.json`, cAPI) above EDDN when they conflict (4.11).
- Acceptance criteria: recorded EDDN frames decode + ingest correctly; malformed frames dropped with telemetry; implausible-price fixtures (10× band, negative, NaN) rejected (tested); reconnect tested against a local fake ZMQ publisher; ingestion volume bounded (rate + retention policy tested).
- Verify by: `pnpm --filter @lodestar/integrations test -- eddn`

#### Step 4.9 — Inara client (feature-flagged)
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/integrations/src/inara/*.ts` + tests
- Work: inapi/v1 client (API key from secrets; disabled without one), market-reference queries batched per Inara's terms, ingestion with `source='inara'`.
- Acceptance criteria: disabled-without-key behavior tested; batching + rate policy (§5.3) enforced in tests; recorded fixtures parse.
- Verify by: `pnpm --filter @lodestar/integrations test -- inara`

#### Step 4.10 — Frontier cAPI (OAuth PKCE, feature-flagged)
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/integrations/src/capi/{oauth.ts,client.ts}` + tests
- Work: OAuth2 + PKCE flow (system browser + loopback redirect), encrypted token storage + refresh, `/profile` + `/market` fetch. Ships behind a feature flag until Frontier client-id approval (§9) — the whole module is real and tested against a local fake of the Frontier endpoints; the flag only gates exposure in Settings.
- Acceptance criteria: PKCE flow verified against the fake (code challenge, state, refresh, token expiry); tokens only ever in `safeStorage`; flag-off hides UI and prevents any network attempt (tested).
- Verify by: `pnpm --filter @lodestar/integrations test -- capi`

#### Step 4.11 — Ledger (best sell station, trends) + alert framework
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/intelligence/src/ledger/{best-sell.ts,trends.ts}` (pure — operate on passed-in snapshot arrays), `packages/core/src/{market/ledger-service.ts,alerts/alert-engine.ts}`, `packages/data/src/migrations/007-alert-rules.sql`, `apps/desktop/src/renderer/screens/Ledger.tsx` + tests
- Work: best-sell-station ranking and trend series as pure `intelligence` functions (demand-aware, pad-size + distance filters, freshness-weighted, **first-party sources outrank conflicting EDDN data for the sell recommendation**); `core` service feeds them from `market_snapshots` and persists results. Plus the **alert framework** (migration 007 `alert_rules`): rule types = price threshold **and session alerts (cargo-full % — the trigger for §1.1's sell leg)**, per-rule cooldowns, dedupe, delivery via notification + TTS at the `alert` priority class (2.7); wing hooks register into this framework in Phase 9. Ledger UI: commodity board, station ranking with data-age badges, trend charts, alert manager.
- Acceptance criteria: ranking golden tests (freshness beats stale-but-higher when configured; journal-sourced price beats conflicting EDDN price); alert fires exactly once per crossing, honors cooldown, cargo-full alert fires at the configured % (each tested); UI shows source + age for every price.
- Verify by: `pnpm --filter @lodestar/intelligence test -- ledger && pnpm --filter @lodestar/core test -- alerts && pnpm --filter desktop test`

#### Step 4.12 — Cartographer (round-trip planner)
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/integrations/src/spansh/*.ts`, `packages/intelligence/src/planner/{run-planner.ts,strategies.ts}` (pure), `packages/core/src/planner/plan-service.ts` (fetch + persist), `apps/desktop/src/renderer/screens/Cartographer.tsx` + tests
- Work: Spansh routing client (async job API through the gateway); the round-trip run planner as pure `intelligence` functions combining hotspot score + Ledger sell pick + passed-in route legs into a full plan (mine here → sell there → return), with three strategies: **Max Profit / Min Time / Safest** (safest = avoid low-security systems + minimize legs); the `core` plan service orchestrates Spansh calls and persists plans to `runs` with estimates. UI: strategy picker, plan cards with leg-by-leg breakdown, **copy-to-clipboard for the player to paste into the galaxy map — explicitly no injection into the game.**
- Acceptance criteria: strategy orderings verified on fixture galaxies (profit ranks by cr/hr estimate, time by duration, safest by risk metric); plan estimate math golden-tested; clipboard payload is plain system names.
- Verify by: `pnpm --filter @lodestar/intelligence test -- planner && pnpm --filter desktop test`

#### Step 4.13 — Vein Finder UI + filters
- Status: [ ] TODO
- Zone: GREEN
- Files: `apps/desktop/src/renderer/screens/VeinFinder.tsx`, `components/veinfinder/*` + tests
- Work: the hotspot intelligence screen — ranked list with full score breakdowns ("why"), filters (max distance, reserve level, ring type, pad size, max sell-leg), overlap badges (confirmed vs "possible — verify in ring"), data-age indicators, "plan this" handoff to Cartographer, and the seed-only first-run state (before the player has scanned anything).
- Acceptance criteria: filters compose correctly (tested); score breakdown matches 4.5 terms exactly; handoff pre-fills the planner; seed-only state renders with provenance labeling (tested).
- Verify by: `pnpm --filter desktop test`

#### Step 4.14 — 3D ring/hotspot map
- Status: [ ] TODO
- Zone: GREEN
- Files: `apps/desktop/src/renderer/components/ringmap/*` (react-three-fiber) + tests
- Work: 3D visualization — ring annulus with hotspot markers (sized by count, colored by commodity), overlap highlights, camera orbit/zoom, selection syncing with Vein Finder; degrades gracefully on weak GPUs (pixel-ratio clamp) — renders on whatever GPU the OS gives Electron; never touches CUDA.
- Acceptance criteria: scene graph logic (marker placement math, selection) unit-tested headlessly; frame rate with 200 markers recorded as a documented manual benchmark (target 60 fps on this machine — §4.2 manual-verification category, not a CI gate); no WebGL crash without hardware acceleration (falls back to a labeled 2D ring schematic — a real implemented fallback, not a dead end).
- Verify by: `pnpm --filter desktop test` + manual fps check per `docs/verification/phase-4.md`

#### Step 4.15 — Outfitter (loadout advisor)
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/intelligence/src/outfitter/{templates.ts,advisor.ts}`, `apps/desktop/src/renderer/screens/Outfitter.tsx` + tests
- Work: per-method reference loadouts (laser / deep-core / subsurface: lasers vs PWA+seismic+abrasion, limpet mix, refinery class, cargo/shield tradeoffs) parameterized by ship; advisor compares the player's current `Loadout` journal data against the target commodity/method and lists concrete gaps ("no Pulse Wave Analyser — required for deep-core").
- Acceptance criteria: gap analysis correct for fixture loadouts across all three methods (tested); recommendations never name modules that don't fit the ship's slots (validated against slot sizes).
- Verify by: `pnpm --filter @lodestar/intelligence test -- outfitter && pnpm --filter desktop test`

**Phase 4 Definition of Done:** ask Vein Finder for the best Platinum spot within 100 ly and get a scored, explained, filterable answer with a sell station and a full copyable round-trip plan; prices flow from journal + EDDN (+ Inara/cAPI when keyed); compliance suite extended and green.

---

### PHASE 5 — Commander's Assistant (Layer 2 — local Ollama)

**Goal:** talk to LODESTAR.
**Depends on:** Phase 4. **Compliance zone(s):** GREEN.

#### Step 5.1 — Ollama service manager + GPU pinning
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/ai/src/ollama/{service-manager.ts,gpu.ts}` + tests
- Work: **detect → validate → instruct** (LODESTAR cannot inject env into an already-running Ollama tray service): detect the local install/endpoint; manage model presence (pull of the configured default — Qwen2.5-7B-Instruct Q4_K_M — requested via the Step 0.10 downloader policy, verified against a **committed digest**, not just the registry manifest); `gpu.ts` parses `nvidia-smi --query-gpu=uuid,memory.used --format=csv` and asserts the configured AI-GPU **UUID** is where allocation lands after first load; wrong card → actionable instructions (set user-level `CUDA_VISIBLE_DEVICES=GPU-5612e762-…` + restart Ollama), spawning LODESTAR's own pinned `ollama serve` only when nothing owns port 11434; `keep_alive` policy applied from settings. Adds the Ollama probe to `app.health` (status-bar indicator lights up from this phase).
- Acceptance criteria: manager states (not-installed / installed-no-model / ready / wrong-gpu) each tested against a fake; wrong-GPU detection produces the actionable instruction flow, never silent fallback; digest mismatch refuses the model; real-machine verification records `nvidia-smi` before/after model load showing allocation on the RTX 3060 only.
- Verify by: `pnpm --filter @lodestar/ai test -- service-manager` + manual GPU check per `docs/verification/phase-5.md`

#### Step 5.2 — Ollama chat client (streaming + tools)
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/ai/src/ollama/client.ts` + tests (local fake implementing the Ollama HTTP contract)
- Work: `/api/chat` client with streaming tokens, tool-call message parsing, context-window accounting, abort; endpoint restricted to a **literal loopback IP per §5.3's loopback rule** (hostnames — including `localhost` — rejected; resolved peer re-verified at connect; non-loopback unrepresentable in the config type and refused at runtime — compliance-tested with the §5.4 bypass fixtures).
- Acceptance criteria: streaming, tool-call roundtrip, abort, and context-overflow behavior tested against the fake; every loopback-bypass fixture (`localhost.attacker.com`, `127.0.0.1@evil.com`, hex/decimal encodings, hosts-file-style `localhost` repoint) rejected (tests).
- Verify by: `pnpm --filter @lodestar/ai test -- client`

#### Step 5.3 — Tool registry (Layer-1 functions as tools)
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/ai/src/tools/{registry.ts,schemas.ts,executor.ts}` + tests
- Work: JSON-schema tool definitions for `find_hotspots`, `plan_run`, `best_sell_station`, `analyze_session`, `query_history`, `get_personal_bests`, `get_price_trends`, `recommend_loadout`, `get_status` (ship/session — carrier/wing tools `get_carrier_status`/`get_wing_board`/`plan_carrier_expedition` register in Phases 8–9 via the same registry); executor validates arguments against schemas, calls the real Layer-1 functions, returns structured results; unknown tool / invalid args → structured error the model can recover from. **The registry is a frozen read-only allowlist:** a compliance test enumerates registered tools against the committed list and fails on any addition of a tool with side effects (writes, emissions, settings changes) — and the `ai`→`voice`/bridge import firewall (§3.2) is compliance-tested here.
- Acceptance criteria: every tool schema round-trips against its Layer-1 signature (compile-time typed + runtime validated); executor rejects malformed args with recoverable errors (tested); registry is the only path from `ai` into `intelligence` (lint-enforced); frozen-allowlist + firewall compliance tests in place and demonstrated with violating fixtures.
- Verify by: `pnpm --filter @lodestar/ai test -- tools`

#### Step 5.4 — Orchestration loop + numeric-grounding guard
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/ai/src/assistant/{orchestrator.ts,grounding.ts,system-prompt.ts}` + tests
- Work: the assistant loop — NL in → model → tool calls (executed, results appended) → narration out, multi-step capable with a hard cap on tool rounds; **grounding guard:** every numeric/factual claim class (prices, scores, tons, distances) in the final narration is checked against the turn's tool results — ungrounded numbers cause a single regeneration with corrective instruction, then honest degradation to a tool-result table (real, implemented behavior). System prompt states the compliance identity (plans/coaches, never controls) and journal-content injection resistance rules (§4.8 red-team scope).
- Acceptance criteria: multi-tool scenarios tested against the fake (plan → sell → narrate); grounding guard catches a seeded hallucinated price (test); prompt-injection fixture (hostile ring name in journal data) does not alter tool policy (test).
- Verify by: `pnpm --filter @lodestar/ai test -- assistant`

#### Step 5.5 — Chat UI with inline tool-call transparency
- Status: [ ] TODO
- Zone: GREEN
- Files: `apps/desktop/src/renderer/screens/Assistant.tsx`, `components/assistant/{ChatThread,ToolCallCard,StreamingMessage}.tsx`, `packages/data/src/migrations/008-chat.sql` + tests
- Work: chat screen streaming tokens live; every tool call rendered inline as an expandable card (name, args, result summary) in execution order; conversation persisted per session (migration 008, `chat_messages`); model/VRAM status strip (from 5.1/5.8); degraded states designed: Ollama not installed / model absent / **Ollama dies mid-conversation** (stream aborts cleanly, message marked interrupted, retry affordance — a real recovery path).
- Acceptance criteria: tool cards appear in order with args/results (component-tested from fixture transcripts); streaming renders incrementally; history survives app restart; the mid-stream-death path tested against the fake (kill during stream).
- Verify by: `pnpm --filter desktop test`

#### Step 5.6 — Session debriefs
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/ai/src/assistant/debrief.ts` + tests
- Work: `analyze_session` tool over Manifest aggregates + a debrief generator producing the structured summary (tons, credits/hr, best rock, ring, notable events) — grounded via 5.4; rendered at session end in the Assistant and stored with the session. (Discord posting arrives in Phase 10 on top of this exact artifact.)
- Acceptance criteria: debrief numbers all appear in tool results (grounding test); generated for a fixture session end-to-end against the fake model.
- Verify by: `pnpm --filter @lodestar/ai test -- debrief`

#### Step 5.7 — No-cloud enforcement (compliance)
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/compliance/src/no-cloud-ai.test.ts` (extension)
- Work: compliance suite gains: (a) static — `@lodestar/ai`, `@lodestar/ml`, `@lodestar/voice` import graphs contain no network module besides the loopback-typed Ollama client / sidecar stdio; (b) runtime — a network recorder wraps **every outbound-capable module** (assistant chat turn, EDDN listener, community sync, wing client, Discord poster, downloader idle) and shows zero non-loopback connections outside the §5.4 allowlist, including redirect targets; (c) the §5.4 deny-with-prejudice host test plus the positive unknown-constructed-host refusal test.
- Acceptance criteria: every enforcement layer red when violated (each proven by a violating fixture) and green on the real tree.
- Verify by: `pnpm compliance`

#### Step 5.8 — VRAM-aware model loading
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/ai/src/ollama/vram-guard.ts` + tests
- Work: preflight before any model load: query free VRAM on the AI GPU (`nvidia-smi` per-UUID), compare against the model's known footprint + §8.2 reserve; insufficient → refuse with an actionable message (what's using the card, how to free it) rather than spilling to shared memory; post-load verification records actual usage into the §8.2 table maintenance note.
- Acceptance criteria: guard decisions tested across simulated VRAM states (free / whisper-loaded / foreign process); refusal message includes the offending process name.
- Verify by: `pnpm --filter @lodestar/ai test -- vram`

**Phase 5 Definition of Done:** "find me the best platinum spot under 80 ly and plan a run" produces visible tool calls into Layer 1 and a grounded narrated plan, streamed from a model provably running on the 3060 (12 GB) with zero cloud traffic; compliance suite proves it stays that way.

---

### PHASE 6 — Local ML (Layer 3) + Yield Calibration

**Goal:** self-improving predictions, all on-GPU, all local.
**Depends on:** Phases 4, 5, accumulated run data. **Compliance zone(s):** GREEN.

#### Step 6.1 — Training dataset extraction
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/ml/src/datasets/{yield-dataset.ts,prospect-dataset.ts}` + tests
- Work: deterministic, versioned feature extraction from SQLite → training frames: yield rows (ring type, reserve, hotspot commodity/overlap, method, ship class, session tons/hr) and prospect rows (materials vector, content tier, motherlode, verdict-followed outcome). **Provenance-aware (§8.4's "own data only" is enforced, not assumed): hotspot/overlap context enters features only from `source='journal'` or player-confirmed rows — `community` and `seed` provenance are excluded from all training frames**, closing the community-data→model-poisoning path. Dataset version hash recorded; minimum-row thresholds defined (below them, training refuses with an explicit "insufficient data (have N, need M)" result surfaced in the UI — honest behavior, not a stub).
- Acceptance criteria: extraction is deterministic (same DB ⇒ same hash); leakage checks (no post-outcome fields in features — asserted structurally); threshold refusal path tested; a DB seeded with community-provenance hotspot rows produces training frames containing zero community-derived feature values (tested).
- Verify by: `pnpm --filter @lodestar/ml test -- datasets`

#### Step 6.2 — ML sidecar (Python, GPU-pinned)
- Status: [ ] TODO
- Zone: GREEN
- Files: `services/ml-sidecar/{pyproject.toml,src/lodestar_ml/*.py,tests/*}`, `packages/ml/src/sidecar-client.ts` + tests
- Work: Python sidecar (pinned venv bootstrapped by a checked-in script; PyTorch CUDA build) speaking §5.6 stdio JSON-RPC: `health` (returns torch device + GPU UUID — must match config or the sidecar exits nonzero), `train`, `predict`; env forced to `CUDA_DEVICE_ORDER=PCI_BUS_ID`, `CUDA_VISIBLE_DEVICES=1`. TS client with lifecycle management (spawn, health, restart-on-crash, shutdown). Python side has its own pytest suite.
- Acceptance criteria: health/UUID assertion tested both sides (wrong UUID → refusal); RPC round-trip integration test with the real sidecar on this machine confirms CUDA device = RTX 3060; crash-restart tested.
- Verify by: `pnpm --filter @lodestar/ml test && (cd services/ml-sidecar && uv run pytest)`

#### Step 6.3 — Yield predictor
- Status: [ ] TODO
- Zone: GREEN
- Files: `services/ml-sidecar/src/lodestar_ml/yield_model.py` + tests, `packages/ml/src/yield-predictor.ts`, `packages/data/src/migrations/009-ml-models.sql` + tests
- Work: gradient-boosted / shallow-MLP regressor: features (6.1) → expected tons/hr with a prediction interval; time-based train/validation split; metrics (MAE, calibration of the interval) returned from `train`; model artifacts saved under the local registry dir; migration 009 (`ml_models`) + registry activation (§5.5).
- Acceptance criteria: on a synthetic dataset with known structure the model beats the naive mean baseline by a tested margin; interval coverage ≈ nominal (tested statistically); artifacts + metrics land in the registry; prediction path works end-to-end from TS.
- Verify by: `pnpm --filter @lodestar/ml test -- yield && (cd services/ml-sidecar && uv run pytest -k yield)`

#### Step 6.4 — Prospector "worth-it" classifier
- Status: [ ] TODO
- Zone: GREEN
- Files: `services/ml-sidecar/src/lodestar_ml/prospect_model.py` + tests, `packages/ml/src/prospect-classifier.ts`, Assay integration + tests
- Work: classifier estimating P(rock is worth mining | materials, context) trained on followed-verdict outcomes; integrates into Assay as an **advisory** reason line ("ML: 87% worth-it") alongside — never replacing — the deterministic verdict; disabled automatically below the data threshold.
- Acceptance criteria: AUC beats the threshold-rule baseline on held-out synthetic data (tested); Assay reason line appears only when a trained model is active; deterministic verdict unchanged by ML availability (tested).
- Verify by: `pnpm --filter @lodestar/ml test -- prospect`

#### Step 6.5 — Bayesian yield-calibration loop
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/ml/src/calibration/{bayes.ts,updater.ts}`, `packages/data/src/migrations/010-calibration.sql` + tests
- Work: the §8.5 math implemented exactly: conjugate Bayesian linear regression over score-model features with Normal-Inverse-Gamma posterior; after each qualifying run (≥ 15 min mining, ≥ 8 prospected rocks, completed sell) the observed log(tons/hr) updates the posterior; weight vector = posterior mean, clamped to §8.5 bounds; every update versioned in `calibration_weights` with one-click rollback.
- Acceptance criteria: posterior updates match a reference implementation on golden data to 1e-9; convergence test (synthetic runs from known weights recover them); bounds + rollback tested; non-qualifying runs excluded (tested).
- Verify by: `pnpm --filter @lodestar/ml test -- calibration`

#### Step 6.6 — Calibration → Layer 1 integration + transparency UI
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/intelligence/src/scoring/weights.ts` (loader), `apps/desktop/src/renderer/screens/settings/CalibrationPanel.tsx` + tests
- Work: scoring reads the active `calibration_weights` vector (falling back to shipped defaults when none); UI panel shows current weights vs defaults, update history with the runs that caused them, estimate-vs-actual scatter, and rollback control.
- Acceptance criteria: score changes when weights change (integration test); UI renders history from fixtures; rollback restores prior ranking (tested).
- Verify by: `pnpm --filter @lodestar/intelligence test -- weights && pnpm --filter desktop test`

#### Step 6.7 — Retraining pipeline + cadence
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/ml/src/pipeline/retrain.ts` + tests
- Work: retraining orchestration — manual trigger (Settings) + automatic after every N=10 new qualifying runs; runs 6.1→6.3/6.4 through the sidecar, evaluates against the active model, activates only on improvement (else records the attempt with metrics); all artifacts local; never scheduled while the game+voice are active (VRAM guard 5.8 consulted).
- Acceptance criteria: improve-to-activate and worse-stays-inactive paths tested; VRAM-busy deferral tested; cadence counter correct across restarts.
- Verify by: `pnpm --filter @lodestar/ml test -- retrain`

**Phase 6 Definition of Done:** after accumulated runs, LODESTAR's plan estimates visibly self-correct (calibration history shows shrinking estimate-vs-actual error on fixture streams); ML advisories appear in Assay; everything trains and infers on the local 3060 with the compliance suite proving no data egress.

---

### PHASE 7 — Voice & Overlay (Yellow Zone)

**Goal:** hands-on assistance within hard guardrails.
**Depends on:** Phases 2, 5. **Compliance zone(s):** YELLOW (voice→keybind), GREEN (overlay display).

#### Step 7.1 — faster-whisper STT sidecar (load-on-demand)
- Status: [ ] TODO
- Zone: GREEN (transcription itself commands nothing)
- Files: `services/stt-sidecar/*` (Python, pytest), `packages/voice/src/stt/{client.ts,lifecycle.ts}` + tests
- Work: faster-whisper `small` int8 on the AI GPU (same env pinning + UUID assertion as 6.2); push-to-talk and wake-word-free by default (mic streams only while the user holds the configured PTT key — privacy by construction); model loads on voice-enable, unloads after 60 s idle (§8.2); stdio streaming transcribe RPC.
- Acceptance criteria: load/unload lifecycle honors the VRAM policy (tested with the guard from 5.8); UUID assertion; transcription accuracy spot-checked on recorded phrases (WER < 15% on the command grammar — measured, recorded); mic never opens outside PTT hold (tested at the client layer).
- Verify by: `pnpm --filter @lodestar/voice test && (cd services/stt-sidecar && uv run pytest)`

#### Step 7.2 — ED bindings parser
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/voice/src/bindings/{binds-parser.ts,binding-map.ts}` + tests
- Work: parse the game's `.binds` XML (Custom.4.x from `%LOCALAPPDATA%\Frontier Developments\Elite Dangerous\Options\Bindings`) into an action→key map; classify every game action as `ALLOWED` (discrete, non-flight, non-weapon: e.g. cargo scoop, lights, night vision, **a single fire-group-cycle press** — Elite has no "select group N" bind, only cycle next/previous; multi-press selection would be chaining, so one cycle press per command is the entire feature — panel focus) or `FORBIDDEN` (weapons/mining-tool fire, thrust/throttle/rotation/any flight axis, FSD jump, docking requests, menu confirm sequences, **and explicitly: the Supercruise Assist toggle, Docking Computer engage, and any autopilot/route-following bind — per §2.3, LODESTAR must never be the thing that engages autonomous flight**) in a **checked-in exhaustive classification table** — unknown/unclassified actions default FORBIDDEN.
- Acceptance criteria: real bindings files parse; the classification table covers every action id present in fixture bindings; unknown action → FORBIDDEN (tested); Supercruise-Assist/Docking-Computer/autopilot binds are FORBIDDEN entries pinned by named tests.
- Verify by: `pnpm --filter @lodestar/voice test -- bindings`

#### Step 7.3 — Guardrailed single-action keybind emitter
- Status: [ ] TODO
- Zone: YELLOW
- Files: `packages/voice/src/bridge/{emitter.ts,guard.ts}` + tests (this is the most red-team-tested code in the repo)
- Work: the only synthetic-input code in LODESTAR: an in-repo native addon whose **native layer itself accepts exactly one virtual-key code per call and physically cannot express sequences, holds, or mouse input** (defense in depth below the TS wrapper), wrapped by a public API accepting **exactly one** `AllowedAction` per call — no arrays, no queue, no scheduling, no repeat parameter (unrepresentable by type). Guard enforces at runtime: action ∈ ALLOWED table; **exactly one emission per PTT keydown→keyup cycle — a second action requires releasing and re-pressing PTT** (the primary discrete-human-command guarantee); ≥ 1500 ms since last emission (secondary floor); system is **armed** (7.5) and player-present; game window is foreground; every emission written to an append-only audit log. Any violated condition → refusal with reason. CI proves the guard logic; the real foreground/presence/SendInput path has a documented manual red-team session (CI cannot exercise real window focus).
- Acceptance criteria: red-team test suite attempts — chaining via rapid calls, **continuous PTT hold with a repeated phrase (must yield exactly one emission)**, FORBIDDEN action, unarmed emission, background-window emission, replaying audit entries — every one refused (each a named test); native API surface reviewed to confirm sequences are unrepresentable at both layers; audit log is append-only (tested); manual red-team session performed and recorded.
- Verify by: `pnpm --filter @lodestar/voice test -- bridge && pnpm compliance`

#### Step 7.4 — Voice intent grammar
- Status: [ ] TODO
- Zone: YELLOW
- Files: `packages/voice/src/intents/{grammar.ts,matcher.ts}` + tests
- Work: a **closed** phrase grammar (no free-form command synthesis): each phrase maps to exactly one AllowedAction or one app-level action (app actions — "open vein finder", "read cargo" — are GREEN and unrestricted); fuzzy matching with a confidence threshold below which nothing happens except a TTS "say again"; duplicate matches within one PTT hold debounced (one emission per hold, per 7.3); every game-action match is echoed via TTS *before* emission ("cargo scoop — confirmed") at the `ops-echo` priority class (preempts any callout backlog, per 2.7) with a veto window setting (off = immediate single emission, still one action).
- Acceptance criteria: grammar closed-world (unknown phrase ⇒ no action — tested); confidence gate tested; one utterance/one PTT hold can never yield more than one game action (structural + test); TTS echo precedes emission in the event order and preempts a seeded callout backlog (tested).
- Verify by: `pnpm --filter @lodestar/voice test -- intents`

#### Step 7.5 — Arming model + player presence
- Status: [ ] TODO
- Zone: YELLOW
- Files: `packages/voice/src/bridge/arming.ts`, Ops IPC channels + tests
- Work: voice game-actions require an **explicit arm** (UI toggle or hotkey), auto-disarm after 30 min, on game exit, on `GuiFocus` ≠ cockpit for > 60 s, or on staleness of the game's liveness signals. **The staleness threshold is empirically calibrated first:** Status.json may rewrite on state-change rather than a fixed cadence, so this step starts by recording real write cadence during steady flight and sets the disarm threshold from measurements, corroborated by game-process presence + journal activity — a spurious-disarm-every-quiet-minute design would train users to re-arm reflexively and erode the safety property. Presence check uses `Flags` bit 24 (InMainShip) per §5.2. Arming state changes are TTS-announced and audit-logged. App-level voice (queries) works unarmed.
- Acceptance criteria: every auto-disarm trigger tested; the calibration measurement is recorded in `docs/verification/phase-7.md` and the chosen threshold cites it; steady-flight fixture (sparse Status writes) does NOT disarm (tested); disarmed emission attempts refused by 7.3's guard (integration test).
- Verify by: `pnpm --filter @lodestar/voice test -- arming`

#### Step 7.6 — Ops screen
- Status: [ ] TODO
- Zone: YELLOW (management UI for it; GREEN rendering)
- Files: `apps/desktop/src/renderer/screens/Ops.tsx`, `components/ops/*` + tests
- Work: arm/disarm control with unmistakable state display, the phrase list with per-phrase bound key (from 7.2) and zone labeling, the emission audit log viewer, PTT key + veto-window settings, mic level meter, STT model load state.
- Acceptance criteria: audit log renders real entries; arm state always matches the bridge (single source — tested); every phrase shows its classification.
- Verify by: `pnpm --filter desktop test`

#### Step 7.7 — Full Overlay HUD
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/overlay/src/{HudLayout.tsx,NextBestRock.tsx,SessionStrip.tsx,HotspotMinimap.tsx}` + tests
- Work: the complete glanceable HUD: Assay verdict + reasons, **best-recent-prospect summary** (from prospect history + ML advisory — journals expose no per-rock positions, so no "go back to rock X" navigation claims), cargo %, session credits/hr + tons/hr, hotspot minimap (2D ring schematic of the ring's hotspot inventory — no in-ring player position, which journals don't provide), layout editor (drag panels, saved per profile), opacity control. Display-only, click-through, token-authenticated WS as in 2.10.
- Acceptance criteria: all panels render from fixture streams; layout persists; input passthrough verified over the running game (manual, documented); zero input capability confirmed by API review + compliance test (overlay bundle contains no input APIs).
- Verify by: `pnpm --filter desktop test && pnpm compliance` + manual per `docs/verification/phase-7.md`

**Phase 7 Definition of Done:** holding PTT and saying "cargo scoop" while armed and flying emits exactly one keypress (audited, echoed); every red-team bypass attempt in the suite is refused; the overlay shows the full HUD over the game; Whisper loads/unloads per the VRAM policy on the 3060.

---

### PHASE 8 — Fleet-Carrier Operations

**Goal:** plan and track carrier-based mining expeditions (planning/tracking only — the player schedules every carrier jump in-game).
**Depends on:** Phase 4. **Compliance zone(s):** GREEN.

#### Step 8.1 — Carrier journal parsers + schema
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/core/src/journal/events/carrier-*.ts`, `packages/data/src/migrations/011-carrier.sql` + tests
- Work: parsers for `CarrierStats`, `CarrierJumpRequest`, `CarrierJump`, `CarrierJumpCancelled`, `CarrierTradeOrder`, `CarrierDepositFuel`, `CargoTransfer` (§5.1; verify whether the current game also emits `CarrierLocation` for off-carrier jumps and add it if so); migration 011 creating `carrier_state`, `carrier_fuel_log`, `cargo_transfers`, `expeditions`.
- Acceptance criteria: fixture carrier events parse with full field fidelity; a cancelled jump clears the pending state (tested); fuel ledger reconciles deposits/jumps to the level reported by the next `CarrierStats` (tested).
- Verify by: `pnpm --filter @lodestar/core test -- carrier`

#### Step 8.2 — Carrier state tracker (+ optional cAPI enrichment)
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/carrier/src/tracker.ts` + tests
- Work: fold carrier events into live carrier state (location, fuel, balance, capacity usage, pending jump with countdown) with an explicit **`state: unknown — awaiting reconciliation`** mode: `CarrierJump` is only journaled when the player is aboard, so a jump that happens while the player is elsewhere leaves the tracker stale until the next `CarrierStats`/cAPI poll reconciles it (never a wedged state machine, never fabricated position). When cAPI is enabled (4.10), `/fleetcarrier` enriches between journal events with age-stamped data.
- Acceptance criteria: state correct across a fixture expedition timeline (jump requested → jumped → fuel drop; requested → cancelled → cleared); the player-absent-jump fixture lands in `unknown` then reconciles from the next `CarrierStats` (tested); cAPI enrichment merges without clobbering fresher journal data (tested).
- Verify by: `pnpm --filter @lodestar/carrier test -- tracker`

#### Step 8.3 — Tritium fuel math
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/carrier/src/fuel-math.ts` + tests
- Work: burn-per-jump model (distance- and mass-dependent, per the community-documented formula, cited in-code with its source and stated as an estimate), range/endurance projections (jumps remaining at current load), refuel planning (tritium to buy/mine for an expedition), and **self-calibration**: every observed `CarrierJump` fuel delta refines the mass coefficient (same estimate-vs-actual philosophy as §8.5).
- Acceptance criteria: model matches documented reference values within tolerance (table-driven tests); calibration on synthetic jump history converges to the true coefficient (tested); projections update after each observed jump.
- Verify by: `pnpm --filter @lodestar/carrier test -- fuel`

#### Step 8.4 — Expedition planner
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/carrier/src/expedition-planner.ts`, Spansh carrier-router integration + tests
- Work: multi-run expedition plans to distant Pristine rings: carrier route legs (≤ 500 ly, via Spansh carrier planner through the gateway), tritium budget + staging (buy points along the route from Ledger data), a jump schedule the player executes in-game, mining-run slots at the destination (delegating to the Phase-4 run planner), and return logistics. Persisted to `expeditions`; `plan_carrier_expedition` registered as a Layer-2 tool.
- Acceptance criteria: fixture expedition (e.g. 1,200 ly to a Pristine icy ring) produces legs ≤ 500 ly each, a fuel plan within capacity, and total tritium within the 8.3 model (golden test); infeasible requests (out of fuel range with no buy points) refused with reasons.
- Verify by: `pnpm --filter @lodestar/carrier test -- expedition`

#### Step 8.5 — Cargo-transfer management
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/carrier/src/transfer-ledger.ts` + tests
- Work: ledger of ship↔carrier↔market movements from `CargoTransfer`/`CarrierTradeOrder`/`MarketSell`; recommended transfer quantities (keep mining, bank to carrier, sell threshold vs market demand); carrier stock valuation against current Ledger prices.
- Acceptance criteria: ledger reconciles to fixture cargo states at every step; recommendations respect capacity + demand caps (tested).
- Verify by: `pnpm --filter @lodestar/carrier test -- transfers`

#### Step 8.6 — Carrier screen
- Status: [ ] TODO
- Zone: GREEN
- Files: `apps/desktop/src/renderer/screens/Carrier.tsx`, `components/carrier/*` + tests
- Work: carrier dashboard — tritium gauge with endurance, jump countdown, expedition timeline (legs, staging, current position), transfer panel with recommendations, stock valuation.
- Acceptance criteria: renders full fixture expedition lifecycle; countdown/timeline correct across state transitions.
- Verify by: `pnpm --filter desktop test`

**Phase 8 Definition of Done:** plan a 1,000+ ly Pristine expedition and get carrier legs, fuel staging, and a jump schedule; live tritium + transfer tracking reconciles with the game; the player performs every jump — LODESTAR only plans and tracks.

---

### PHASE 9 — Wing Coordination

**Goal:** mine together, see shared stats. Telemetry-sharing only.
**Depends on:** Phases 1, 3. **Compliance zone(s):** GREEN.

#### Step 9.1 — Wing relay service (self-hostable)
- Status: [ ] TODO
- Zone: GREEN
- Files: `services/wing-relay/src/*.ts` + tests, `services/wing-relay/README.md` (deploy guide)
- Work: a small self-hostable Node WebSocket relay: rooms ("wings") created with a shareable join code + per-member tokens, message fan-out of telemetry snapshots, no persistence beyond the live session (memory only, room TTL), per-connection rate limiting, payload schema validation (rejects anything but the wing telemetry schema), TLS-ready behind a reverse proxy, no telemetry logging. The deploy README documents **exactly what a relay operator can observe** (connection IPs, timing, join codes, aliases) so wing members make an informed trust decision.
- Acceptance criteria: create/join/fan-out/expiry/rate-limit/schema-rejection all tested; a malicious oversized or off-schema payload is dropped and the sender throttled (red-team test); zero disk writes of telemetry (asserted); operator-visibility section present in the README.
- Verify by: `pnpm --filter wing-relay test`

#### Step 9.2 — Wing client + consent model
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/wing/src/{client.ts,consent.ts}`, `packages/data/src/migrations/012-wing.sql` + tests
- Work: migration 012 (`wing_sessions`, `wing_snapshots`); relay client (connect via user-entered relay URL + join code — `wss://` default, plain `ws://` requires an explicit warning acknowledgment; the egress allowlist entry is scoped to exactly that host+port for the session per §5.4 — heartbeat, resume-on-reconnect); consent model: sharing OFF by default, explicit opt-in per wing session, share-level choice (alias-only stats | +commodity | +location), revocable mid-session (leaving stops emission immediately), alias defaults to an anonymous callsign — CMDR name shared only by explicit choice (§1.2.3).
- Acceptance criteria: nothing is emitted before opt-in (tested); each share level emits exactly its fields and no more (schema snapshot tests); revocation stops emission within one heartbeat (tested).
- Verify by: `pnpm --filter @lodestar/wing test -- client consent`

#### Step 9.3 — Telemetry schema + anonymization
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/wing/src/telemetry.ts` + tests
- Work: the wing telemetry snapshot (alias, tons/hr, session tons, best-rock summary, optional commodity/location per share level), an anonymization pass stripping identifying fields below the chosen level, and inbound validation (hostile peer data sanitized: lengths, ranges, no markup) before it touches state or UI.
- Acceptance criteria: property test — no serialized snapshot at level *alias-only* contains CMDR/system strings; inbound hostile fixtures (oversized, script tags in alias, NaN rates) sanitized or rejected (tested).
- Verify by: `pnpm --filter @lodestar/wing test -- telemetry`

#### Step 9.4 — Shared session board (combined tons/hr)
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/wing/src/board.ts` + tests
- Work: aggregate live member snapshots into the wing board: combined tons/hr, per-member rates, wing totals, member freshness (stale members flagged, dropped from combined rate after timeout).
- Acceptance criteria: combined math golden-tested including joins/leaves/stales mid-session; board deterministic given a snapshot sequence.
- Verify by: `pnpm --filter @lodestar/wing test -- board`

#### Step 9.5 — Best-rocks leaderboard
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/wing/src/leaderboard.ts` + tests
- Work: rolling leaderboard of the wing's best prospected rocks (value-ranked from shared best-rock summaries), per-session, with per-member bests and a TTS/alert hook ("wing best: 42% platinum — CMDR Alias").
- Acceptance criteria: ranking stable and correct across fixture streams; ties + resubmissions handled (tested).
- Verify by: `pnpm --filter @lodestar/wing test -- leaderboard`

#### Step 9.6 — Wing screen
- Status: [ ] TODO
- Zone: GREEN
- Files: `apps/desktop/src/renderer/screens/Wing.tsx`, `components/wing/*` + tests
- Work: create/join/leave flows (join code entry, relay URL config), consent + share-level selection **rendered by the shared consent component owned by the Privacy panel authority (0.7/10.5 — the Wing screen embeds it, never reimplements it)** with a live preview of exactly what will be shared, the session board and leaderboard, member list with freshness.
- Acceptance criteria: consent preview matches actual emitted schema (tested against 9.3); flows component-tested; leaving kills the connection (tested); consent state round-trips through the single settings authority (tested).
- Verify by: `pnpm --filter desktop test`

**Phase 9 Definition of Done:** two LODESTAR instances against a locally run relay show each other's live rates, a combined tons/hr, and a shared best-rocks board — with sharing provably off until opted in and share levels provably respected.

---

### PHASE 10 — Community & Integrations

**Goal:** share outward — debriefs and hotspot discoveries — under explicit consent.
**Depends on:** Phases 2, 4, 5. **Compliance zone(s):** GREEN.

#### Step 10.1 — Debrief-to-Discord
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/integrations/src/discord/webhook.ts`, `packages/community/src/debrief-post.ts` + tests
- Work: opt-in Discord posting of the Phase-5 session debrief: webhook URL stored encrypted, message built from the grounded debrief artifact (tons, credits/hr, best rock, ring) as a Discord embed — hostile journal-derived strings (ring/system names) escaped/sanitized before embedding — posted at session end; default flow shows a preview with post/skip; a "post automatically" setting exists for users who opt into it; honors 429 `retry_after`; **failures queue for manual retry, and the queue row references the webhook by secrets-store key — the URL itself is never written to SQLite, the queue, or logs.**
- Acceptance criteria: embed built from fixture debrief matches snapshot; injection fixtures (markdown/mention payloads in ring names) neutralized (tested); nothing posts when opted out or without a URL (tested); 429 + failure paths tested against a local fake webhook server; a full-DB scan test asserts no webhook-URL substring in any table, and the log test covers the same (both tested).
- Verify by: `pnpm --filter @lodestar/community test -- discord`

#### Step 10.2 — Community endpoint service (self-hostable)
- Status: [ ] TODO
- Zone: GREEN
- Files: `services/community-api/src/*.ts` + tests, deploy README
- Work: self-hostable HTTP service for hotspot/overlap contributions: token-less anonymous submission endpoint with server-side validation (schema, plausibility — known commodity, sane counts, ring/system existence check against its own reference), rate limiting per IP, dedup/merge rules (same ring+commodity → confidence accumulation), a versioned dataset export endpoint for client sync, SQLite storage.
- Acceptance criteria: validation rejects implausible/hostile submissions (fuzz fixtures); dedup merges correctly; export is deterministic + versioned; rate limits enforced (all tested).
- Verify by: `pnpm --filter community-api test`

#### Step 10.3 — Contribution client (opt-in)
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/community/src/{contribute.ts,queue.ts}`, `packages/data/src/migrations/013-community.sql` + tests
- Work: migration 013 (`community_submissions`); when the user opts in, newly discovered hotspots/overlaps (from own scans, 4.3/4.4) enter an outbound queue; client-side validation + anonymization (no CMDR, no timestamps finer than day, location = the ring itself only — which is the datum being shared); submission through the gateway to the configured endpoint; per-item send/skip review mode as the default, bulk-auto as an explicit setting.
- Acceptance criteria: queue only populates when opted in (tested); anonymization property test (no identifying fields in any serialized submission); endpoint configurable; failures retry with backoff (tested).
- Verify by: `pnpm --filter @lodestar/community test -- contribute`

#### Step 10.4 — Community sync-back
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/community/src/sync.ts` + tests
- Work: periodic (24 h) pull of the community dataset version → merge into local `hotspots`/`overlaps` with `source='community'`, confidence carried over **and capped** (community data can steer suggestions, never dominate journal-confirmed truth; per-IP rate limits don't stop IP-rotating confidence inflation, so the cap is client-side), never overwriting the player's own journal-sourced or confirmed entries (provenance precedence: journal-confirmed > community > seed); inbound data validated + sanitized like 9.3. Community provenance never enters ML training (6.1).
- Acceptance criteria: precedence rules golden-tested; confidence cap enforced (tested); malformed community data rejected without corrupting local state; sync idempotent per dataset version.
- Verify by: `pnpm --filter @lodestar/community test -- sync`

#### Step 10.5 — Privacy & consent panel
- Status: [ ] TODO
- Zone: GREEN
- Files: `apps/desktop/src/renderer/screens/settings/PrivacyPanel.tsx` + tests
- Work: one panel governing every outbound channel (wing, community contributions, Discord): per-channel opt-in toggles (all default OFF), share-level pickers, **live data previews** ("exactly this leaves your machine"), one-click revoke-all, and a plain-language description of each destination. This panel is the single authority — every outbound module reads its flags from here (settings keys from 0.7).
- Acceptance criteria: revoke-all stops every channel (integration test across wing/community/discord fakes); previews render the true serialized payloads (tested against each schema); defaults OFF asserted in the compliance suite.
- Verify by: `pnpm --filter desktop test && pnpm compliance`

#### Step 10.6 — Outbound red-team pass
- Status: [ ] TODO
- Zone: GREEN
- Files: `packages/compliance/src/outbound.test.ts` + fixes it forces
- Work: adversarial suite over all outbound paths: PII scanner over every serialized outbound payload type (CMDR name, FID, machine paths, tokens), consent-bypass attempts (emit with flags off), injection resilience (hostile strings from journal → Discord embed / community payload are escaped), log-leak scan (no webhook URLs/tokens in log fixtures).
- Acceptance criteria: every attack test refused/escaped; suite becomes part of `pnpm compliance` permanently.
- Verify by: `pnpm compliance`

**Phase 10 Definition of Done:** with consent ON, session debriefs post to Discord and discoveries flow to and from a locally run community endpoint; with consent OFF (the default), the compliance suite proves not one byte leaves the machine beyond §5.4's read-only data fetches.

---

### PHASE 11 — Polish, Packaging & Release

**Goal:** ship it.
**Depends on:** all previous phases. **Compliance zone(s):** GREEN (+ existing YELLOW features unchanged).

#### Step 11.1 — Onboarding / first-run wizard
- Status: [ ] TODO
- Zone: GREEN
- Files: `apps/desktop/src/renderer/onboarding/*` + tests
- Work: first-run flow — journal path detect/confirm; GPU detection (`nvidia-smi`) with explicit AI-GPU selection and instructions for binding the game to the other GPU; Ollama detect/install-guide/model pull with progress + digest verify; Piper voice pick with audition; consent defaults (all OFF) explained; compliance stance page (what LODESTAR will and will never do).
- Acceptance criteria: every wizard path component-tested (including no-GPU, no-Ollama machines — real degraded modes: features that need them show their requirement states); wizard re-runnable from Settings.
- Verify by: `pnpm --filter desktop test` + full manual run on this machine

#### Step 11.2 — Animation & sound polish
- Status: [ ] TODO
- Zone: GREEN
- Files: renderer components (Framer Motion passes), `resources/sounds/*`, `apps/desktop/src/renderer/sound/*` + tests
- Work: consistent MFD transition language (panel power-on sweeps, verdict slams, alert pulses), original or properly licensed UI sound cues (provenance documented in `resources/sounds/LICENSES.md`), a reduced-motion + mute-cues accessibility setting honored app-wide.
- Acceptance criteria: reduced-motion disables all non-essential animation (tested via the setting); sound licenses documented; no animation on the ≤150 ms Assay verdict path (latency budget retested).
- Verify by: `pnpm --filter desktop test`

#### Step 11.3 — Performance pass
- Status: [ ] TODO
- Zone: GREEN
- Files: measured hotspots across packages; `docs/performance.md`
- Work: profile and fix against budgets: idle CPU < 3% with game running; journal-detection→UI p95 ≤ 250 ms (per the Phase 2 DoD definition); DB queries in Manifest < 50 ms @ 1k sessions; renderer 60 fps on the Command Deck; memory steady-state < 600 MB. Machine-bound budgets are **documented manual benchmarks** on this machine (§4.2) with the protocol recorded; only deterministic, machine-independent regressions (algorithmic complexity assertions, query-plan checks, payload-size ceilings) gate CI.
- Acceptance criteria: every budget measured and recorded in `docs/performance.md` with methodology; deterministic regression tests wired into CI; any missed budget either fixed or consciously re-budgeted with an operator-visible changelog note.
- Verify by: `pnpm test -- bench` + documented measurement session

#### Step 11.4 — Auto-update
- Status: [ ] TODO
- Zone: GREEN
- Files: `apps/desktop/src/main/updater.ts`, electron-builder publish config + tests
- Work: electron-updater against GitHub Releases. **OQ2 must be resolved before this step starts:** electron-updater cannot read private release assets without shipping a token (unsafe), and AGPL-3.0 obligates offering corresponding source to everyone receiving binaries — so the realistic end-state is a public repo (or public releases + source mirror) at v1.0.0; the step is planned against whichever the operator picks. User-consented downloads (notify → user applies), release channel setting (stable only at v1), update events logged.
- Acceptance criteria: update flow tested against a local fake update feed (available/none/corrupt-signature paths); no silent installs (user action required — tested).
- Verify by: `pnpm --filter desktop test -- updater`

#### Step 11.5 — Installers & signing
- Status: [ ] TODO
- Zone: GREEN
- Files: `apps/desktop/electron-builder.yml`, `.github/workflows/release.yml`
- Work: electron-builder NSIS installer (x64), artifact naming/versioning from the tag, release workflow building on windows-latest, SBOM + checksums published with the release; code signing wired behind a secret-provided certificate (decision tracked in §9 — until a cert exists, releases ship checksummed + documented as unsigned, and the docs say exactly what SmartScreen will show).
- Acceptance criteria: CI produces an installable artifact from a tag; clean-VM install → onboarding → app functions; checksums published; signing activates automatically when the cert secret is present (dry-run tested).
- Verify by: tag a release-candidate on GitHub; install the produced artifact on a clean Windows VM (documented)

#### Step 11.6 — User documentation
- Status: [ ] TODO
- Zone: GREEN
- Files: `docs/user/*.md`
- Work: install + onboarding guide; module guides (every Green/Yellow feature); the compliance stance page (three zones, what LODESTAR refuses and why); GPU setup guide (game on 5070 Ti, AI on 3060); troubleshooting (journal path, Ollama, overlay + borderless-windowed, sidecars).
- Acceptance criteria: every shipped screen/feature has a doc section; docs build/link-check passes in CI; compliance page reviewed against §2 verbatim.
- Verify by: `pnpm docs:check` (link/coverage checker) + review

#### Step 11.7 — Developer documentation
- Status: [ ] TODO
- Zone: GREEN
- Files: `docs/dev/*.md`, package READMEs updated
- Work: architecture guide (three layers, event flow, package map with real APIs), contributing guide (TDD protocol, adversarial review, compliance gates, SSOT protocol), sidecar development setup (venvs, GPU pinning), test-fixture guide, release runbook.
- Acceptance criteria: a from-scratch dev-environment setup following only the docs succeeds (performed and recorded); every package README describes its real, shipped API.
- Verify by: clean-machine (or clean-clone + fresh venv) setup following docs, recorded in changelog

#### Step 11.8 — v1.0.0 release
- Status: [ ] TODO
- Zone: GREEN
- Files: `CHANGELOG.md`, version bumps, release tag
- Work: run the **full** Definition of Done across all phases (every phase DoD re-executed), whole-project adversarial review (architecture + design + red-team over the final tree), fix findings, tag `v1.0.0`, publish the release with installers + checksums + release notes.
- Acceptance criteria: all phase DoDs green in one session on a clean clone; final review clean; release published and installable.
- Verify by: `git clean -xdf && pnpm install && pnpm build && pnpm lint && pnpm test && pnpm compliance` + release-workflow artifacts installed on a clean VM

**Phase 11 Definition of Done:** a new user on a fresh Windows machine installs LODESTAR from the GitHub release, completes onboarding, and reaches a working Command Deck with every module functional and every compliance guarantee intact.

---

## 7. FEATURE REGISTRY

| Feature | Zone | Delivered by | Status |
| --- | --- | --- | --- |
| Command Deck (live telemetry) | GREEN | Phase 0 (shell), Phase 1 (live) | [ ] TODO |
| Assay (MINE/SKIP engine + TTS) | GREEN | Phase 2 | [ ] TODO |
| Overlay (read-only HUD) | GREEN (display) | Phase 2 (v1), Phase 7 (full) | [ ] TODO |
| Manifest (analytics, heatmaps, bests, CSV) | GREEN | Phase 3 | [ ] TODO |
| Vein Finder (hotspots, overlaps, scoring, 3D map) | GREEN | Phase 4 | [ ] TODO |
| Ledger (best sell, trends, alerts) | GREEN | Phase 4 | [ ] TODO |
| Cartographer (round-trip planner, 3 strategies) | GREEN | Phase 4 | [ ] TODO |
| Outfitter (loadout advisor) | GREEN | Phase 4 | [ ] TODO |
| Commander's Assistant (local LLM + tools) | GREEN | Phase 5 | [ ] TODO |
| Yield predictor (Layer 3) | GREEN | Phase 6 | [ ] TODO |
| Prospector worth-it classifier (Layer 3) | GREEN | Phase 6 | [ ] TODO |
| **Yield Calibration Loop (advanced #3)** | GREEN | Phase 6 | [ ] TODO |
| Ops (guardrailed voice→keybind) | YELLOW | Phase 7 | [ ] TODO |
| Smart Alerts (price/wing/session alerts) | GREEN/YELLOW (display+TTS) | Phases 4, 9 | [ ] TODO |
| **Fleet-Carrier Operations (advanced #1)** | GREEN | Phase 8 | [ ] TODO |
| **Wing Mining Coordination (advanced #2)** | GREEN | Phase 9 | [ ] TODO |
| **Debrief-to-Discord (advanced #4)** | GREEN | Phase 10 (on Phase 5 debriefs) | [ ] TODO |
| **Community Hotspot Contributions (advanced #5)** | GREEN | Phase 10 | [ ] TODO |
| Onboarding, packaging, auto-update, docs | GREEN | Phase 11 | [ ] TODO |

---

## 8. LOCAL ML/AI SPEC

### 8.1 Models

| Role | Model | Quant/size | Device | Loaded |
| --- | --- | --- | --- | --- |
| Assistant LLM | Qwen2.5-7B-Instruct (default; Llama-3.1-8B-Instruct selectable) | Q4_K_M, ~4.7 GiB weights | AI GPU (RTX 3060) via Ollama | on first use; `keep_alive` 30 min |
| STT | faster-whisper `small` | int8, ~0.5 GiB | AI GPU | on voice-enable; unload after 60 s idle |
| TTS | Piper (one voice) | ~60 MiB | **CPU** | resident while app runs |
| Yield predictor | gradient-boosted / shallow MLP | < 50 MiB | AI GPU (train + infer) | per call |
| Prospect classifier | small classifier | < 50 MiB | AI GPU (train + infer) | per call |
| Calibration loop | conjugate Bayesian linear regression | closed-form | CPU (deterministic math) | per qualifying run |

### 8.2 VRAM budget — RTX 3060, 12,288 MiB total

| Allocation | Budget (MiB) | Notes |
| --- | --- | --- |
| System/driver reserve + contingency | 512 | card runs headless (display on 5070 Ti) |
| LLM weights (Q4_K_M 7B) | 4,800 | measured on first load; recorded here |
| LLM KV cache @ 8k context | 1,500 | context length capped in Ollama options |
| faster-whisper small int8 | 900 | load-on-demand only |
| ML train/infer burst | 2,000 | deferred while Whisper loaded or session active |
| **Committed worst case (LLM+Whisper)** | **7,712** | leaves ≥ 4.5 GiB headroom |
| **Committed worst case (LLM+ML burst)** | **8,812** | still ≥ 3.4 GiB headroom |

**Load/unload policy:** the VRAM guard (Step 5.8) preflights every load against live `nvidia-smi` readings; Whisper unloads after 60 s idle; LLM honors settings-controlled `keep_alive` (default 30 min, "until app close" optional); ML training never runs concurrently with Whisper or during an active mining session; a foreign process squatting on the card produces an actionable refusal, never a silent spill into shared memory. Measured values replace budget estimates in this table as they are recorded (changelog-noted).

### 8.3 GPU pinning (commands of record)

```powershell
# Identify (this machine, verified 2026-07-12):
nvidia-smi -L
# GPU 0: RTX 5070 Ti (game GPU — LODESTAR never allocates here)
# GPU 1: RTX 3060  UUID GPU-5612e762-42fc-f272-2350-a477ed53878d  (AI GPU)

# Ollama environment (user-level env vars, then restart Ollama — LODESTAR
# validates and instructs; it cannot inject env into a running tray service):
CUDA_DEVICE_ORDER=PCI_BUS_ID
CUDA_VISIBLE_DEVICES=GPU-5612e762-42fc-f272-2350-a477ed53878d   # pin by UUID, not index
OLLAMA_HOST=127.0.0.1:11434

# Sidecars (ML, STT) — same env, plus startup assertion:
# torch device UUID must equal the configured AI-GPU UUID or the sidecar exits nonzero.

# Verification after any model load:
nvidia-smi --query-gpu=index,uuid,name,memory.used --format=csv
```

The game is bound to the 5070 Ti via Windows Settings → Display → Graphics → Elite Dangerous → High performance (5070 Ti); the onboarding wizard walks the user through this and verifies it.

### 8.4 Training data & pipelines (all local, never leaves the machine)

- **Sources:** the player's own SQLite — `sessions`, `prospects`, `refinements`, `runs`, ring/hotspot context **restricted to `journal`/player-confirmed provenance; `community` and `seed` rows are excluded from training frames by construction (Step 6.1, tested)**. No external training data; no telemetry upload.
- **Pipeline:** deterministic extraction (6.1, versioned by content hash) → sidecar `train` on the AI GPU (6.2) → evaluation vs active model → registry activation only on improvement (6.7) → artifacts under `%APPDATA%/lodestar/models/`.
- **Cadence:** manual trigger anytime; automatic after every 10 new qualifying runs; always deferred while VRAM policy forbids.
- **Inference paths:** yield predictor feeds Cartographer estimates; classifier feeds Assay advisory lines; both via sidecar RPC with < 50 ms budget per call (measured in tests).

### 8.5 Bayesian yield-calibration math

**Model.** For each completed qualifying run *i*: observation `y_i = log(actual tons/hr)`, features `x_i` = the scoring model's term vector for the planned target — `[1, log(price), overlap_mult, reserve_weight, ring_match, distance_norm, sell_leg_norm]`. Likelihood `y_i ~ N(wᵀx_i, σ²)`.

**Prior.** Conjugate Normal–Inverse-Gamma: `(w, σ²) ~ NIG(μ₀, Λ₀, a₀, b₀)` with `μ₀` = shipped default weights (Step 4.5), `Λ₀ = diag(λ)` expressing confidence in the defaults, `a₀ = 3`, `b₀ = 1`.

**Sequential update (per qualifying run).**

```
Λₙ = Λₙ₋₁ + xₙxₙᵀ
μₙ = Λₙ⁻¹ (Λₙ₋₁ μₙ₋₁ + xₙ yₙ)
aₙ = aₙ₋₁ + ½
bₙ = bₙ₋₁ + ½ (yₙ² + μₙ₋₁ᵀΛₙ₋₁μₙ₋₁ − μₙᵀΛₙμₙ)
```

**Effective weights** = posterior mean `μₙ`, element-wise clamped to `[0.5·μ₀, 1.5·μ₀]` (guardrail against runaway updates from outlier runs); the posterior predictive variance is surfaced in the UI as the estimate's confidence band.

**Qualifying run:** ≥ 15 min in-ring mining time, ≥ 8 prospected rocks, completed sale. **Cadence:** immediately at run completion (closed-form, CPU, microseconds). Every update writes a `calibration_weights` version with the triggering run id; rollback restores any prior version. Reference-implementation parity, convergence, clamping, and rollback are all pinned by tests (Step 6.5).

---

## 9. RISK REGISTER & OPEN QUESTIONS

### 9.1 Risks

| # | Risk | Impact | Mitigation |
| --- | --- | --- | --- |
| R1 | Frontier cAPI client-id approval never granted | No cAPI enrichment | Feature-flagged (4.10); journal + EDDN + Inara cover all core features |
| R2 | Inara app registration / terms limits | Reduced market reference | Client disabled without key; EDDN + journal remain primary |
| R3 | Journal schema drift on game patches | Parser breakage | Tolerant parsers + drift telemetry (1.5); fixtures updated per patch; SSOT changelog notes |
| R4 | Overlay cannot render over exclusive-fullscreen | Overlay unusable for some users | Documented borderless-windowed requirement (2.8); all overlay data also on second-screen UI |
| R5 | Journals expose hotspot counts, not positions | True overlap detection limited | Honest confirmed-vs-candidate model (4.4); community confirmations (Phase 10) |
| R6 | Tritium burn formula is community-reverse-engineered | Fuel plan error | Cited as estimate + self-calibrating from observed jumps (8.3) |
| R7 | Foreign processes contending for 3060 VRAM | Model load failures | VRAM guard with actionable refusals (5.8); never silent spill |
| R8 | Python sidecar distribution complexity | Install friction | Pinned-venv bootstrap now; packaging decision (PyInstaller vs bundled runtime) due Phase 6 gate (OQ4) |
| R9 | Native single-key emitter must be built clean-room | Yellow-zone safety | Minimal in-repo native addon, exhaustive red-team suite (7.3); no third-party macro libs |
| R10 | Native-module ABI: Node (Vitest) vs Electron builds of better-sqlite3/zeromq/the Phase-7 addon conflict in one store, plus upgrade drift | Build breakage, dev-loop failures | Dual-build strategy of record in Step 0.6 (Node ABI for tests, Electron rebuild only in the app pipeline); pinned versions |
| R15 | Dependency lifecycle scripts (npm/pip) run arbitrary code + network at install, outside all runtime guards | Supply-chain compromise/exfil | Lifecycle scripts disabled by default with a native-build allowlist (0.1); frozen lockfiles; `pip --require-hashes`; CI installs restricted (0.11) |
| R16 | Real journal/status captures committed as fixtures carry broad PII into permanent git history | Privacy exposure if repo goes public (OQ2) | Repo treated as public from commit #1; synthetic-first fixtures; allowlist scrubber with PII-absence tests (1.1) |
| R11 | External service terms/availability change (EDSM/Spansh/EDDN) | Data gaps | Gateway isolation, caching, multi-source redundancy, kill-switches |
| R12 | Community endpoint abuse (poisoned data) | Bad recommendations | Server + client validation, provenance precedence (10.4), confidence weighting |
| R13 | Even Yellow-zone voice perceived as ToS-adjacent | Player account risk | Strictest-in-class guardrails (7.3–7.5), audit log, plain-language compliance docs; feature fully optional and off by default |
| R14 | Code-signing certificate (cost/identity) | SmartScreen warnings | Unsigned-but-checksummed releases documented until cert decision (OQ3) |

### 9.2 Open questions (operator decisions pending)

| # | Question | Needed by |
| --- | --- | --- |
| OQ1 | Default LLM: Qwen2.5-7B-Instruct (proposed default) vs Llama-3.1-8B-Instruct? | Phase 5 start |
| OQ2 | Repo visibility end-state. electron-updater can't read private release assets without shipping a token, **and AGPL-3.0 obligates offering source to everyone who receives binaries** — so v1.0.0 realistically means a public repo (or public releases + source mirror). Decision also governs fixture policy NOW (§Step 1.1 treats history as public from commit #1 regardless). | Before Phase 11.4 (fixture policy already applied) |
| OQ3 | Purchase a code-signing certificate? (~$100–400/yr; removes SmartScreen friction) | Phase 11.5 |
| OQ4 | ML/STT sidecar packaging: PyInstaller binaries vs bundled-venv bootstrap? | Phase 6 gate |
| OQ5 | Community endpoint: operator-hosted instance URL (and hosting choice), or ship client pointed at self-host docs only? | Phase 10 |
| OQ6 | Piper default voice? (auditioned in onboarding regardless) | Step 2.7 (defaultable, changeable later) |

---

## 10. SESSION PROTOCOL (STAGE 2 — how every build session runs)

1. **Orient.** Read `LODESTAR_SSOT.md`. Identify the lowest-numbered step not `[x] DONE`.
2. **Confirm scope.** State the step and its acceptance criteria. If ambiguous, or the phase hasn't been operator-approved, ask before proceeding.
3. **Compliance gate.** Run the step against §2.4. GREEN or guardrailed YELLOW proceeds. Anything RED-adjacent stops with a proposed compliant alternative.
4. **Test first.** Write the step's failing tests (unit/integration per §4.2). Run them; confirm they fail for the right reason.
5. **Implement** the step — and only that step. No building ahead.
6. **Verify.** Run the step's "Verify by" exactly. Fix until green. Run `pnpm lint && pnpm test && pnpm compliance` for the touched scope.
7. **Adversarial review (§4.8).** Architecture, design, red-team passes over the diff. Fix BLOCKING findings; record NOTEs (§9 or changelog).
8. **Update the SSOT.** Mark `[x] DONE`, note divergences by editing affected steps, append to §11 changelog.
9. **Commit** with a Conventional Commit referencing the step (e.g. `feat(assay): step 2.4 — mine/skip verdict engine`) and push.
10. **Phase gates.** At phase end: run the Phase Definition of Done, whole-phase review, summarize, and **pause for operator approval** before the next phase.

**Standing rules:**
- One step at a time; this SSOT never drifts from the code.
- Never build a RED-zone capability, even if asked mid-build — refuse and offer the compliant path.
- Never route any AI/ML through a cloud service; the compliance suite must always contain tests that would fail if one were introduced.
- No mocks/stubs/placeholders/TODOs in product code (§1.3); test doubles only for external services per §4.2.
- Prefer small, tested, working increments over speculative code.
- Secrets never enter the repo: `safeStorage` + `.env` (gitignored) + `.env.example` with dummies.

---

## 11. CHANGELOG

- 2026-07-12 — Stage 1: SSOT authored; repo skeleton + `CLAUDE.md` created; private repo `R3AP3RW1LLY/lodestar` initialized (AGPL-3.0-only). Hardware erratum recorded (RTX 3060 12 GB @ CUDA index 1, not 3060 Ti 8 GB — operator-approved). Test-doubles scope clarified (externals only — operator-approved).
- 2026-07-12 — **Step 0.2 done.** Result/units/errors/logging/channels primitives, TDD (red run recorded), 38 tests, 100% line/branch coverage (AC ≥95%). Review (3 lenses, 5 BLOCKING) forced pre-commit hardening: `Envelope` became a distributive discriminated union (narrowing on `.channel` narrows `.payload`); `isEnvelope` now honestly returns `EnvelopeShape` with `payload: unknown` + own-property check; `causeChain` gained a 64-depth cycle guard (main-process DoS path); `fromThrowable`/`fromPromise` added as the canonical boundary adapters; branded-unit arithmetic helpers (`addTons`/`addCredits`/`addLightYears`) delegate validity to constructors; −0 normalized; message-hygiene convention documented in `errors.ts` (no secrets/paths in DomainError messages). §4.1 naming carve-out recorded (instances camelCase). Deferred: `pipe` combinator until real chains exist (noted, not speculative).
- 2026-07-12 — **Step 0.1 done.** Toolchain: pnpm 10.24 workspaces + Turbo 2.10 + Vitest 4 + @vitest/coverage-v8; internal-packages pattern (source exports, `noEmit`). **TypeScript pinned to 5.9** after an empirical spike proved typescript-eslint 8.63 crashes on TS 7.0.2 (native) — revisit TS7 when typescript-estree supports it (risk noted). Supply-chain proof performed: an in-repo fixture package with a sentinel-writing `postinstall` was installed and pnpm blocked the script (`pnpm ignored-builds` listed it; sentinel absent); fixture removed. Turbo anonymous telemetry disabled machine-wide (`turbo telemetry disable`; CI gets `TURBO_TELEMETRY_DISABLED=1` in Step 0.11). Root version aligned to 0.1.0; `APP_VERSION` parity test lands in Step 0.2. Per-step adversarial review: 3 reviewers, 7 BLOCKING findings (TS7/typed-lint, missing `esModuleInterop`, turbo outputs/task-graph, missing coverage provider, version drift, allowlist proof, uncommitted lockfile) — all fixed pre-commit.
- 2026-07-12 — Stage 1 adversarial review (architecture + design + red-team, three independent reviewers; 22 BLOCKING + ~35 NOTE findings) applied in full. Highlights: Status.json bit 24 = InMainShip correction (safety-critical); `Scan` event added as the journal source of ring type/reserve; canonical commodity dictionary step added (Rhodplumsite fixed, Tritium added); Assay orchestrator step added; minimal egress gateway + artifact downloader pulled into Phase 0 (redirect/loopback/install-time hardening); polling tailer for Windows journal latency with honest budgets; native-ABI dual-build strategy; compliance task made uncache-able; one-emission-per-PTT-cycle guarantee; Supercruise-Assist/Docking-Computer binds explicitly FORBIDDEN; community/seed provenance excluded from ML training; fixtures treated as public-history from commit #1; migration numbers 001–013 assigned; overlay/alerts rezoned GREEN in §2.1; `ai`→`voice` firewall; dependency-direction table completed (compliance/scripts/sidecars). Awaiting operator review and "Begin Phase 0."






