import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { messages } from "../../dev/fixtures";
import type { StoredMessage } from "../lib/types";
import { MessageDetail } from "./MessageDetail";
import { MessageRow } from "./MessageRow";

// Every fixture (actions, attachments, markdown tables, priorities) must render in both views.
describe("message views render every fixture", () => {
  const qc = new QueryClient();
  for (const raw of messages) {
    const m = { ...(raw as unknown as StoredMessage), read: 0 as const };
    it(`${m.title}`, () => {
      const detail = renderToString(
        <QueryClientProvider client={qc}>
          <MessageDetail m={m} onClose={() => {}} />
        </QueryClientProvider>,
      );
      expect(detail).toContain("<article");
      expect(renderToString(<MessageRow m={m} showSource selected={false} onSelect={() => {}} />)).toContain(`msg-${m.id}`);
    });
  }
  it("never renders a javascript: link", () => {
    const m = { id: "x", time: 1, event: "message", topic: "t", title: "t", read: 0 as const, click: "javascript:alert(1)", actions: [{ action: "view", label: "Go", url: "javascript:alert(1)" }] };
    const html = renderToString(
      <QueryClientProvider client={qc}>
        <MessageDetail m={m as StoredMessage} onClose={() => {}} />
      </QueryClientProvider>,
    );
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("Open link");
  });
});
