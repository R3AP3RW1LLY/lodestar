# Phase 2 — manual verification (Assay)

Most of Phase 2 is proven by automated tests (the verdict engine, the price book,
the orchestrator, prospector stats, the dashboard, and the overlay's window flags +
WS client + click-through wiring). Two things need a human with the game running:
the **spoken callout** (see [tts.md](tts.md)) and the **in-game overlay** (below).

## Step 2.10 — Overlay v1 (read-only, click-through) over the running game

**Prerequisite — game display mode.** Elite Dangerous must run in **Borderless**
(Options → Graphics → Display → Borderless). A true exclusive-fullscreen game will
paint over any always-on-top window; borderless lets the transparent overlay float
above it. This is a hard requirement, documented here per SSOT Step 2.10.

**Setup**

1. Start LODESTAR (`pnpm --filter desktop dev`, or the packaged app) with the
   journal path configured (Settings) or `LODESTAR_JOURNAL_DIR` set.
2. Launch Elite Dangerous in Borderless and go mining.

**Checks**

1. **Toggle from the Command Deck.** On the Command Deck, click the **Overlay**
   button (top-right, next to the live badge). The overlay appears at the top-left
   of the screen showing the latest verdict + cargo fill. Click again → it hides.
   The button label reflects the state (`Overlay · on` / `Overlay · off`).
2. **Toggle from the global shortcut.** With the game focused, press
   **Ctrl+Shift+O**. The overlay toggles without the game losing focus (you can
   keep flying). If the shortcut does nothing, another app owns it — the log notes
   `overlay.shortcut-unavailable`; the Command Deck button still works.
3. **Click-through (the ToS-critical check).** With the overlay **visible** over
   the game, click and drag *through* the overlay region — on the HUD, on the fire
   groups, anywhere. Every click must reach the game; the overlay must never
   intercept a click, capture focus, or move. (In code this is
   `setIgnoreMouseEvents(true)` + the renderer's `pointerEvents: none`, both
   asserted in `overlay-window.test.ts` / the components.)
4. **Live updates.** Prospect a rock: the overlay's verdict updates (MINE orange /
   SKIP dim + the dominant commodity) within a beat of the Command Deck / Assay
   dashboard. Fill the hold: the cargo % climbs. The overlay receives all of this
   over the loopback WS server only — it has no IPC path to the app internals.
5. **Late-join baseline.** Toggle the overlay OFF, prospect a rock, then toggle it
   ON: it immediately shows the current cargo and the latest verdict (it is primed
   with a `state.snapshot` + the last verdict on connect — never blank-until-next).
6. **Arrange (move / resize / lock).** Click **Arrange** on the Command Deck (or
   press **Ctrl+Shift+L**). The overlay grows a dashed border + a drag bar and
   becomes interactive:
   - **Move** — drag the top bar; the whole HUD follows.
   - **Resize** — grab a window edge/corner and drag.
   - **Lock** — click **Lock** (or Ctrl+Shift+L) again. The chrome disappears and it
     returns to click-through display-only.
   Restart the app: the overlay reappears at the size/position you left it, and
   **always boots LOCKED** (click-through) — it can never restart in a state that
   blocks game clicks.

**Expected result:** the overlay is a legible, transparent, always-on-top,
fully click-through HUD that mirrors the verdict + cargo live and never touches the
game. Record the date + outcome in the SSOT §11 changelog when performed.

## Phase 2 Definition of Done — manual confirmations

- Prospect → displayed MINE/SKIP verdict with reasons: **automated** (Assay tests)
  + visible on the Command Deck-adjacent Assay screen and the overlay.
- Detection-to-render p95 ≤ 250 ms: **automated** (the 200-iteration real-clock
  latency test through the real bus→orchestrator→engine→SQLite path, p95 ≤ 150 ms;
  + the 100 ms journal poll).
- Spoken callout begins ≤ 750 ms after detection: **manual**, see [tts.md](tts.md).
- Verdicts persist with stats + show on the overlay: **automated** + the overlay
  checks above.
