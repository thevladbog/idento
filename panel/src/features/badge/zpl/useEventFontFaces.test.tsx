// P3.2 Task 2 -- useEventFontFaces tests.
//
// jsdom implements neither the CSS Font Loading API's `FontFace` constructor
// nor `document.fonts` (verified empirically against this project's jsdom
// version -- `"FontFace" in window` is `false`, `document.fonts` is
// `undefined` but freely assignable). Tests that exercise the loading path
// stand up a minimal mock of both in `beforeEach`; the one test that wants
// the real jsdom absence (the hook's idle-guard path) tears the mock back
// down first.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { useEventFontFaces } from "./useEventFontFaces";
import { startMswServer } from "../../../test/msw";

function fontListItem(id: string, family: string) {
  return {
    id,
    name: family,
    family,
    weight: "normal",
    style: "normal",
    format: "opentype" as const,
    size: 1000,
    created_at: "2026-01-01T00:00:00Z",
  };
}

let fontsFetchCount = 0;
let fileFetchCount = 0;

// Arbitrary bytes -- MockFontFace never parses them; what matters is that
// the hook fetches them THROUGH the authenticated api client and hands the
// resulting ArrayBuffer (not a url() string) to the FontFace constructor.
const FAKE_FONT_BYTES = new TextEncoder().encode("fake-font-bytes").buffer as ArrayBuffer;

const server = startMswServer(
  http.get("http://api.test/api/events/:eventId/fonts", () => {
    fontsFetchCount += 1;
    return HttpResponse.json([fontListItem("f1", "GoodFont"), fontListItem("f2", "BadFont")]);
  }),
  http.get("http://api.test/api/fonts/:id/file", () => {
    fileFetchCount += 1;
    return HttpResponse.arrayBuffer(FAKE_FONT_BYTES);
  }),
);
void server;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// `failFamilies` lets one test make specific families reject `.load()`
// without needing a second mock class -- real `FontFace.load()` also
// rejects per-instance, so this mirrors the real failure shape.
let failFamilies: Set<string>;
let addedFaces: string[];
// Every `source` the FontFace constructor received, in construction order --
// the regression pin for the authenticated-bytes fix: sources must be
// ArrayBuffers fetched through the api client, never a `url(...)` string
// (a url() source makes the BROWSER fetch the font itself, without the
// Authorization header the JWT-gated endpoint requires -- see the hook's
// module comment).
let constructedSources: unknown[];

class MockFontFace {
  family: string;
  constructor(family: string, source: unknown, _descriptors?: { weight?: string; style?: string }) {
    this.family = family;
    constructedSources.push(source);
  }
  load(): Promise<MockFontFace> {
    if (failFamilies.has(this.family)) {
      return Promise.reject(new Error(`mock load failure for ${this.family}`));
    }
    return Promise.resolve(this);
  }
}

function stubFontFaceApi() {
  failFamilies = new Set();
  addedFaces = [];
  constructedSources = [];
  (globalThis as unknown as { FontFace: unknown }).FontFace = MockFontFace;
  Object.defineProperty(document, "fonts", {
    value: { add: (face: MockFontFace) => addedFaces.push(face.family) },
    configurable: true,
    writable: true,
  });
}

function unstubFontFaceApi() {
  delete (globalThis as unknown as { FontFace?: unknown }).FontFace;
  // @ts-expect-error -- test-only cleanup of the jsdom `document.fonts` stub;
  // real jsdom has no `fonts` property to restore.
  delete document.fonts;
}

describe("useEventFontFaces", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    fontsFetchCount = 0;
    fileFetchCount = 0;
    stubFontFaceApi();
  });

  afterEach(() => {
    unstubFontFaceApi();
  });

  it("starts idle, then transitions to loading and ready, adding every font", async () => {
    const { result } = renderHook(() => useEventFontFaces("evt-1", true), { wrapper });
    expect(result.current.status).toBe("idle");
    expect(result.current.families).toEqual([]);

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect([...result.current.families].sort()).toEqual(["BadFont", "GoodFont"]);
    expect([...addedFaces].sort()).toEqual(["BadFont", "GoodFont"]);
  });

  it("constructs each FontFace from authenticated bytes (ArrayBuffer), never a url() string", async () => {
    const { result } = renderHook(() => useEventFontFaces("evt-1", true), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    // The bytes must have come through the api client (MSW handler hit once
    // per font) and each FontFace must receive an ArrayBuffer source -- a
    // url() string here would mean the browser fetches the font itself,
    // WITHOUT the Authorization header, and 401s against the JWT-gated
    // endpoint (backend/internal/handler/handler.go:55,159).
    expect(fileFetchCount).toBe(2);
    expect(constructedSources).toHaveLength(2);
    for (const source of constructedSources) {
      expect(source).toBeInstanceOf(ArrayBuffer);
    }
  });

  it("stays idle when `enabled` is false -- no fetch, no load attempt", async () => {
    renderHook(() => useEventFontFaces("evt-1", false), { wrapper });
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(fontsFetchCount).toBe(0);
    expect(fileFetchCount).toBe(0);
    expect(addedFaces).toEqual([]);
  });

  it("loads exactly once when `enabled` flips to true after mount", async () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useEventFontFaces("evt-1", enabled),
      { wrapper, initialProps: { enabled: false } },
    );

    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(result.current.status).toBe("idle");
    expect(fontsFetchCount).toBe(0);

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fontsFetchCount).toBe(1);
    expect(addedFaces.length).toBe(2);

    // A further re-render (still enabled, same event) must not re-load.
    rerender({ enabled: true });
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(addedFaces.length).toBe(2);
  });

  it("isolates a failing font: overall status is 'error' but the other font is still added", async () => {
    failFamilies.add("BadFont");
    const { result } = renderHook(() => useEventFontFaces("evt-1", true), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.families).toEqual(["GoodFont"]);
    expect(addedFaces).toEqual(["GoodFont"]);
  });

  it("once-per-event guard: a second render for the same event does not reload fonts", async () => {
    const { result, rerender } = renderHook(
      ({ eventId }: { eventId: string }) => useEventFontFaces(eventId, true),
      { wrapper, initialProps: { eventId: "evt-1" } },
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fontsFetchCount).toBe(1);
    expect(addedFaces.length).toBe(2);

    rerender({ eventId: "evt-1" });
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    // Same event id again -- the ref guard must block a second FontFace load
    // pass; `document.fonts.add` call count must not double.
    expect(addedFaces.length).toBe(2);
    expect(result.current.status).toBe("ready");
  });

  it("loads again when the event id actually changes", async () => {
    const { result, rerender } = renderHook(
      ({ eventId }: { eventId: string }) => useEventFontFaces(eventId, true),
      { wrapper, initialProps: { eventId: "evt-1" } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(addedFaces.length).toBe(2);

    rerender({ eventId: "evt-2" });
    await waitFor(() => expect(addedFaces.length).toBe(4));
    expect(result.current.status).toBe("ready");
  });

  it("stays idle under jsdom's real absence of FontFace (documented guard)", async () => {
    unstubFontFaceApi();
    expect(typeof FontFace).toBe("undefined");

    const { result } = renderHook(() => useEventFontFaces("evt-1", true), { wrapper });
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(result.current.status).toBe("idle");
    expect(result.current.families).toEqual([]);
  });
});
