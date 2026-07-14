/**
 * Inara inapi/v1 client (SSOT Step 4.9, feature-flagged). Requires an API key (read from
 * secrets by the caller and injected here) — **without a key it is disabled** and makes no
 * network call. Market-reference queries are batched into as few inapi/v1 POSTs as Inara's
 * terms allow, all through the Step-4.6 ApiClient, so the §5.3 rate limit (≤ 2 req/min)
 * and backoff apply. POSTs are uncached (auth + per-body); a body-keyed 2 h market cache is
 * a later refinement. The exact market event schema is provisional (verify against live).
 */

import type { CommodityId, DomainError, Result } from "@lodestar/shared";
import { commodityById, domainError, err, ok } from "@lodestar/shared";
import type { ApiClient } from "../gateway/client.js";
import type { InaraCommodityPrice } from "./parse.js";
import { parseInaraCommodityPrices, parseInaraEnvelope } from "./parse.js";

const INARA_ENDPOINT = "https://inara.cz/inapi/v1/";
const DEFAULT_MAX_EVENTS = 100;

export interface InaraConfig {
  readonly appName: string;
  readonly appVersion: string;
  readonly apiKey?: string;
  readonly commanderName?: string;
  readonly isBeingDeveloped?: boolean;
}

export interface InaraDeps {
  readonly api: ApiClient;
  readonly config: InaraConfig;
  readonly nowIso: () => string;
  readonly maxEventsPerRequest?: number;
}

export interface CommodityQuery {
  readonly commodityId: CommodityId;
}

export interface InaraClient {
  /** True only when an API key is configured. */
  isEnabled: () => boolean;
  /** Batched market-reference lookup for the given commodities. */
  commodityPrices: (
    queries: readonly CommodityQuery[],
  ) => Promise<Result<InaraCommodityPrice[], DomainError>>;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export function createInaraClient(deps: InaraDeps): InaraClient {
  const { config } = deps;
  const maxEvents = deps.maxEventsPerRequest ?? DEFAULT_MAX_EVENTS;
  const hasKey = (): boolean => config.apiKey !== undefined && config.apiKey.length > 0;

  return {
    isEnabled: hasKey,

    async commodityPrices(queries) {
      if (!hasKey()) {
        return err(domainError("inara/disabled", "Inara is disabled — no API key configured"));
      }
      const resolvable = queries.filter((q) => commodityById(q.commodityId) !== undefined);
      if (resolvable.length === 0) return ok([]);

      const all: InaraCommodityPrice[] = [];
      for (const batch of chunk(resolvable, maxEvents)) {
        const body = {
          header: {
            appName: config.appName,
            appVersion: config.appVersion,
            isBeingDeveloped: config.isBeingDeveloped ?? false,
            APIkey: config.apiKey,
            ...(config.commanderName === undefined ? {} : { commanderName: config.commanderName }),
          },
          events: batch.map((q) => ({
            eventName: "getCommodityPrices",
            eventTimestamp: deps.nowIso(),
            eventData: {
              commodityName: commodityById(q.commodityId)?.displayName ?? q.commodityId,
            },
          })),
        };
        const result = await deps.api.request({
          url: INARA_ENDPOINT,
          ttlMs: 0,
          init: {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        });
        if (!result.ok) return err(result.error);
        let json: unknown;
        try {
          json = JSON.parse(result.value.body);
        } catch {
          return err(domainError("inara/bad-json", "Inara response was not valid JSON"));
        }
        const envelope = parseInaraEnvelope(json);
        if (!envelope.ok) return err(envelope.error);
        for (const event of envelope.value.events) {
          all.push(...parseInaraCommodityPrices(event.data));
        }
      }
      return ok(all);
    },
  };
}
