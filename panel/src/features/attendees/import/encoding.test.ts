import { decodeBuffer, detectEncoding } from "./encoding";

// windows-1251 byte mapping used throughout this file, verified against the
// WHATWG Encoding Standard's windows-1251 index (the same table Node's and
// browsers' TextDecoder implement) and cross-checked empirically by round-
// tripping every literal below through the real `TextDecoder("windows-1251")`
// before writing it here: uppercase А-Я (U+0410-U+042F) -> 0xC0-0xDF,
// lowercase а-я (U+0430-U+044F) -> 0xE0-0xFF, Ё (U+0401) -> 0xA8,
// ё (U+0451) -> 0xB8. E.g. "Анна" -> А=0xC0, н=0xED, н=0xED, а=0xE0.
describe("detectEncoding", () => {
  it("detects genuine UTF-8 bytes as utf-8", () => {
    const buf = new TextEncoder().encode("Имя,Компания\nАнна,Тест").buffer;
    expect(detectEncoding(buf)).toBe("utf-8");
  });

  it("detects hand-built windows-1251 bytes for Cyrillic text as windows-1251", () => {
    // "Анна" encoded byte-for-byte as windows-1251.
    const buf = new Uint8Array([0xc0, 0xed, 0xed, 0xe0]).buffer;
    expect(detectEncoding(buf)).toBe("windows-1251");
  });

  it("detects pure-ASCII bytes as utf-8", () => {
    const buf = new TextEncoder().encode("Name,Company\nJohn,Acme").buffer;
    expect(detectEncoding(buf)).toBe("utf-8");
  });

  it("falls back to windows-1251 when the bytes are not valid UTF-8", () => {
    // A lone continuation byte (0x80) with no valid multi-byte sequence
    // around it — invalid under strict/fatal UTF-8 decoding.
    const buf = new Uint8Array([0x41, 0x80, 0x42]).buffer;
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(buf)).toThrow();
    expect(detectEncoding(buf)).toBe("windows-1251");
  });

  it("prefers windows-1251 when utf-8 decodes without throwing but yields mojibake with zero Cyrillic while windows-1251 yields real Cyrillic", () => {
    // 0xC2 0x80 is valid (non-fatal) UTF-8 for U+0080 (a control char, no
    // Cyrillic), but the SAME two bytes read as windows-1251 decode to "ВЂ"
    // which contains a real Cyrillic letter (В, U+0412) — verified directly
    // against TextDecoder("windows-1251") before hardcoding.
    const buf = new Uint8Array([0xc2, 0x80]).buffer;
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(buf)).not.toThrow();
    expect(detectEncoding(buf)).toBe("windows-1251");
  });
});

describe("decodeBuffer", () => {
  it("decodes UTF-8 bytes back to the original Cyrillic text", () => {
    const original = "Имя,Компания\nАнна,Тест";
    const buf = new TextEncoder().encode(original).buffer;
    expect(decodeBuffer(buf, "utf-8")).toBe(original);
  });

  it("decodes windows-1251 bytes back to the correct Cyrillic text", () => {
    const buf = new Uint8Array([0xc0, 0xed, 0xed, 0xe0]).buffer;
    expect(decodeBuffer(buf, "windows-1251")).toBe("Анна");
  });
});
