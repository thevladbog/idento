import { classifyEvent, isDateOnly, splitEvents } from "./eventTiming";
import type { components } from "../../shared/api/schema";

type ApiEvent = components["schemas"]["Event"];

const NOW = new Date("2026-07-14T12:00:00Z");
function ev(partial: Partial<ApiEvent>): ApiEvent {
  return { id: "e", tenant_id: "t", name: "E", created_at: "", updated_at: "", ...partial } as ApiEvent;
}

describe("classifyEvent", () => {
  it("is running while now is inside [start, end]", () => {
    expect(
      classifyEvent(ev({ start_date: "2026-07-14T08:00:00Z", end_date: "2026-07-14T18:00:00Z" }), NOW),
    ).toBe("running");
  });
  it("a single-day event with only a start date runs through that whole day", () => {
    expect(classifyEvent(ev({ start_date: "2026-07-14T08:00:00Z" }), NOW)).toBe("running");
  });
  it("is upcoming before start", () => {
    expect(classifyEvent(ev({ start_date: "2026-09-03T09:00:00Z" }), NOW)).toBe("upcoming");
  });
  it("is past after end", () => {
    expect(
      classifyEvent(ev({ start_date: "2026-05-01T08:00:00Z", end_date: "2026-05-02T18:00:00Z" }), NOW),
    ).toBe("past");
  });
  it("an undated event is upcoming (a draft)", () => {
    expect(classifyEvent(ev({}), NOW)).toBe("upcoming");
  });
  it("honors an explicit end_date with a real time — does not push it to end of day", () => {
    // Started 08:00, genuinely ended 10:00 (e.g. via the older web/ admin's
    // datetime-local form) — must be "past" well before the UTC day is over,
    // not still "running" until 23:59:59.999Z.
    const event = ev({ start_date: "2026-07-14T08:00:00Z", end_date: "2026-07-14T10:00:00Z" });
    expect(classifyEvent(event, new Date("2026-07-14T12:00:00Z"))).toBe("past");
    expect(classifyEvent(event, new Date("2026-07-14T09:00:00Z"))).toBe("running");
  });
  it("extends a date-only end_date (all-day) to the end of its UTC day", () => {
    // Both dates are the create dialog's UTC-midnight all-day placeholders —
    // the event should still read as running through the whole final day.
    const event = ev({ start_date: "2026-07-14T00:00:00.000Z", end_date: "2026-07-14T00:00:00.000Z" });
    expect(classifyEvent(event, new Date("2026-07-14T23:00:00Z"))).toBe("running");
  });
});

describe("isDateOnly", () => {
  it("recognizes UTC-midnight timestamps (with or without milliseconds)", () => {
    expect(isDateOnly("2026-07-14T00:00:00.000Z")).toBe(true);
    expect(isDateOnly("2026-07-14T00:00:00Z")).toBe(true);
  });
  it("rejects timestamps with a real time component", () => {
    expect(isDateOnly("2026-07-14T09:30:00.000Z")).toBe(false);
    expect(isDateOnly("2026-07-14T23:59:59.999Z")).toBe(false);
  });
});

describe("splitEvents", () => {
  it("splits and sorts: upcoming by start asc (undated last), past by end desc", () => {
    const a = ev({ id: "a", start_date: "2026-08-01T09:00:00Z" });
    const b = ev({ id: "b", start_date: "2026-07-20T09:00:00Z" });
    const draft = ev({ id: "d" });
    const old1 = ev({ id: "o1", start_date: "2026-06-01T09:00:00Z", end_date: "2026-06-01T18:00:00Z" });
    const old2 = ev({ id: "o2", start_date: "2026-06-20T09:00:00Z", end_date: "2026-06-20T18:00:00Z" });
    const live = ev({ id: "l", start_date: "2026-07-14T08:00:00Z", end_date: "2026-07-14T18:00:00Z" });
    const { running, upcoming, past } = splitEvents([a, draft, old1, live, b, old2], NOW);
    expect(running.map((e) => e.id)).toEqual(["l"]);
    expect(upcoming.map((e) => e.id)).toEqual(["b", "a", "d"]);
    expect(past.map((e) => e.id)).toEqual(["o2", "o1"]);
  });
});
