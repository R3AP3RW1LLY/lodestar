/**
 * Egress allowlists (SSOT §5.4). Hosts are matched EXACTLY (no subdomain
 * wildcards). The runtime allowlist governs steady-state app traffic; the
 * install allowlist is used only by the artifact downloader for pinned,
 * hash-verified first-run downloads and is never reachable from runtime code.
 * AI/ML inference hosts are permanently absent from both — enforced by the
 * compliance suite (Step 0.11).
 *
 * Allowlists are exposed as frozen `.has()`-only objects, NOT bare Sets, so
 * they cannot be mutated at runtime to add a host (freezing a Set does not stop
 * `.add()`/`.delete()`, so a real Set would be a false guarantee).
 */

export interface HostAllowlist {
  has: (host: string) => boolean;
}

export function hostAllowlist(hosts: readonly string[]): HostAllowlist {
  const set = new Set(hosts);
  return Object.freeze({ has: (host: string) => set.has(host) });
}

export const RUNTIME_ALLOWLIST: HostAllowlist = hostAllowlist([
  "www.edsm.net",
  "spansh.co.uk",
  "inara.cz",
  "eddn.edcd.io",
  "auth.frontierstore.net",
  "companion.orerve.net",
  "discord.com",
]);

export const INSTALL_ALLOWLIST: HostAllowlist = hostAllowlist([
  "github.com",
  "objects.githubusercontent.com",
  "huggingface.co",
  "registry.ollama.ai",
  "ollama.com",
  "pypi.org",
  "files.pythonhosted.org",
]);

/**
 * Hosts that must NEVER appear in any allowlist. This is asserted by the
 * compliance suite; keeping the list here documents intent at the source.
 */
export const DENIED_AI_HOSTS: readonly string[] = [
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.cohere.ai",
  "api.mistral.ai",
  "bedrock-runtime.us-east-1.amazonaws.com",
  "openai.azure.com",
];
