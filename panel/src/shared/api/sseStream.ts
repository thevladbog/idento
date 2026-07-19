import { apiErrorFromResponse, getApiBaseUrl } from "./http";
import { createSseParser } from "./parseSse";
import { getToken } from "./session";

export interface SseEvent {
  event: string;
  data: string;
}

export interface OpenSseStreamOptions {
  signal: AbortSignal;
  onEvent: (evt: SseEvent) => void;
}

// Shared SSE transport seam (PR #81 round-2 convergence, Finding 3). Round 1
// centralized base-URL/auth/error pieces in shared/api/ but left the raw
// `fetch(...)` call itself inside the feature hook (useMonitorStream.ts),
// which violates panel/AGENTS.md's "never call fetch directly from a
// feature/component" rule. `openapi-fetch` (the `api` client in http.ts) has
// no streaming-body mode, so it can't drive a stream-consume loop -- this
// hand-rolled transport is the one sanctioned exception, but it now lives
// behind this single thin helper instead of being inlined in feature code.
//
// Owns: URL construction off the shared base URL (`getApiBaseUrl`), the
// Authorization header via `getToken()`, the `Accept: text/event-stream`
// header, non-OK -> `ApiError` construction (`apiErrorFromResponse`, the
// exact shape the `api` client itself throws), and the
// reader/decoder/`createSseParser` consume loop.
//
// Resolves once the stream closes cleanly (e.g. the server ends the request
// context) -- an ordinary, expected outcome the caller decides how to react
// to (useMonitorStream.ts treats it as "reconnect"). Rejects with:
//  - the constructed `ApiError` for a non-OK response,
//  - a plain `Error` if an OK response has no body,
//  - whatever `fetch`/the reader itself throws for a network error, a
//    stream error, or an aborted request (the caller's own `AbortSignal`).
// Every retry/backoff/terminal-vs-transient DECISION based on any of the
// above belongs to the caller's state machine -- this helper only performs
// the transport and reports what happened, exactly like a "regular" `fetch`
// call would.
export async function openSseStream(path: string, opts: OpenSseStreamOptions): Promise<void> {
  const { signal, onEvent } = opts;

  const headers: Record<string, string> = { Accept: "text/event-stream" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${getApiBaseUrl()}${path}`, { headers, signal });

  if (!res.ok) {
    throw await apiErrorFromResponse(res);
  }
  if (!res.body) {
    throw new Error("SSE stream response has no body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const feed = createSseParser(onEvent);

  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    feed(decoder.decode(value, { stream: true }));
  }
}
