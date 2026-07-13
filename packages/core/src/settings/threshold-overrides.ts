/**
 * User threshold overrides (SSOT Step 2.3). The Assay defaults live pure in
 * `@lodestar/intelligence`; a commander's per-commodity×method overrides live
 * here in `core` settings — validated (known commodity, valid method, 0–100 %)
 * and persisted as a JSON array in the `settings` kv under one key. The caller
 * (the Assay orchestrator, 2.6) fetches `list()` and hands it to
 * `mergeThresholds` so overrides win over defaults. Only the user's own data.
 */

import type { Db } from "@lodestar/data";
import { commodityById, domainError, err, ok } from "@lodestar/shared";
import type { DomainError, MiningMethod, Result } from "@lodestar/shared";

export interface ThresholdOverride {
  readonly commodityId: string;
  readonly method: MiningMethod;
  /** Worth-mining proportion (%), 0–100. */
  readonly minProportion: number;
}

export interface ThresholdOverridesStore {
  list: () => readonly ThresholdOverride[];
  set: (override: ThresholdOverride) => Result<void, DomainError>;
  clear: (commodityId: string, method: MiningMethod) => void;
}

const KEY = "assay.threshold-overrides";
const METHODS: readonly MiningMethod[] = ["laser", "deep-core", "subsurface"];

function validate(o: ThresholdOverride): Result<void, DomainError> {
  if (commodityById(o.commodityId) === undefined) {
    return err(domainError("threshold.unknown-commodity", `unknown commodity "${o.commodityId}"`));
  }
  if (!METHODS.includes(o.method)) {
    return err(domainError("threshold.invalid-method", `invalid method "${o.method}"`));
  }
  if (
    typeof o.minProportion !== "number" ||
    Number.isNaN(o.minProportion) ||
    o.minProportion < 0 ||
    o.minProportion > 100
  ) {
    return err(domainError("threshold.invalid-proportion", "minProportion must be 0–100"));
  }
  return ok(undefined);
}

function isOverride(v: unknown): v is ThresholdOverride {
  if (typeof v !== "object" || v === null) return false;
  const o = v as ThresholdOverride;
  return (
    typeof o.commodityId === "string" &&
    typeof o.method === "string" &&
    typeof o.minProportion === "number"
  );
}

export function createThresholdOverridesStore(db: Db): ThresholdOverridesStore {
  const select = db.prepare("SELECT value FROM settings WHERE key = ?");
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );

  const read = (): ThresholdOverride[] => {
    const row = select.get(KEY) as { value: string } | undefined;
    if (row === undefined) return [];
    try {
      const parsed: unknown = JSON.parse(row.value);
      if (!Array.isArray(parsed)) return [];
      // Drop entries that fail the SHAPE guard AND re-run the SEMANTIC validator —
      // a tampered row (unknown commodity, out-of-range %) must never become a live
      // override just because it was structurally well-formed. Never crashes.
      return parsed.filter(isOverride).filter((o) => validate(o).ok);
    } catch {
      return [];
    }
  };
  const write = (list: readonly ThresholdOverride[]): void => {
    upsert.run(KEY, JSON.stringify(list));
  };
  const isSame = (o: ThresholdOverride, commodityId: string, method: MiningMethod): boolean =>
    o.commodityId === commodityId && o.method === method;

  return {
    list: () => read(),
    set(override) {
      const valid = validate(override);
      if (!valid.ok) return valid;
      const next = read().filter((o) => !isSame(o, override.commodityId, override.method));
      next.push(override);
      write(next);
      return ok(undefined);
    },
    clear(commodityId, method) {
      write(read().filter((o) => !isSame(o, commodityId, method)));
    },
  };
}
