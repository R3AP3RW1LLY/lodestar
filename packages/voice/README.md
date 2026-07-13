# @lodestar/voice

Voice I/O for LODESTAR.

- **Speech queue** (`src/tts/speech-queue.ts`) — a priority queue with named classes
  `ops-echo > safety > alert > verdict > ambient`; a higher class preempts lower-class
  backlog, identical utterances dedupe, and a superseded verdict is cancelled before it
  is ever spoken (Step 2.7).
- **Piper TTS** (`src/tts/piper.ts`) — CPU-only text→speech via the pinned Piper binary,
  driven through the shared sidecar supervisor in `@lodestar/core` (Step 2.7).
- Yellow-Zone STT (faster-whisper) + the guardrailed single-action voice→keybind bridge
  arrive in Phase 7 — hard-blocked from loops, auto-fire, and navigation.

**Firewall:** the `ai` package must NEVER import `@lodestar/voice` — the local LLM can
never acquire speech or input capability (compliance-tested, SSOT §3.2).
