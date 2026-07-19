import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./ApiError";
import { openSseStream } from "./sseStream";

// PR #81 round-2 convergence, Finding 3 -- transport-level tests for the
// shared SSE seam, moved out of useMonitorStream.test.tsx (which keeps its
// own state-machine-level MSW tests unchanged; the helper still hits the
// same URL). Same "vi.spyOn(globalThis, 'fetch')" idiom as http.test.ts,
// rather than MSW, since this exercises the raw-fetch transport itself, not
// a consumer of it.

// Same controlled-ReadableStream idiom as useMonitorStream.test.tsx's own
// makeSseStream helper (see that file's comment for the streaming-body
// rationale), duplicated locally rather than shared/imported across a
// features/ <-> shared/api/ boundary.
function makeStream() {
  let controllerRef!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
  });
  const encoder = new TextEncoder();
  return {
    stream,
    push(frame: string) {
      controllerRef.enqueue(encoder.encode(frame));
    },
    close() {
      controllerRef.close();
    },
    error(err: unknown = new Error("stream error")) {
      controllerRef.error(err);
    },
  };
}

describe("openSseStream", () => {
  beforeEach(() => {
    localStorage.clear();
    window.__ENV__ = { API_URL: "http://api.test" };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.__ENV__ = undefined;
  });

  it("requests the base-URL-qualified path with Accept: text/event-stream and no Authorization when unauthenticated", async () => {
    const { stream, close } = makeStream();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(stream, { status: 200 }));
    close();

    const controller = new AbortController();
    await openSseStream("/api/events/evt-1/monitor/stream", { signal: controller.signal, onEvent: () => {} });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/api/events/evt-1/monitor/stream");
    const headers = new Headers(init.headers);
    expect(headers.get("Accept")).toBe("text/event-stream");
    expect(headers.get("Authorization")).toBeNull();
    expect(init.signal).toBe(controller.signal);
  });

  it("attaches the Authorization header when a token exists", async () => {
    localStorage.setItem("token", "jwt-abc");
    const { stream, close } = makeStream();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(stream, { status: 200 }));
    close();

    const controller = new AbortController();
    await openSseStream("/api/events/evt-1/monitor/stream", { signal: controller.signal, onEvent: () => {} });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer jwt-abc");
  });

  it("throws an ApiError built from a non-ok JSON response, without ever reading a body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "tenant_suspended", error: "Tenant is suspended" }), { status: 403 }),
    );

    const controller = new AbortController();
    await expect(
      openSseStream("/api/events/evt-1/monitor/stream", { signal: controller.signal, onEvent: () => {} }),
    ).rejects.toMatchObject(new ApiError(403, "tenant_suspended", "Tenant is suspended"));
  });

  it("throws an ApiError with statusText when the error body is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("gateway timeout", { status: 502, statusText: "Bad Gateway" }),
    );

    const controller = new AbortController();
    await expect(
      openSseStream("/api/events/evt-1/monitor/stream", { signal: controller.signal, onEvent: () => {} }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("throws when the ok response has no body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    const controller = new AbortController();
    await expect(
      openSseStream("/api/events/evt-1/monitor/stream", { signal: controller.signal, onEvent: () => {} }),
    ).rejects.toThrow(/no body/);
  });

  it("parses SSE frames delivered on the stream body and dispatches decoded events in order", async () => {
    const { stream, push, close } = makeStream();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(stream, { status: 200 }));

    const events: { event: string; data: string }[] = [];
    const controller = new AbortController();
    const promise = openSseStream("/api/events/evt-1/monitor/stream", {
      signal: controller.signal,
      onEvent: (evt) => events.push(evt),
    });

    push("event: hello\ndata: {}\n\n");
    push('event: update\ndata: {"at":"t1"}\n\n');
    close();
    await promise;

    expect(events).toEqual([
      { event: "hello", data: "{}" },
      { event: "update", data: '{"at":"t1"}' },
    ]);
  });

  it("resolves once the stream closes cleanly", async () => {
    const { stream, close } = makeStream();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(stream, { status: 200 }));
    close();

    const controller = new AbortController();
    await expect(
      openSseStream("/api/events/evt-1/monitor/stream", { signal: controller.signal, onEvent: () => {} }),
    ).resolves.toBeUndefined();
  });

  it("propagates a network error thrown by fetch itself", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    const controller = new AbortController();
    await expect(
      openSseStream("/api/events/evt-1/monitor/stream", { signal: controller.signal, onEvent: () => {} }),
    ).rejects.toThrow("Failed to fetch");
  });

  it("propagates an error raised mid-stream by the reader", async () => {
    const { stream, error } = makeStream();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(stream, { status: 200 }));

    const controller = new AbortController();
    const promise = openSseStream("/api/events/evt-1/monitor/stream", {
      signal: controller.signal,
      onEvent: () => {},
    });
    error(new Error("boom"));

    await expect(promise).rejects.toThrow("boom");
  });
});
