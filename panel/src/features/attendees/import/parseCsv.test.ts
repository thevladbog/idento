import { parseCsv } from "./parseCsv";

// worker: false everywhere in this file — PapaParse's worker: true mode
// requires a real browser Worker context, which jsdom/Node don't provide;
// production code (the Task 11 import wizard) passes worker: true.
describe("parseCsv", () => {
  it("extracts headers and rows from a header: true CSV", async () => {
    const text = "First name,Last name\nAda,Lovelace\nAlan,Turing";
    const result = await parseCsv(text, { worker: false });
    expect(result.headers).toEqual(["First name", "Last name"]);
    expect(result.rows).toEqual([
      { "First name": "Ada", "Last name": "Lovelace" },
      { "First name": "Alan", "Last name": "Turing" },
    ]);
  });

  it("caps the returned row count with the preview option", async () => {
    const text = "a,b\n1,2\n3,4\n5,6\n7,8";
    const result = await parseCsv(text, { preview: 2, worker: false });
    expect(result.rows).toHaveLength(2);
    expect(result.rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("keeps a quoted field containing a comma as a single field", async () => {
    const text = 'Name,Company\n"Smith, John",Acme';
    const result = await parseCsv(text, { worker: false });
    expect(result.rows).toEqual([{ Name: "Smith, John", Company: "Acme" }]);
  });

  it("skips empty lines", async () => {
    const text = "a,b\n1,2\n\n3,4\n";
    const result = await parseCsv(text, { worker: false });
    expect(result.rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });
});
