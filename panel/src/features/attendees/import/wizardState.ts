import type { CsvEncoding } from "./encoding";

// Full contract for the 3-step CSV import wizard (Tasks 11-13). Task 11
// (this file's first version) only reads/writes step/file/buffer/encoding/
// encodingOverridden/rows/headers — mapping/importProgress/rowErrors are
// defined now so Tasks 12-13 extend a stable shape instead of widening it
// mid-flight, but they stay empty/undefined until those tasks populate them.
export type MappingTarget =
  | { kind: "standard"; field: "first_name" | "last_name" | "email" | "company" | "position" | "code" }
  | { kind: "custom"; name: string }
  | { kind: "skip" }
  | { kind: "unset" };

export interface ImportWizardState {
  step: 1 | 2 | 3;
  file?: File;
  buffer?: ArrayBuffer;
  encoding: CsvEncoding;
  encodingOverridden: boolean;
  rows: Record<string, string>[];
  headers: string[];
  mapping: Record<string, MappingTarget>;
  importProgress?: { done: number; total: number };
  rowErrors?: Array<{ row: number; data: string; problem: string }>;
}

// Fresh state for a newly (re)opened wizard — always starts at step 1 with
// no file yet. utf-8 is just a starting default for the `encoding` field
// (not a claim about the eventual file); it's overwritten by the real
// `detectEncoding` result as soon as a file is picked, before it's ever read.
export function createInitialWizardState(): ImportWizardState {
  return {
    step: 1,
    encoding: "utf-8",
    encodingOverridden: false,
    rows: [],
    headers: [],
    mapping: {},
  };
}
