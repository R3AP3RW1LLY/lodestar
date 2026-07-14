/**
 * Alert framework (SSOT Step 4.11). Persists user alert rules (`alert_rules`, migration
 * 007) and evaluates them against price / cargo signals. Two rule kinds: `price-threshold`
 * (a commodity's best sell price crossing above/below a value) and `cargo-full` (cargo
 * fill % reaching a level — the §1.1 sell-leg trigger). Firing is **edge-triggered** (once
 * per crossing, not while the value is held in the zone) AND **cooldown-throttled**; each
 * fire is handed to the injected `emit` (notification + TTS at the `alert` priority, 2.7).
 * Wing hooks register into this same framework in Phase 9.
 */

import type { Db } from "@lodestar/data";

export type AlertKind = "price-threshold" | "cargo-full";
export type AlertDirection = "above" | "below";

export interface AlertRuleInput {
  readonly kind: AlertKind;
  readonly label?: string;
  readonly commodityId?: string;
  readonly threshold: number;
  readonly direction?: AlertDirection;
  readonly cooldownMs?: number;
  readonly enabled?: boolean;
}

export interface AlertRule {
  readonly id: number;
  readonly kind: AlertKind;
  readonly label: string | null;
  readonly commodityId: string | null;
  readonly threshold: number;
  readonly direction: AlertDirection;
  readonly cooldownMs: number;
  readonly enabled: boolean;
  readonly lastFiredTs: string | null;
  readonly createdAt: string;
}

export interface FiredAlert {
  readonly ruleId: number;
  readonly kind: AlertKind;
  readonly label: string | null;
  readonly commodityId: string | null;
  readonly threshold: number;
  /** The value that crossed the threshold (price or fill %). */
  readonly value: number;
  readonly at: string;
}

interface AlertRuleRow {
  readonly id: number;
  readonly kind: AlertKind;
  readonly label: string | null;
  readonly commodity_id: string | null;
  readonly threshold: number;
  readonly direction: AlertDirection;
  readonly cooldown_ms: number;
  readonly enabled: number;
  readonly last_fired_ts: string | null;
  readonly created_at: string;
}

export interface AlertEngine {
  addRule: (input: AlertRuleInput, at: string) => number;
  setEnabled: (id: number, enabled: boolean) => void;
  deleteRule: (id: number) => void;
  listRules: () => AlertRule[];
  /** Evaluate a commodity's best sell price against its price-threshold rules. */
  evaluatePrice: (commodityId: string, bestPrice: number, at: string) => FiredAlert[];
  /** Evaluate the current cargo fill % against cargo-full rules. */
  evaluateCargo: (fillPct: number, at: string) => FiredAlert[];
}

function toRule(row: AlertRuleRow): AlertRule {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    commodityId: row.commodity_id,
    threshold: row.threshold,
    direction: row.direction,
    cooldownMs: row.cooldown_ms,
    enabled: row.enabled === 1,
    lastFiredTs: row.last_fired_ts,
    createdAt: row.created_at,
  };
}

export function createAlertEngine(db: Db, emit: (alert: FiredAlert) => void): AlertEngine {
  const insert = db.prepare(
    `INSERT INTO alert_rules (kind, label, commodity_id, threshold, direction, cooldown_ms, enabled, created_at)
       VALUES (@kind, @label, @commodityId, @threshold, @direction, @cooldownMs, @enabled, @createdAt)
     RETURNING id`,
  );
  const setEnabledStmt = db.prepare("UPDATE alert_rules SET enabled = @enabled WHERE id = @id");
  const deleteStmt = db.prepare("DELETE FROM alert_rules WHERE id = ?");
  const listStmt = db.prepare("SELECT * FROM alert_rules ORDER BY id");
  const byKindStmt = db.prepare(
    "SELECT * FROM alert_rules WHERE kind = ? AND enabled = 1 ORDER BY id",
  );
  const markFiredStmt = db.prepare("UPDATE alert_rules SET last_fired_ts = @at WHERE id = @id");

  // Edge state per rule: was the value inside the triggering zone last time we saw it?
  const wasTriggered = new Map<number, boolean>();

  function isTriggered(rule: AlertRule, value: number): boolean {
    return rule.direction === "above" ? value >= rule.threshold : value <= rule.threshold;
  }

  function fireIfEdge(rule: AlertRule, value: number, at: string): FiredAlert | undefined {
    const triggered = isTriggered(rule, value);
    const edge = triggered && wasTriggered.get(rule.id) !== true;
    wasTriggered.set(rule.id, triggered);
    if (!edge) return undefined;
    if (
      rule.lastFiredTs !== null &&
      Date.parse(at) - Date.parse(rule.lastFiredTs) < rule.cooldownMs
    ) {
      return undefined; // within cooldown — throttled
    }
    markFiredStmt.run({ id: rule.id, at });
    const alert: FiredAlert = {
      ruleId: rule.id,
      kind: rule.kind,
      label: rule.label,
      commodityId: rule.commodityId,
      threshold: rule.threshold,
      value,
      at,
    };
    emit(alert);
    return alert;
  }

  return {
    addRule: (input, at) =>
      (
        insert.get({
          kind: input.kind,
          label: input.label ?? null,
          commodityId: input.commodityId ?? null,
          threshold: input.threshold,
          direction: input.direction ?? "above",
          cooldownMs: input.cooldownMs ?? 0,
          enabled: (input.enabled ?? true) ? 1 : 0,
          createdAt: at,
        }) as { id: number }
      ).id,
    setEnabled: (id, enabled) => {
      setEnabledStmt.run({ id, enabled: enabled ? 1 : 0 });
    },
    deleteRule: (id) => {
      deleteStmt.run(id);
      wasTriggered.delete(id);
    },
    listRules: () => (listStmt.all() as AlertRuleRow[]).map(toRule),
    evaluatePrice: (commodityId, bestPrice, at) => {
      const fired: FiredAlert[] = [];
      for (const row of byKindStmt.all("price-threshold") as AlertRuleRow[]) {
        const rule = toRule(row);
        if (rule.commodityId !== commodityId) continue;
        const alert = fireIfEdge(rule, bestPrice, at);
        if (alert !== undefined) fired.push(alert);
      }
      return fired;
    },
    evaluateCargo: (fillPct, at) => {
      const fired: FiredAlert[] = [];
      for (const row of byKindStmt.all("cargo-full") as AlertRuleRow[]) {
        const alert = fireIfEdge(toRule(row), fillPct, at);
        if (alert !== undefined) fired.push(alert);
      }
      return fired;
    },
  };
}
