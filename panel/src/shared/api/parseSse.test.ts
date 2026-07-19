import { createSseParser } from "./parseSse";

// Pure incremental SSE frame parser — no fetch, no React. Test matrix per
// task-5-brief.md: whole frame; frame split mid-line across chunks;
// comment-only chunk -> no events; two frames in one chunk -> two events;
// data-only frame defaults event to "message".
describe("createSseParser", () => {
  it("parses a whole frame delivered in a single chunk", () => {
    const events: { event: string; data: string }[] = [];
    const feed = createSseParser((evt) => events.push(evt));

    feed("event: hello\ndata: {}\n\n");

    expect(events).toEqual([{ event: "hello", data: "{}" }]);
  });

  it("tolerates a frame split mid-line across two chunks", () => {
    const events: { event: string; data: string }[] = [];
    const feed = createSseParser((evt) => events.push(evt));

    // "event: update" is split right in the middle of the field name.
    feed("event: upd");
    expect(events).toEqual([]); // nothing dispatched until the frame closes
    feed('ate\ndata: {"at":"2026-07-18T00:00:00Z"}\n\n');

    expect(events).toEqual([{ event: "update", data: '{"at":"2026-07-18T00:00:00Z"}' }]);
  });

  it("ignores a comment-only chunk and dispatches no events", () => {
    const events: { event: string; data: string }[] = [];
    const feed = createSseParser((evt) => events.push(evt));

    feed(": ping\n\n");

    expect(events).toEqual([]);
  });

  it("dispatches two events when two frames arrive in one chunk", () => {
    const events: { event: string; data: string }[] = [];
    const feed = createSseParser((evt) => events.push(evt));

    feed("event: hello\ndata: {}\n\nevent: update\ndata: {}\n\n");

    expect(events).toEqual([
      { event: "hello", data: "{}" },
      { event: "update", data: "{}" },
    ]);
  });

  it("defaults a data-only frame's event to 'message'", () => {
    const events: { event: string; data: string }[] = [];
    const feed = createSseParser((evt) => events.push(evt));

    feed("data: just-data\n\n");

    expect(events).toEqual([{ event: "message", data: "just-data" }]);
  });
});
