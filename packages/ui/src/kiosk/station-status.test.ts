import { stationLevel, type KioskNode } from "./station-status";

const node = (level: KioskNode["level"]): KioskNode => ({ id: "n", label: "N", level });

describe("stationLevel", () => {
  it("is ok when all nodes are ok", () => {
    expect(stationLevel([node("ok"), node("ok")])).toBe("ok");
  });
  it("is degraded when any node warns (регистрация продолжается)", () => {
    expect(stationLevel([node("ok"), node("warn")])).toBe("degraded");
  });
  it("is blocked when any node errors (линия стоит), even alongside warns", () => {
    expect(stationLevel([node("warn"), node("error")])).toBe("blocked");
  });
  it("is ok for an empty list", () => {
    expect(stationLevel([])).toBe("ok");
  });
});
