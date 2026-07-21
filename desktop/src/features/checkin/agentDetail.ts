// Formats the agent's version + effective host:port for display next to the
// "agent" status node (Run.tsx) and Equipment's connection section -- the
// same derivation in both places, so it lives here once instead of twice.
import { getAgentExternalConfig } from "../../lib/agentConfig";

export function formatAgentDetail(
  mode: "embedded" | "external",
  version: string | undefined,
  embeddedPort: number | undefined,
): string | undefined {
  const versionPart = version ? `v${version}` : undefined;

  let addressPart: string | undefined;
  if (mode === "external") {
    try {
      addressPart = new URL(getAgentExternalConfig().baseUrl).host || undefined;
    } catch {
      addressPart = undefined;
    }
  } else if (embeddedPort) {
    addressPart = `:${embeddedPort}`;
  }

  const parts = [versionPart, addressPart].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
