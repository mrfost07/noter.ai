export interface NoteTab {
  id: string;
  name?: string;
  title: string;
  dirty: boolean;
  saving?: boolean;
  meetingId?: string;
  folderId?: string;
  recoveryToken?: number;
}
export const workspaceKey = (userName: string) => `noter-workspace:${userName}`;
export function loadWorkspace(userName: string, noteName?: string): { tabs: NoteTab[]; activeId: string } {
  let tabs: NoteTab[] = [];
  let activeId = "";
  try {
    const stored = JSON.parse(localStorage.getItem(workspaceKey(userName)) ?? "null");
    if (Array.isArray(stored?.tabs)) {
      const seen = new Set<string>();
      for (const tab of stored.tabs) {
        if (!tab || typeof tab.id !== "string" || tab.id.length > 200 || seen.has(tab.id)) continue;
        if (tab.name !== undefined && (typeof tab.name !== "string" || !/^memos\/[^/]+$/.test(tab.name))) continue;
        seen.add(tab.id);
        tabs.push({
          id: tab.id,
          name: tab.name,
          title: typeof tab.title === "string" ? tab.title.slice(0, 80) : "Untitled note",
          dirty: false,
          meetingId: typeof tab.meetingId === "string" ? tab.meetingId : undefined,
          folderId: typeof tab.folderId === "string" ? tab.folderId : undefined,
        });
      }
      activeId = typeof stored.activeId === "string" ? stored.activeId : "";
    }
  } catch {
    /* A malformed manifest must not prevent opening notes. */
  }
  if (noteName) {
    const existing = tabs.find((tab) => tab.name === noteName);
    if (existing) activeId = existing.id;
    else {
      tabs.push({ id: noteName, name: noteName, title: "Opening note…", dirty: false });
      activeId = noteName;
    }
  }
  if (!tabs.length) tabs = [{ id: "draft", title: "Untitled note", dirty: false }];
  if (!tabs.some((tab) => tab.id === activeId)) activeId = tabs[0].id;
  return { tabs, activeId };
}
export function saveWorkspace(userName: string, tabs: NoteTab[], activeId: string): void {
  try {
    localStorage.setItem(
      workspaceKey(userName),
      JSON.stringify({
        tabs: tabs.map(({ id, name, title, meetingId, folderId }) => ({ id, name, title, meetingId, folderId })),
        activeId,
      }),
    );
  } catch {
    /* Editing remains available when browser storage is full or disabled. */
  }
}
