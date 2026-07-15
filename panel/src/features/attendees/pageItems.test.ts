import { pageItems } from "./pageItems";

describe("pageItems", () => {
  it("returns every page with no ellipsis when there are few pages", () => {
    expect(pageItems(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageItems(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageItems(5, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("shows an ellipsis only after the leading pages when current is near the start", () => {
    expect(pageItems(1, 10)).toEqual([1, 2, "…", 10]);
    expect(pageItems(2, 10)).toEqual([1, 2, 3, "…", 10]);
  });

  it("shows an ellipsis on both sides when current is in the middle", () => {
    expect(pageItems(5, 10)).toEqual([1, "…", 4, 5, 6, "…", 10]);
  });

  it("shows an ellipsis only before the trailing pages when current is near the end", () => {
    expect(pageItems(10, 10)).toEqual([1, "…", 9, 10]);
    expect(pageItems(9, 10)).toEqual([1, "…", 8, 9, 10]);
  });

  it("handles the single-page case", () => {
    expect(pageItems(1, 1)).toEqual([1]);
  });

  it("handles a 7-page scenario with current in the middle (used by the rendered pager test too)", () => {
    expect(pageItems(4, 7)).toEqual([1, "…", 3, 4, 5, "…", 7]);
  });
});
