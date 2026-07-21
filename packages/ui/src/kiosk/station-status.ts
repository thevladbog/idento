export type KioskNodeLevel = "ok" | "warn" | "error";

export interface KioskNode {
  id: string;
  label: string;
  level: KioskNodeLevel;
  detail?: string;
  live?: boolean;
}

/** Единые правила эскалации: зелёная тишина → янтарь (работа продолжается) → красный (линия стоит). */
export type StationLevel = "ok" | "degraded" | "blocked";

export function stationLevel(nodes: KioskNode[]): StationLevel {
  if (nodes.some((n) => n.level === "error")) return "blocked";
  if (nodes.some((n) => n.level === "warn")) return "degraded";
  return "ok";
}
