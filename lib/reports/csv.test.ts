import { describe, it, expect } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("prefixes a UTF-8 BOM (so Excel reads UTF-8 / no mojibake)", () => {
    const csv = toCsv(["a"], []);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("writes a header even with no rows", () => {
    expect(toCsv(["id", "name"], [])).toBe("﻿id,name");
  });

  it("joins rows with CRLF in stable column order", () => {
    const csv = toCsv(
      ["id", "name"],
      [
        { name: "A", id: 1 },
        { name: "B", id: 2 },
      ],
    );
    expect(csv).toBe("﻿id,name\r\n1,A\r\n2,B");
  });

  it("quotes fields containing comma, quote, or newline (doubling quotes)", () => {
    const csv = toCsv(["v"], [{ v: 'a,b' }, { v: 'say "hi"' }, { v: "line1\nline2" }]);
    expect(csv).toBe('﻿v\r\n"a,b"\r\n"say ""hi"""\r\n"line1\nline2"');
  });

  it("renders null/undefined as empty and objects as JSON", () => {
    const csv = toCsv(["a", "b"], [{ a: null, b: undefined }, { a: { x: 1 }, b: 5 }]);
    expect(csv).toBe('﻿a,b\r\n,\r\n"{""x"":1}",5');
  });
});
