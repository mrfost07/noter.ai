import { create } from "@bufbuild/protobuf";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useMemo, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoEditorProps } from "@/components/MemoEditor/types";
import { workspaceKey } from "@/lib/noter-workspace";
import Home from "@/pages/Home";
import { MemoSchema } from "@/types/proto/api/memo_service_pb";

const state = vi.hoisted(() => ({ noteError: false, startMeeting: vi.fn() }));
vi.mock("@/hooks/useLibraryQueries", () => ({
  useLibrary: () => ({
    data: { library: { root: "test-library", folders: [], meetings: [], notes: [], drafts: [] }, desktop: false },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/meeting-library", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/meeting-library")>()),
  libraryRequest: vi.fn().mockResolvedValue({ library: { folders: [], meetings: [], notes: [], drafts: [] } }),
}));
vi.mock("@/hooks/useMemoFilters", () => ({ useMemoFilters: () => undefined }));
vi.mock("@/components/MemoFilters", () => ({ default: () => null }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/alice" }) }));
vi.mock("@/hooks/useMemoQueries", () => ({
  useInfiniteMemos: () => ({
    data: { pages: [{ memos: [create(MemoSchema, { name: "memos/one", content: "# Saved project" })] }] },
    isPending: false,
    isError: false,
  }),
  useMemo: (name: string) => ({
    data: useMemo(() => (name ? create(MemoSchema, { name, content: "# Saved project" }) : undefined), [name]),
    isPending: false,
    isUnavailable: state.noteError,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/components/MemoActionMenu", () => ({ default: () => <button type="button">Note actions</button> }));
vi.mock("@/components/NoterLogo", () => ({ default: () => <span>Noter.ai</span> }));
vi.mock("@/components/AgentSheet/AgentSheet", () => ({ default: () => <p>Noter assistant</p> }));
vi.mock("@/contexts/MeetingCompanionContext", () => ({
  useMeetingCompanion: () => ({ enterMeetingMode: state.startMeeting, meetingTaker: { isRecording: false } }),
}));
vi.mock("@/components/MemoEditor", () => ({
  default: function TestEditor(props: MemoEditorProps) {
    const [content, setContent] = useState(props.memo?.content ?? "");
    useEffect(() => {
      props.onDirtyChange?.(content !== (props.memo?.content ?? ""));
      props.onDocumentChange?.(content);
    }, [content, props.onDirtyChange, props.onDocumentChange, props.memo]);
    return <textarea aria-label="Note text" value={content} onChange={(event) => setContent(event.target.value)} />;
  },
}));
beforeEach(() => {
  localStorage.clear();
  state.noteError = false;
});
const open = () =>
  render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  );
describe("Noter workspace", () => {
  it("keeps each open note's edits when switching tabs and restores the open tabs", async () => {
    const view = open();
    fireEvent.change(screen.getByRole("textbox", { name: "Note text" }), { target: { value: "An unsaved idea" } });
    fireEvent.click(screen.getByRole("button", { name: /^Saved project/ }));
    expect(screen.getByRole("textbox", { name: "Note text" })).toHaveValue("# Saved project");
    fireEvent.click(screen.getByRole("tab", { name: /An unsaved idea/ }));
    expect(screen.getByRole("textbox", { name: "Note text" })).toHaveValue("An unsaved idea");
    await waitFor(() => expect(JSON.parse(localStorage.getItem(workspaceKey("users/alice")) ?? "{}").tabs).toHaveLength(2));
    view.unmount();
    open();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });
  it("keeps a dirty tab when closing is cancelled", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    open();
    fireEvent.change(screen.getByRole("textbox", { name: "Note text" }), { target: { value: "Keep this" } });
    fireEvent.click(screen.getByRole("button", { name: "Close Keep this" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox", { name: "Note text" })).toHaveValue("Keep this");
  });
  it("shows an unavailable note without exposing cached content", () => {
    state.noteError = true;
    open();
    fireEvent.click(screen.getByRole("button", { name: /^Saved project/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("This note is no longer available.");
    expect(screen.queryByRole("textbox", { name: "Note text" })).not.toBeInTheDocument();
  });
  it("opens the assistant and meeting through explicit controls", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Toggle AI assistant" }));
    expect(screen.getByText("Noter assistant")).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start meeting" })));
    expect(state.startMeeting).toHaveBeenCalledOnce();
  });
});
