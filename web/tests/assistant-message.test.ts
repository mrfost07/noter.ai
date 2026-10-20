import { describe, expect, it } from "vitest";
import { formatAssistantMessage } from "@/lib/assistant-message";

describe("assistant note references", () => {
  it("presents raw and inline-code resource names as readable note links", () => {
    expect(formatAssistantMessage("Your note (`memos/abc123`) and memos/def456.")).toBe(
      "Your note ([Open note](/memos/abc123)) and [Open note](/memos/def456).",
    );
  });
  it("keeps route destinations intact and avoids nested links", () => {
    expect(formatAssistantMessage("[memos/abc123](/memos/abc123) and [Launch plan](/memos/def456)")).toBe(
      "[Open note](/memos/abc123) and [Launch plan](/memos/def456)",
    );
  });
  it("preserves user-requested code blocks and ordinary prose", () => {
    const content = "# Summary\n\nShip Friday.\n\n```http\nGET /api/memos/abc123\n```";
    expect(formatAssistantMessage(content)).toBe(content);
  });
});
