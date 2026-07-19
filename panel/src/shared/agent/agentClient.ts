import { getAgentBaseUrl } from "../api/http";

// Typed fetch wrappers for the local print agent — a separate origin from
// the backend API (NOT in backend/openapi.yaml, NOT behind `$api`; see
// agent/openapi.yaml for the agent's own contract). Browser clients reach it
// through the agent's Origin-allowlist fallback (agent/internal/httpauth) —
// deliberately NO Authorization header here, mirroring web/src/lib/agent.ts.

export interface AgentPrinter {
  name: string;
  type: "system" | "network";
}

/**
 * One com scanner the agent currently has open (agent/openapi.yaml's
 * GET /scanners, tag "Scanners") -- `port_name` (e.g. "COM3") is the stable
 * agent-side identity link P4.3's equipment registry matches against
 * (config.port_name on a kind=com EquipmentDevice, spec §5.2) -- `name` is
 * just the agent's own display label for the open scanner, not a link key.
 * Unlike AgentPrinter there is no system/network `type` to narrow here --
 * GET /scanners only ever reports com scanners the agent has explicitly
 * opened (via /scanners/add); usb_wedge scanners are a browser-side input
 * method the agent has no visibility into at all (see equipment/reconcile.ts).
 */
export interface AgentScanner {
  name: string;
  port_name: string;
}

export interface PrintRequest {
  printer_name: string;
  zpl: string;
}

// Reads getAgentBaseUrl() fresh on every call (not once at module load) so
// a later window.__ENV__.AGENT_URL swap (e.g. between tests) takes effect —
// same "read fresh each request" principle as http.ts's dynamicBaseUrl
// middleware, just applied directly since this client has no middleware
// layer of its own.
function agentUrl(path: string): string {
  return `${getAgentBaseUrl()}${path}`;
}

// The agent's error responses are plain text, not JSON (per agent/openapi.yaml's
// "Тело всех ответов об ошибках — plain text"), so surface that text verbatim
// in the thrown error rather than a bare status code — future callers (e.g.
// the test-print dialog's in-dialog error message) get something a user can
// actually read instead of "agent POST /print failed: 404".
async function ensureOk(response: Response, context: string): Promise<Response> {
  if (response.ok) return response;
  const body = await response.text().catch(() => "");
  throw new Error(body ? `${context}: ${body}` : `${context} (HTTP ${response.status})`);
}

/**
 * Returns true only if the agent responds to GET /health within
 * `timeoutMs` (default 2000ms, matching web/src/lib/agent.ts's
 * checkHealth timeout — web parity). Any failure — network error, non-2xx
 * status, or the abort firing before a response arrives — resolves to
 * false rather than rejecting: useAgentPrinters treats "unreachable" as a
 * normal, expected connectivity state, not an exceptional one.
 *
 * `timeoutMs` is an injectable override purely so tests can exercise the
 * abort path with a short delay instead of a real 2s wait or fake-timer
 * gymnastics around AbortController.
 */
async function checkHealth(timeoutMs = 2000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(agentUrl("/health"), { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Returns every printer the agent currently knows about (system + network). */
async function getPrinters(): Promise<AgentPrinter[]> {
  const response = await ensureOk(await fetch(agentUrl("/printers")), "agent GET /printers failed");
  const data = (await response.json()) as Array<{ name: string; type?: string }>;
  return data.map((printer) => ({
    name: printer.name,
    type: printer.type === "network" ? ("network" as const) : ("system" as const),
  }));
}

/**
 * Returns every com scanner the agent currently has open (agent/openapi.yaml's
 * GET /scanners) -- usb_wedge scanners never appear here (see AgentScanner's
 * doc comment); an agent with no com scanner opened returns an empty array,
 * not an error.
 */
async function getScanners(): Promise<AgentScanner[]> {
  const response = await ensureOk(await fetch(agentUrl("/scanners")), "agent GET /scanners failed");
  const data = (await response.json()) as Array<{ name: string; port_name: string }>;
  return data.map((scanner) => ({ name: scanner.name, port_name: scanner.port_name }));
}

/**
 * P4.3 Task 9 -- the scanner wizard's COM port picker (agent/openapi.yaml's
 * GET /scanners/ports, tag "Scanners"). The agent's raw response carries
 * optional USB metadata (display_name, vendor_id, manufacturer, …) per
 * port, but `port_name` (e.g. "COM3") is the only field this app ever
 * needs -- it's both what the wizard lists and the stable identity link
 * stored as a com scanner device's `config.port_name` (P4.3 spec §5.2),
 * same "narrow the agent's response to what this app actually uses" idiom
 * as getPrinters' `type` narrowing above. An agent that fails to enumerate
 * ports returns an empty array itself (agent/openapi.yaml's own doc
 * comment), not an error -- nothing extra to normalize here for that case.
 */
async function getScannerPorts(): Promise<string[]> {
  const response = await ensureOk(await fetch(agentUrl("/scanners/ports")), "agent GET /scanners/ports failed");
  const data = (await response.json()) as Array<{ port_name: string }>;
  return data.map((port) => port.port_name);
}

/**
 * P4.3 Task 9 -- opens a COM/USB scanner on `port` and adds it to the
 * agent's own allow-list (agent/openapi.yaml's `ScannerRequest`/POST
 * /scanners/add, tag "Scanners"). Idempotent on the agent's side (a port
 * already open answers status=exists, still 200) -- this client discards
 * the response body either way, same "we sent it, we already know it"
 * rationale as addNetworkPrinter above; the wizard already knows the port
 * it just picked.
 */
async function addComScanner(port: string): Promise<void> {
  const response = await fetch(agentUrl("/scanners/add"), {
    method: "POST",
    // Required for the agent's Origin-allowlist browser fallback auth on
    // mutating requests (see agent/openapi.yaml's Авторизация section) --
    // without it a same-origin-allowlisted-but-tokenless request gets 415.
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ port_name: port }),
  });
  await ensureOk(response, "agent POST /scanners/add failed");
}

/**
 * P4.3 Task 9 -- closes a COM/USB scanner and removes it from the agent's
 * allow-list (agent/openapi.yaml's `ScannerRequest`/POST /scanners/remove).
 * The equipment hub's DeviceCard delete flow calls this best-effort for a
 * kind=com device (EquipmentPage.tsx) -- warn, don't fail the registry
 * delete that already succeeded, same "mirror is a convenience, not the
 * source of truth" posture as setDefaultPrinter's callers.
 *
 * `portName` (not the agent's own display `name`, e.g. "Scanner_COM3") is
 * the correct argument here: agent/openapi.yaml's `ScannerRequest` schema
 * -- shared by BOTH /scanners/add and /scanners/remove -- has exactly one
 * field, `port_name`. There is no separate "remove by display name"
 * identifier to reconcile against; the registry's own `config.port_name`
 * (the same stable link reconcile.ts already matches devices against) is
 * already the exact value this endpoint expects, with no extra
 * live-list lookup needed.
 */
async function removeComScanner(portName: string): Promise<void> {
  const response = await fetch(agentUrl("/scanners/remove"), {
    method: "POST",
    // Required for the agent's Origin-allowlist browser fallback auth on
    // mutating requests (see agent/openapi.yaml's Авторизация section) --
    // without it a same-origin-allowlisted-but-tokenless request gets 415.
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ port_name: portName }),
  });
  await ensureOk(response, "agent POST /scanners/remove failed");
}

/** Returns the agent's configured default printer name, or null if unset. */
async function getDefaultPrinter(): Promise<string | null> {
  const response = await ensureOk(
    await fetch(agentUrl("/printers/default")),
    "agent GET /printers/default failed",
  );
  const data = (await response.json()) as { default: string | null };
  return data.default ?? null;
}

export interface AddNetworkPrinterRequest {
  name: string;
  ip: string;
  port: number;
}

/**
 * P4.3 Task 8 -- registers a network printer with the agent by IP (agent/
 * openapi.yaml's `NetworkPrinterRequest`/POST /printers/add), the printer
 * wizard's "Enter IP manually" escape hatch (board 5b). The 201 response
 * echoes back `{status, name, address}`, but it's discarded on purpose:
 * the wizard already knows the name it just sent (`request.name`) and
 * selects the printer by THAT, same "we sent it, we already know it"
 * rationale as `print`'s discarded transport-ack body.
 */
async function addNetworkPrinter(request: AddNetworkPrinterRequest): Promise<void> {
  const response = await fetch(agentUrl("/printers/add"), {
    method: "POST",
    // Required for the agent's Origin-allowlist browser fallback auth on
    // mutating requests (see agent/openapi.yaml's Авторизация section) --
    // without it a same-origin-allowlisted-but-tokenless request gets 415.
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  await ensureOk(response, "agent POST /printers/add failed");
}

/**
 * P4.3 Task 8 -- sets the agent's own configured default printer (agent/
 * openapi.yaml's POST /printers/default). This is a MIRROR of the
 * equipment registry's `make_default` rule (spec §5.3 "server-wins" --
 * the registry write already succeeded and is the source of truth before
 * this is ever called); a failure here must never be treated as the save
 * itself failing by callers -- see PrinterWizard.tsx's Save handler.
 */
async function setDefaultPrinter(name: string): Promise<void> {
  const response = await fetch(agentUrl("/printers/default"), {
    method: "POST",
    // Required for the agent's Origin-allowlist browser fallback auth on
    // mutating requests (see agent/openapi.yaml's Авторизация section) --
    // without it a same-origin-allowlisted-but-tokenless request gets 415.
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ default: name }),
  });
  await ensureOk(response, "agent POST /printers/default failed");
}

/**
 * Thrown when POST /print produced no response within the timeout (follow-up
 * batch item 2: a wedged agent SendRaw — connection accepted, response never
 * comes — used to leave print() pending forever, freezing the print dialogs
 * whose dismissal is deliberately locked while a send is in flight).
 * IMPORTANT for callers' copy: the abort only cancels the CLIENT's wait, not
 * the send — the agent may well have received the job, so the badge can
 * still emerge from the printer. Never present this as "nothing printed".
 */
export class AgentPrintTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`agent POST /print produced no response within ${timeoutMs}ms — the badge may still print`);
    this.name = "AgentPrintTimeoutError";
  }
}

// Generous by design: it must comfortably exceed the agent's own worst
// honest path (5s TCP dial to a network printer + writing a raster-heavy
// ZPL payload) so it only ever fires on a genuinely wedged send, never a
// merely slow one — a false timeout on a job that then prints would read
// as "failed" and invite a double print.
const PRINT_TIMEOUT_MS = 30_000;

/**
 * Sends a print job. The 200 response here is a TRANSPORT ack only — it
 * means the agent handed the ZPL bytes to the printer's serial/network
 * connection, NOT that the label physically printed (reconciliation #5,
 * docs/superpowers/plans/2026-07-16-panel-p3.2-print-truth.md). The
 * response body is discarded on purpose: nothing in it upgrades this into
 * a print confirmation, so callers must not present success copy as
 * "printed" — see the test-print dialog's "Sent to {{printer}}" wording.
 *
 * `timeoutMs` is an injectable override purely so tests can exercise the
 * abort path with a short delay — same idiom as checkHealth above.
 */
async function print(request: PrintRequest, timeoutMs = PRINT_TIMEOUT_MS): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(agentUrl("/print"), {
      method: "POST",
      // Required for the agent's Origin-allowlist browser fallback auth on
      // mutating requests (see agent/openapi.yaml's Авторизация section) —
      // without it a same-origin-allowlisted-but-tokenless request gets 415.
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    await ensureOk(response, "agent POST /print failed");
  } catch (error) {
    // Only OUR timer's abort becomes a timeout — every other failure
    // (refused connection, the agent's own error status via ensureOk)
    // rethrows untouched so callers keep the agent's verbatim error text.
    if (controller.signal.aborted) throw new AgentPrintTimeoutError(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The agent's own identity/version info, per agent/openapi.yaml's `Info`
 * schema (Task 1 of P4.3 -- confirmed present in the agent's own contract,
 * GET /info, unauthenticated). `machine_id` is the stable per-machine
 * identifier the equipment hub (board 5a/5d) keys saved printers/scanners
 * against, so it survives across agent restarts/reinstalls.
 */
export interface AgentInfo {
  machine_id: string;
  hostname: string;
  version: string;
  uptime_seconds: number;
}

/**
 * Returns the agent's identity/version info, or null when the agent is a
 * pre-P4.3 build that has no /info route at all (a plain 404, checked
 * BEFORE ensureOk so that specific case never becomes a thrown error) --
 * this null is useAgentInfo's `connected_legacy` trigger (board 5d: an
 * old agent binary is healthy/reachable but can't report its identity).
 * Every OTHER non-2xx status is a genuine failure and throws, same as
 * every other agentClient method.
 */
async function getInfo(): Promise<AgentInfo | null> {
  const response = await fetch(agentUrl("/info"));
  if (response.status === 404) return null;
  const ok = await ensureOk(response, "agent GET /info failed");
  return (await ok.json()) as AgentInfo;
}

/**
 * The agent's last-scanned-code buffer, per agent/openapi.yaml's `ScanData`
 * schema -- confirmed present in the agent's own contract (path
 * `/scan/consume`, tag "Scan"), not a panel-side invention. When nothing has
 * been scanned since the last consume, the agent returns `code: ""`, `time:
 * "0001-01-01T00:00:00Z"` -- this is a normal "no new scan" poll result, not
 * an error.
 */
export interface ScanData {
  code: string;
  time: string;
}

/**
 * Polling primitive for P4.1's handheld-scanner check-in mode
 * (useScanInput.ts) -- atomically reads AND clears the agent's last-scan
 * buffer in one request (`POST /scan/consume`), replacing the earlier
 * GET /scan/last + POST /scan/clear pair. That two-step protocol had a real
 * race: a second physical scan arriving between this client's read and its
 * later clear call was silently erased by the clear (the CodeRabbit finding
 * on panel PR #77, fixed agent-side by
 * docs/superpowers/plans/2026-07-18-agent-atomic-scan-consume.md). Because
 * read+clear now happen server-side under one lock, every non-empty
 * response here is guaranteed to be a scan this client has never seen
 * before -- callers no longer need to dedup by {code, time} or separately
 * retry a failed clear (see useScanInput.ts). Never throws on an empty
 * buffer (that's the normal steady state between scans); only a genuine
 * transport/HTTP failure (agent unreachable, non-2xx) rejects, same "throw
 * on failure" contract as getPrinters/getDefaultPrinter above.
 */
async function consumeLastScan(): Promise<ScanData> {
  const response = await ensureOk(
    await fetch(agentUrl("/scan/consume"), {
      method: "POST",
      // Required for the agent's Origin-allowlist browser fallback auth on
      // mutating requests (see agent/openapi.yaml's Авторизация section) --
      // without it a same-origin-allowlisted-but-tokenless request gets 415.
      headers: { "Content-Type": "application/json" },
    }),
    "agent POST /scan/consume failed",
  );
  const data = (await response.json()) as { code?: string; time?: string };
  return { code: data.code ?? "", time: data.time ?? "" };
}

export const agentClient = {
  checkHealth,
  getPrinters,
  getScanners,
  getScannerPorts,
  addComScanner,
  removeComScanner,
  getDefaultPrinter,
  addNetworkPrinter,
  setDefaultPrinter,
  getInfo,
  print,
  consumeLastScan,
};
