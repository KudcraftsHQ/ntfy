import { describe, expect, it } from "vitest";
import { relativeTime, stripMarkdown } from "./format";

describe("relativeTime", () => {
  const now = new Date(2026, 9, 6, 15, 0).getTime();
  const s = (d: Date) => d.getTime() / 1000;
  it("formats recent times compactly", () => {
    expect(relativeTime(now / 1000 - 10, now)).toBe("now");
    expect(relativeTime(now / 1000 - 300, now)).toBe("5m");
    expect(relativeTime(s(new Date(2026, 9, 6, 9, 0)), now)).toBe("6h");
    expect(relativeTime(s(new Date(2026, 9, 5, 23, 0)), now)).toBe("Yesterday");
  });
});

describe("stripMarkdown", () => {
  it("leaves readable text", () => {
    expect(stripMarkdown("**Bold** and [link](https://x.y)\n- item")).toBe("Bold and link item");
  });
  it("drops table rules and keeps identifiers with underscores", () => {
    expect(stripMarkdown("| Item | Qty |\n|---|---:|\n| OF-9 | 120 |")).toBe("Item Qty OF-9 120");
    expect(stripMarkdown("order fm_8KQ2 is _new_")).toBe("order fm_8KQ2 is new");
  });
});
