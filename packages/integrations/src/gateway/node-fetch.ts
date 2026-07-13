/**
 * The real HTTP transport (SSOT §5.4). This lives in the sanctioned gateway dir —
 * the ONLY place a bare `fetch` is permitted by the egress-firewall lint — and is
 * injected into the gateway / artifact downloader as their `FetchFn`, so the rest
 * of the app performs network I/O only through those guarded, allowlisted paths and
 * never touches a raw network API directly.
 */

import type { FetchFn } from "./gateway.js";

export const nodeFetch: FetchFn = (url, init) => fetch(url, init);
