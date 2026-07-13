/**
 * Display formatters for the Command Deck (Step 1.10). Pure + locale-pinned
 * ("en-US") so rendered values are deterministic across machines and in tests.
 * An absent value renders as an em-dash rather than "undefined"/"NaN".
 */

export const DASH = "—";

export function fmtInt(n: number | undefined): string {
  return n === undefined ? DASH : Math.round(n).toLocaleString("en-US");
}

export function fmtNum(n: number | undefined, digits = 1): string {
  return n === undefined
    ? DASH
    : n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtCredits(n: number | undefined): string {
  return n === undefined ? DASH : `${Math.round(n).toLocaleString("en-US")} cr`;
}

export function fmtText(s: string | undefined): string {
  return s === undefined || s === "" ? DASH : s;
}
