import { classifyEvent, splitEvents } from "./eventTiming";
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
