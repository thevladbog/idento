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

/** Returns the agent's configured default printer name, or null if unset. */
async function getDefaultPrinter(): Promise<string | null> {
  const response = await ensureOk(
    await fetch(agentUrl("/printers/default")),
    "agent GET /printers/default failed",
  );
  const data = (await response.json()) as { default: string | null };
  return data.default ?? null;
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
  getDefaultPrinter,
  print,
  consumeLastScan,
};
