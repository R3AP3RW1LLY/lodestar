# Manual verification — TTS voice callouts (Step 2.7b)

Audio output can't be asserted in CI, so the Piper voice is verified by hand. The
download + WAV synthesis is proven automatically (the 2.7b-i integration test runs
the real binary when present); this covers the **audible** end-to-end path.

## A. Settings test-phrase button (the quickest check)

1. Launch the app: `unset ELECTRON_RUN_AS_NODE; pnpm --filter desktop dev`.
2. Open **Settings → Voice (TTS)**.
3. Tick **Enable mine/skip callouts**. On first enable the app downloads the pinned
   Piper binary + the `en_US-ryan-high` voice (~130 MB total) into
   `<dataDir>/voices/` — hash-verified via the artifact downloader. Give it a moment.
4. Click **Test voice**.
   - **Expected:** you hear *"Lodestar voice online. Platinum, thirty-two percent.
     Mine."* in the Ryan (US English) voice, and the note reads **voice test played**.
   - Adjust the **Volume** slider and click Test voice again — playback volume tracks it.
   - A failure shows **voice test failed: &lt;reason&gt;** (e.g. `not-installed` if the
     download was blocked) — check the logs in `<dataDir>/logs/`.

## B. Live verdict callouts (end-to-end)

1. With TTS enabled and a journal path configured (or `LODESTAR_JOURNAL_DIR` set),
   drive prospects: either mine in-game, or replay a fixture —
   `node apps/desktop/scripts/replay-journal.mjs <journalDir>`.
2. On each **MINE** verdict you should hear a callout, e.g. *"Painite, twenty-four
   percent. Mine."*. **SKIP** verdicts are intentionally silent (skips are frequent).
3. Toggling **Enable mine/skip callouts** off silences callouts immediately (the
   setting is read fresh per verdict).

## Notes

- CPU only — Piper never touches the GPU (the AI GPU is reserved for STT/LLM/ML).
- The voice model is pinned by SHA-256 (`packages/voice/src/tts/piper-assets.ts`); a
  tampered download refuses rather than plays.
- Record the result of check A here when performed: date, machine, pass/fail.
