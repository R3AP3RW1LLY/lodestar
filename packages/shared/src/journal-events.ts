/**
 * Parsed journal-event domain types (SSOT §5.1 / Step 1.5). The closed
 * discriminated union LODESTAR consumes, keyed on `event`. Field names are
 * normalized to camelCase; only the fields §5.1 lists as consumed are modeled.
 * Carrier events (§5.1) are parsed in Phase 8. An event not in the union parses
 * to `UnknownJournalEvent` (never dropped, never a throw).
 */

export type Vec3 = readonly [number, number, number];

export interface ProspectedAsteroidEvent {
  readonly event: "ProspectedAsteroid";
  readonly timestamp: string;
  readonly materials: readonly { readonly name: string; readonly proportion: number }[];
  readonly content: string;
  readonly remaining: number;
  readonly motherlodeMaterial?: string;
}

export interface AsteroidCrackedEvent {
  readonly event: "AsteroidCracked";
  readonly timestamp: string;
  readonly body: string;
}

export interface MiningRefinedEvent {
  readonly event: "MiningRefined";
  readonly timestamp: string;
  readonly type: string;
  readonly typeLocalised?: string;
}

export interface LaunchDroneEvent {
  readonly event: "LaunchDrone";
  readonly timestamp: string;
  readonly droneType: string;
}

export interface SaaSignalsFoundEvent {
  readonly event: "SAASignalsFound";
  readonly timestamp: string;
  readonly bodyName: string;
  readonly systemAddress: number;
  readonly bodyId: number;
  readonly signals: readonly { readonly type: string; readonly count: number }[];
}

export interface ScanEvent {
  readonly event: "Scan";
  readonly timestamp: string;
  readonly bodyName: string;
  readonly bodyId: number;
  readonly systemAddress: number;
  readonly reserveLevel?: string;
  readonly rings?: readonly {
    readonly name: string;
    readonly ringClass: string;
    readonly massMt: number;
    readonly innerRad: number;
    readonly outerRad: number;
  }[];
}

export interface CargoEvent {
  readonly event: "Cargo";
  readonly timestamp: string;
  readonly vessel: string;
  readonly count: number;
  readonly inventory?: readonly {
    readonly name: string;
    readonly count: number;
    readonly stolen: number;
  }[];
}

export interface MarketSellEvent {
  readonly event: "MarketSell";
  readonly timestamp: string;
  readonly marketId: number;
  readonly type: string;
  readonly count: number;
  readonly sellPrice: number;
  readonly totalSale: number;
  readonly avgPricePaid: number;
}

export interface MarketBuyEvent {
  readonly event: "MarketBuy";
  readonly timestamp: string;
  readonly marketId: number;
  readonly type: string;
  readonly count: number;
  readonly buyPrice: number;
  readonly totalCost: number;
}

export interface DockedEvent {
  readonly event: "Docked";
  readonly timestamp: string;
  readonly stationName: string;
  readonly stationType: string;
  readonly starSystem: string;
  readonly systemAddress: number;
  readonly marketId: number;
  readonly distFromStarLs?: number;
  readonly landingPads?: {
    readonly small: number;
    readonly medium: number;
    readonly large: number;
  };
}

export interface UndockedEvent {
  readonly event: "Undocked";
  readonly timestamp: string;
  readonly stationName: string;
  readonly marketId?: number;
}

export interface FsdJumpEvent {
  readonly event: "FSDJump";
  readonly timestamp: string;
  readonly starSystem: string;
  readonly systemAddress: number;
  readonly starPos: Vec3;
  readonly jumpDist: number;
  readonly fuelUsed: number;
  readonly fuelLevel: number;
}

export interface SupercruiseEntryEvent {
  readonly event: "SupercruiseEntry";
  readonly timestamp: string;
  readonly starSystem: string;
  readonly body?: string;
  readonly bodyType?: string;
}

export interface SupercruiseExitEvent {
  readonly event: "SupercruiseExit";
  readonly timestamp: string;
  readonly starSystem: string;
  readonly body?: string;
  readonly bodyType?: string;
}

export interface LocationEvent {
  readonly event: "Location";
  readonly timestamp: string;
  readonly starSystem: string;
  readonly systemAddress: number;
  readonly starPos: Vec3;
  readonly docked: boolean;
  readonly body?: string;
  readonly bodyType?: string;
}

export interface LoadGameEvent {
  readonly event: "LoadGame";
  readonly timestamp: string;
  readonly commander: string;
  readonly fid: string;
  readonly ship: string;
  readonly shipName: string;
  readonly gameMode?: string;
}

export interface LoadoutEvent {
  readonly event: "Loadout";
  readonly timestamp: string;
  readonly ship: string;
  readonly shipName: string;
  readonly shipIdent?: string;
  readonly modules: readonly { readonly slot: string; readonly item: string }[];
  readonly cargoCapacity: number;
  readonly maxJumpRange: number;
}

export interface MusicEvent {
  readonly event: "Music";
  readonly timestamp: string;
  readonly musicTrack: string;
}

export interface UnknownJournalEvent {
  readonly event: "Unknown";
  readonly timestamp: string;
  /** The original `event` name from the journal line. */
  readonly rawEvent: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type ParsedJournalEvent =
  | ProspectedAsteroidEvent
  | AsteroidCrackedEvent
  | MiningRefinedEvent
  | LaunchDroneEvent
  | SaaSignalsFoundEvent
  | ScanEvent
  | CargoEvent
  | MarketSellEvent
  | MarketBuyEvent
  | DockedEvent
  | UndockedEvent
  | FsdJumpEvent
  | SupercruiseEntryEvent
  | SupercruiseExitEvent
  | LocationEvent
  | LoadGameEvent
  | LoadoutEvent
  | MusicEvent
  | UnknownJournalEvent;

/** The journal event names LODESTAR parses into typed domain events (non-carrier §5.1). */
export type KnownJournalEventName = Exclude<ParsedJournalEvent["event"], "Unknown">;
