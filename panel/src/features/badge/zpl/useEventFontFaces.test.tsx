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

  // PR #74 review round Fix 3: between an eventId change and the NEW event's
  // fonts list resolving, the hook used to keep reporting the PREVIOUS
  // event's terminal status/families verbatim (state persists across
  // renders unless something explicitly clears it) -- a consumer gated on
  // `status === "ready"` (e.g. a print action) could momentarily treat
  // evt-1's already-loaded fonts as if they were evt-2's own. A dedicated
  // effect keyed on `eventId` must reset to "idle"/`[]` BEFORE the new
  // load's own terminal status can land.
  it("resets status to idle immediately on an event id change, before the new event's load can flip it", async () => {
    const { result, rerender } = renderHook(
      ({ eventId }: { eventId: string }) => useEventFontFaces(eventId, true),
      { wrapper, initialProps: { eventId: "evt-1" } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.families.length).toBeGreaterThan(0);

    rerender({ eventId: "evt-2" });
    // Immediately after the eventId change -- before evt-2's own fonts-list
    // fetch has had any chance to resolve -- status/families must already
    // no longer be evt-1's "ready" reading.
    expect(result.current.status).not.toBe("ready");
    expect(result.current.families).toEqual([]);

    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  // PR #74 review round Fix 4: the once-per-event guard used to make a
  // fonts-list refetch that adds a font (e.g. another operator uploads one
  // while this surface stays open) a permanent no-op for the REST of that
  // event's session -- the new font would never actually load, silently
  // rasterizing browser fallback glyphs for it forever. The guard is now
  // keyed on a LOADED-SIGNATURE (the sorted font-id set), so a genuine list
  // change triggers a delta reload: only the NEW font's FontFace is
  // constructed, the already-loaded one is not redone.
  it("delta-reloads when the fonts LIST changes: a newly-added font gets its own single FontFace load; the already-loaded font is not redone", async () => {
    let call = 0;
    server.use(
      http.get("http://api.test/api/events/:eventId/fonts", () => {
        call += 1;
        fontsFetchCount += 1;
        return HttpResponse.json(
          call === 1
            ? [fontListItem("f1", "GoodFont")]
            : [fontListItem("f1", "GoodFont"), fontListItem("f2", "BadFont")],
        );
      }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function localWrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    }

    const { result } = renderHook(() => useEventFontFaces("evt-1", true), { wrapper: localWrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.families).toEqual(["GoodFont"]);
    expect(addedFaces).toEqual(["GoodFont"]);

    // Simulate the fonts-list query refetching with a new font present.
    // `invalidateQueries` only awaits the LIST refetch settling -- this
    // hook's own reaction (noticing the new signature, then fetching +
    // constructing the new font's FontFace) is a further, separate async
    // step, so the real completion signal is `addedFaces` gaining the new
    // font, not just re-checking `status === "ready"` (which was already
    // true beforehand and would otherwise make `waitFor` a no-op).
    await act(async () => {
      await qc.invalidateQueries();
    });
    await waitFor(() => expect(addedFaces).toEqual(["GoodFont", "BadFont"]));

    expect(result.current.status).toBe("ready");
    expect([...result.current.families].sort()).toEqual(["BadFont", "GoodFont"]);
    // Exactly one construction for the new font, and the first font was
    // NOT reconstructed/reloaded a second time.
    expect(constructedSources).toHaveLength(2);
  });

  it("flips to 'error' when the fonts-LIST query itself fails (consumers awaiting a terminal status must never wedge)", async () => {
    // Task 5 review Important 3: generation surfaces (ZplPreviewModal) only
    // unblock on a TERMINAL status ("ready" | "error"); with the list query
    // failing and `data` therefore never arriving, the hook used to stay
    // "idle" forever, wedging the modal on its generating placeholder.
    server.use(
      http.get("http://api.test/api/events/:eventId/fonts", () =>
        HttpResponse.json({ error: "boom" }, { status: 500 })),
    );

    const { result } = renderHook(() => useEventFontFaces("evt-1", true), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.families).toEqual([]);
    // No font bytes were ever fetched -- the failure is the LIST's, before
    // any per-font work could start.
    expect(fileFetchCount).toBe(0);
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
