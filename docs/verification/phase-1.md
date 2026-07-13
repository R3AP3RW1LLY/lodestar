# Phase 1 — manual verification (Command Deck live telemetry)

Automated coverage (unit + integration + the `telemetry.spec.ts` / `restart.spec.ts`
Electron e2e) proves the pipeline end to end. This is the **manual, eyes-on**
verification that the Command Deck comes alive within ~1 s of in-game events —
runnable against the real game OR a fixture replay when Elite Dangerous isn't to
hand.

## A. Fixture replay (no game required)

Drives a realistic mining session into a temp journal folder with **real-time
timestamps**, so the deck shows a `LIVE` badge and rates climb as you watch.

```bash
# 1. pick a scratch journal dir
JDIR="$(mktemp -d)"

# 2. start the app in dev (HMR on) pointed at that dir
#    (unset ELECTRON_RUN_AS_NODE first if your shell exports it)
LODESTAR_JOURNAL_DIR="$JDIR" pnpm --filter desktop dev

# 3. in a second terminal, replay a mining session into it
node apps/desktop/scripts/replay-journal.mjs "$JDIR"
```

**Expected (within ~1 s of each replayed event):**

- Status badge reads **LIVE** (green). Stop the replay and after ~10 s it flips to
  **GAME OFFLINE** over the last-known snapshot (never blanked, never shown as live).
- **Ship** shows `python` / the loadout summary; **Location** shows the system +
  ring; **Activity** turns **MINING** (orange/green) with live status-flag chips.
- **Fuel & Pips** shows the SYS/ENG/WEP pip fill and fuel; **Cargo** fills as
  refined tons land.
- **Session** shows tons refined climbing, with tons/hr and credits/hr updating.
- **Hot reload:** edit any panel under `apps/desktop/src/renderer/components/` and
  save — the deck updates without losing the live session state.

## B. Real game

1. Configure the journal path in **Settings** (auto-detect or set it), or launch
   with `LODESTAR_JOURNAL_DIR` pointed at
   `%USERPROFILE%\Saved Games\Frontier Developments\Elite Dangerous`.
2. Fly to a ring and mine. The Command Deck should reflect prospects/refines,
   cargo, and session rates within ~1 s of each journal write.

## Latency note

The watcher polls at 100 ms and the state bridge throttles pushes to ≤ 10 Hz, so
end-to-end journal-write → rendered-update p95 is well under the SSOT's ≤ 250 ms
budget for the pipeline (+ one render frame). Record the observed figure here when
measured on the operator's machine:

- **p95 (operator machine, real game):** _TBD — record during a live mining run._
