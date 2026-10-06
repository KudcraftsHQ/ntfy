import { describe, expect, it } from "vitest";
import { safeHttpUrl, safeUrl } from "./url";

describe("safeUrl", () => {
  it("allows http(s), mailto, tel", () => {
    expect(safeUrl("https://facemap.fyi/admin")).toBe("https://facemap.fyi/admin");
    expect(safeUrl("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeUrl("tel:+62123")).toBe("tel:+62123");
  });
  it("rejects script-capable and malformed URLs", () => {
    expect(safeUrl("javascript:alert(localStorage['kc.session'])")).toBeNull();
    expect(safeUrl(" JavaScript:alert(1)")).toBeNull();
    expect(safeUrl("java\tscript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeUrl("vbscript:x")).toBeNull();
    expect(safeUrl("/relative")).toBeNull();
    expect(safeUrl("")).toBeNull();
    expect(safeUrl(undefined)).toBeNull();
  });
  it("http-only variant rejects mailto", () => {
    expect(safeHttpUrl("mailto:a@b.c")).toBeNull();
    expect(safeHttpUrl("http://x.y/a.png")).toBe("http://x.y/a.png");
  });
});
