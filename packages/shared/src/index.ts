export { APP_VERSION } from "./version.js";
export type { Ok, Err, Result } from "./result.js";
export {
  ok,
  err,
  isOk,
  isErr,
  map,
  mapErr,
  andThen,
  unwrapOr,
  fromThrowable,
  fromPromise,
} from "./result.js";
export type { DomainError, WireError, WireResult } from "./errors.js";
export { domainError, causeChain, toWireError, toWireResult } from "./errors.js";
export type { Tons, Credits, LightYears, Percent } from "./units.js";
export { tons, credits, lightYears, percent, addTons, addCredits, addLightYears } from "./units.js";
export type { LogLevel, LogFields, Logger } from "./logging.js";
export { LOG_LEVELS, nullLogger } from "./logging.js";
export type {
  AppHealth,
  SettingsSnapshot,
  SettingsSetRequest,
  SecretsPresence,
  SecretsSetRequest,
  GpuInfo,
  TtsAudio,
  TtsTestResult,
  TtsVoiceOption,
  OverlayToggleResult,
  OverlayMode,
  AnalyticsExportRequest,
  AnalyticsExportResult,
  ChannelPayloads,
  Channel,
  Envelope,
  EnvelopeShape,
} from "./channels.js";
export { CHANNELS, envelope, isEnvelope } from "./channels.js";
export type { DataAge, DataAgeLevel } from "./data-age.js";
export { classifyDataAge } from "./data-age.js";
export { isLoopbackUrl } from "./loopback.js";
export type {
  Vec3,
  ProspectedAsteroidEvent,
  AsteroidCrackedEvent,
  MiningRefinedEvent,
  LaunchDroneEvent,
  SaaSignalsFoundEvent,
  ScanEvent,
  CargoEvent,
  MarketSellEvent,
  MarketBuyEvent,
  DockedEvent,
  UndockedEvent,
  FsdJumpEvent,
  SupercruiseEntryEvent,
  SupercruiseExitEvent,
  LocationEvent,
  LoadGameEvent,
  LoadoutEvent,
  MusicEvent,
  UnknownJournalEvent,
  ParsedJournalEvent,
  KnownJournalEventName,
} from "./journal-events.js";
export type {
  StatusFlags,
  StatusFlags2,
  Pips,
  StatusSnapshot,
  CargoItem,
  CargoSnapshot,
  MarketItem,
  MarketSnapshot,
  NavRouteHop,
  NavRouteSnapshot,
  ModuleInfo,
  ModulesSnapshot,
} from "./livefiles.js";
export type {
  ShipState,
  LocationState,
  CargoLineState,
  CargoState,
  Activity,
  RootState,
  StateInput,
} from "./state.js";
export { initialRootState } from "./state.js";
export type { StateDelta } from "./state-delta.js";
export { diffRootState, applyStateDelta, deepEqual } from "./state-delta.js";
export type { SessionSummary, ProspectStats } from "./session.js";
export type { AssayReason, AssayMaterial, AssayVerdictEvent } from "./assay.js";
export type { MiningMethod, Commodity, CommodityId, CommodityLookup } from "./commodities.js";
export {
  COMMODITIES,
  COMMODITY_IDS,
  commodityFromInternal,
  commodityFromEddn,
  commodityById,
} from "./commodities.js";
