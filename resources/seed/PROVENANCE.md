# Hotspot seed — provenance & clean-room policy

LODESTAR ships a **small, hand-authored starter seed** of famous mining locations so
the Vein Finder is not empty on first run. This file records where that data comes
from and the policy it is authored under.

## Clean-room policy (Prime Directive #4)

**No data file, table, or asset is copied from any existing mining tool** (EliteMining
or any other). Every entry in [`hotspots-seed.json`](./hotspots-seed.json) is authored
by hand from **community common knowledge** — mining locations that have been publicly
and widely documented for years across player forums, community wikis, guides, and
streams, to the point of being general knowledge in the *Elite Dangerous* mining
community. No proprietary or tool-specific dataset was consulted or transcribed.

The seed is deliberately minimal. LODESTAR's database is designed to grow primarily
from **first-party data**:

- the commander's own `SAASignalsFound` / `Scan` journal events (Step 4.3), and
- later, **opt-in** community sync (Phase 10, defaults OFF).

## What each field means

- **`provenance`** (required on every ring): a short note stating that the entry is
  community common knowledge and hand-authored, not copied. The import pipeline
  (`parseSeedFile`) **rejects any ring without a non-empty provenance note**, and a
  test asserts every shipped entry carries one.
- **`coordsApproximate: true`** (set on every shipped system): galactic coordinates in
  the seed are **approximate public reference values**, not survey-grade. Star-system
  coordinates are objective facts about the game galaxy (not creative expression); the
  seed's values are ballpark figures used only for a rough first-run distance sort.
  They are **authoritatively refined** by:
  - **EDSM enrichment** (Step 4.7) — overwrites `x/y/z` with authoritative coordinates
    on upsert, and
  - the commander's own location state as they visit systems.
  Until then, distance sorting for seed-only systems is approximate — surfaced in the
  UI via the `source='seed'` provenance and data-age stamping.
- **`source='seed'`**: every hotspot imported here is tagged `seed`, distinct from
  `journal` (the commander's own scans) and `community` (Phase 10 sync), so the origin
  of every row is always auditable.

## Sources

General community common knowledge only — no single tool or dataset:

- Publicly published player guides, community wikis, and forum threads documenting
  well-known mining destinations (e.g. long-standing Painite metallic-ring sites and
  the famous Low Temperature Diamond location popularised during the community
  "diamond rush").
- The game itself (system/body/ring names and ring types follow the in-game naming
  convention).

## Regenerating / extending

To add locations, append to `hotspots-seed.json` following the same shape and add a
provenance note per ring. Re-running the import is **idempotent** (upsert on natural
keys; `first_seen` preserved, `last_confirmed` refreshed), so re-import never creates
duplicate rows.
