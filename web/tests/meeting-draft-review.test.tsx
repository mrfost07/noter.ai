import { create } from "@bufbuild/protobuf";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MeetingCompanionView } from "@/components/MeetingCompanion/MeetingCompanionView";
import { MeetingCompanionProvider } from "@/contexts/MeetingCompanionContext";
import { MemoFilterProvider } from "@/contexts/MemoFilterContext";
import { ViewProvider } from "@/contexts/ViewContext";
import { libraryRequest } from "@/lib/meeting-library";
import Home from "@/pages/Home";
import { type Memo, MemoSchema } from "@/types/proto/api/memo_service_pb";

const mocks = vi.hoisted(() => ({
  note: undefined as Memo | undefined,
  createMemo: vi.fn(),
  updateMemo: vi.fn(),
  getMemo: vi.fn(),
  analyze: vi.fn(),
  drafts: [] as { id: string; title: string; content: string }[],
}));
vi.mock("@/hooks/useLibraryQueries", () => ({
  useLibrary: () => ({
    data: { library: { root: "test-library", folders: [], meetings: [], notes: [], drafts: mocks.drafts }, desktop: false },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/meeting-library", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/meeting-library")>()),
  libraryRequest: vi.fn().mockResolvedValue({ library: { folders: [], meetings: [], notes: [], drafts: [] } }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/alice" }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ userGeneralSetting: {} }) }));
vi.mock("@/contexts/InstanceContext", () => ({
  useInstance: () => ({ aiSetting: { providers: [] }, fetchSetting: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock("@/connect", () => ({
  memoServiceClient: { createMemo: mocks.createMemo, updateMemo: mocks.updateMemo, getMemo: mocks.getMemo },
  userServiceClient: {},
  attachmentServiceClient: {},
  aiServiceClient: {},
}));
vi.mock("@/components/MemoEditor/services/transcriptionService", () => ({
  transcriptionService: { analyzeMeetingTranscript: mocks.analyze },
}));
vi.mock("@/hooks/useMemoQueries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useMemoQueries")>()),
  useInfiniteMemos: () => ({ data: { pages: [{ memos: [mocks.note] }] }, isPending: false }),
  useMemo: (name: string) => ({ data: name ? mocks.note : undefined, isPending: false, isUnavailable: false }),
}));
vi.mock("@/hooks/useUserQueries", () => ({
  useTagCounts: () => ({ data: {} }),
  useUsersByUsernames: () => ({ data: new Map() }),
  userKeys: { stats: () => ["users", "stats"] },
}));
vi.mock("@/hooks/useMemoFilters", () => ({ useMemoFilters: () => undefined }));
vi.mock("@/components/MemoFilters", () => ({ default: () => null }));
vi.mock("@/components/MemoActionMenu", () => ({ default: () => null }));
vi.mock("@/components/NoterLogo", () => ({ default: () => <span>Noter.ai</span> }));
vi.mock("@/components/AgentSheet/AgentSheet", () => ({ default: () => null }));

const markdown =
  "# Atlas review #meeting-notes\n\n## Dates & deadlines\n- Launch on **November 15**\n\n## Action items\n- [ ] **Priya** sends the schema by **Friday**";
beforeEach(() => {
  vi.mocked(libraryRequest).mockImplementation(async (path) => {
    if (path?.endsWith("/organize")) return mocks.analyze({ transcript: "Launch on November 15. Priya sends the schema by Friday." });
    return {
      library: { root: "test-library", folders: [], meetings: [{ id: "review-test", parts: [], duration: 0 }], notes: [], drafts: [] },
    } as never;
  });
  localStorage.clear();
  mocks.drafts = [];
  vi.stubGlobal("MediaRecorder", undefined);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  mocks.note = create(MemoSchema, {
    name: "memos/current",
    creator: "users/alice",
    content: "# Existing plan\n\nKeep these original notes.",
  });
  mocks.getMemo.mockImplementation(async () => mocks.note);
  mocks.createMemo.mockReset();
  mocks.updateMemo.mockReset().mockImplementation(async ({ memo }) => {
    mocks.note = create(MemoSchema, { ...mocks.note, ...memo });
    return mocks.note;
  });
  mocks.analyze.mockReset().mockResolvedValue({ markdown });
});
const open = async () => {
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <MeetingCompanionProvider>
          <ViewProvider>
            <MemoFilterProvider>
              <Home />
              <MeetingCompanionView />
            </MemoFilterProvider>
          </ViewProvider>
        </MeetingCompanionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /^Existing plan/ }));
  await waitFor(() =>
    expect(view.container.querySelector('[role="tabpanel"]:not([hidden]) .cm-content')?.textContent).toContain(
      "Keep these original notes.",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Start meeting" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Add transcript line" }), {
    target: { value: "Launch on November 15. Priya sends the schema by Friday." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add transcript line" }));
  return view;
};

describe("meeting draft review", () => {
  it("recovers an app-private draft that has the same ID as the initial empty tab", async () => {
    mocks.drafts = [{ id: "draft", title: "Recovered thought", content: "# Recovered thought\n\nKeep this across app launches." }];
    const view = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <MeetingCompanionProvider>
            <ViewProvider>
              <MemoFilterProvider>
                <Home />
              </MemoFilterProvider>
            </ViewProvider>
          </MeetingCompanionProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(view.container.querySelector(".cm-content")?.textContent).toContain("Keep this across app launches."));
    expect(mocks.createMemo).not.toHaveBeenCalled();
    expect(mocks.updateMemo).not.toHaveBeenCalled();
  });

  it("drafts in the active tab, preserves existing text, and writes only after the user saves", async () => {
    const view = await open();
    fireEvent.click(screen.getByRole("button", { name: "Organize & review" }));
    await waitFor(() =>
      expect(view.container.querySelector('[role="tabpanel"]:not([hidden]) .cm-content')?.textContent).toContain("Dates & deadlines"),
    );
    const content = view.container.querySelector('[role="tabpanel"]:not([hidden]) .cm-content')?.textContent;
    expect(content).toContain("Keep these original notes.");
    expect(content).toContain("November 15");
    expect(screen.getByRole("tab", { name: /^Existing plan/, selected: true })).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(mocks.createMemo).not.toHaveBeenCalled();
    expect(mocks.updateMemo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(mocks.updateMemo).toHaveBeenCalledOnce());
    expect(mocks.updateMemo.mock.calls[0][0].memo.content).toContain(markdown);
    expect(mocks.createMemo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Review meeting" }));
    expect(screen.getByRole("heading", { name: "Dates & deadlines" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "", checked: false })).toHaveAttribute("aria-disabled", "true");
    expect(mocks.updateMemo).toHaveBeenCalledOnce();
  });

  it("replaces the current draft only when selected, without changing the saved note", async () => {
    const view = await open();
    fireEvent.click(screen.getByRole("checkbox", { name: "Replace current note text" }));
    fireEvent.click(screen.getByRole("button", { name: "Organize & review" }));
    await waitFor(() =>
      expect(view.container.querySelector('[role="tabpanel"]:not([hidden]) .cm-content')?.textContent).toContain("Dates & deadlines"),
    );
    expect(view.container.querySelector('[role="tabpanel"]:not([hidden]) .cm-content')?.textContent).not.toContain(
      "Keep these original notes.",
    );
    expect(mocks.note?.content).toContain("Keep these original notes.");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(mocks.createMemo).not.toHaveBeenCalled();
    expect(mocks.updateMemo).not.toHaveBeenCalled();
  });

  it("shows AI failure and retains the transcript without saving or replacing the note", async () => {
    mocks.analyze.mockRejectedValue(new Error("Provider unavailable"));
    const view = await open();
    fireEvent.click(screen.getByRole("button", { name: "Organize & review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nothing was saved. Provider unavailable");
    expect(view.container.querySelector('[role="tabpanel"]:not([hidden]) .cm-content')?.textContent).toBe(
      "# Existing planKeep these original notes.",
    );
    expect(mocks.createMemo).not.toHaveBeenCalled();
    expect(mocks.updateMemo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Transcript (1)" }));
    expect(screen.getByText("Launch on November 15. Priya sends the schema by Friday.")).toBeInTheDocument();
  });
});
