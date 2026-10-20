import { beforeEach, describe, expect, it } from "vitest";
import { loadWorkspace, saveWorkspace, workspaceKey } from "@/lib/noter-workspace";

beforeEach(() => localStorage.clear());
describe("workspace recovery", () => {
  it("isolates open tabs by signed-in user", () => {
    saveWorkspace("users/alice", [{ id: "draft-a", title: "Idea", dirty: true }], "draft-a");
    expect(loadWorkspace("users/alice").activeId).toBe("draft-a");
    expect(loadWorkspace("users/bob").tabs).toEqual([{ id: "draft", title: "Untitled note", dirty: false }]);
  });
  it("recovers from a malformed manifest and invalid active tab", () => {
    localStorage.setItem(workspaceKey("users/alice"), "not json");
    expect(loadWorkspace("users/alice").tabs).toHaveLength(1);
    localStorage.setItem(
      workspaceKey("users/alice"),
      JSON.stringify({
        tabs: [{ id: "one", name: "memos/one", title: "Note" }, { id: "one" }, { id: "invalid", name: "https://example.com" }],
        activeId: "missing",
      }),
    );
    expect(loadWorkspace("users/alice").tabs).toHaveLength(1);
    expect(loadWorkspace("users/alice").activeId).toBe("one");
  });
  it("opens a deep-linked note without duplicating its restored tab", () => {
    saveWorkspace("users/alice", [{ id: "existing", name: "memos/one", title: "Project", dirty: false }], "existing");
    expect(loadWorkspace("users/alice", "memos/one")).toEqual({
      tabs: [{ id: "existing", name: "memos/one", title: "Project", dirty: false }],
      activeId: "existing",
    });
  });
});
