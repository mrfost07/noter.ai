import { Code, ConnectError } from "@connectrpc/connect";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MeetingReview } from "@/components/MeetingLibrary/MeetingReview";
import { memoServiceClient } from "@/connect";
import { clock, type LibraryMeeting, type LibraryResponse, libraryRequest, matchingLines, sourceTime } from "@/lib/meeting-library";

vi.mock("@/connect", () => ({
  getRequestToken: vi.fn(),
  memoServiceClient: { createMemo: vi.fn(), updateMemo: vi.fn(), getMemo: vi.fn() },
}));
vi.mock("@/lib/meeting-library", async (original) => ({
  ...(await original<typeof import("@/lib/meeting-library")>()),
  libraryRequest: vi.fn(),
}));
vi.mock("@/components/MeetingLibrary/NotePreview", () => ({ NotePreview: ({ content }: { content: string }) => <p>{content}</p> }));

const meeting: LibraryMeeting = {
  id: "meeting1",
  title: "Client review",
  folderId: "",
  path: "Inbox/Meetings/Review",
  createdAt: "2026-10-14T01:00:00Z",
  updatedAt: "2026-10-14T01:00:00Z",
  status: "ready",
  duration: 20,
  parts: [{ id: "p1", file: "recording.webm", type: "video/webm", start: 0, end: 20, bytes: 100, complete: true }],
  transcript: [
    { id: "line1", text: "Launch Friday", speaker: "Client 1", start: 5, end: 8 },
    { id: "line2", text: "Budget is 12000", speaker: "Microphone", start: 10, end: 13 },
  ],
  draft: "",
  noteName: "",
  trashed: false,
};
const library: LibraryResponse = {
  desktop: false,
  library: { root: "test-library", folders: [], meetings: [meeting], notes: [], drafts: [] },
};
beforeEach(() => {
  vi.mocked(libraryRequest).mockReset().mockResolvedValue(library);
  vi.mocked(memoServiceClient.getMemo).mockRejectedValue(new ConnectError("missing", Code.NotFound));
  vi.mocked(memoServiceClient.createMemo)
    .mockReset()
    .mockResolvedValue({ name: "memos/meeting-meeting1" } as never);
  vi.mocked(memoServiceClient.updateMemo)
    .mockReset()
    .mockResolvedValue({ name: "memos/meeting-meeting1" } as never);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  Element.prototype.scrollIntoView = vi.fn();
});
function open(value = meeting) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <MeetingReview meeting={value} library={library} onClose={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
describe("recorded meeting review", () => {
  it("submits an AI question by clicking Ask without saving a note", async () => {
    vi.mocked(libraryRequest).mockResolvedValue({ markdown: "Budget is **12000**." } as never);
    open();
    fireEvent.click(screen.getByRole("tab", { name: "Ask AI" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Question about this meeting" }), {
      target: { value: "What is the budget?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText("Budget is **12000**.");
    expect(libraryRequest).toHaveBeenCalledWith(
      "/meetings/meeting1/ask",
      "POST",
      { question: "What is the budget?" },
      expect.any(AbortSignal),
    );
    expect(memoServiceClient.createMemo).not.toHaveBeenCalled();
    expect(memoServiceClient.updateMemo).not.toHaveBeenCalled();
  });
  it("preserves corrections typed while AI organization is still running", async () => {
    let finish: (value: { markdown: string }) => void = () => {};
    vi.mocked(libraryRequest).mockImplementation(async (path) =>
      path?.endsWith("/organize")
        ? (new Promise((resolve) => {
            finish = resolve as typeof finish;
          }) as never)
        : library,
    );
    open();
    fireEvent.click(screen.getByRole("button", { name: "Organize notes" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit draft" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Meeting note draft" }), {
      target: { value: "My corrections while AI was running" },
    });
    await act(async () => finish({ markdown: "Late AI proposal" }));
    await screen.findByText("Late AI proposal");
    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
    expect(screen.getByRole("textbox", { name: "Meeting note draft" })).toHaveValue("My corrections while AI was running");
    expect(memoServiceClient.createMemo).not.toHaveBeenCalled();
  });
  it("searches and seeks a transcript passage without invoking AI", () => {
    const view = open();
    fireEvent.click(screen.getByRole("tab", { name: "Transcript" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search transcript" }), { target: { value: "budget" } });
    expect(screen.queryByText("Launch Friday")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Budget is 12000/ }));
    expect(view.container.querySelector("video")?.currentTime).toBe(10);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(libraryRequest).not.toHaveBeenCalled();
  });
  it("follows the latest passage as the clock advances past an overlapping microphone line and through a gap", () => {
    const view = open({
      ...meeting,
      transcript: [{ id: "long", text: "Long microphone capture", speaker: "Microphone", start: 0, end: 20 }, ...meeting.transcript],
    });
    fireEvent.click(screen.getByRole("tab", { name: "Transcript" }));
    const video = view.container.querySelector("video")!;
    video.currentTime = 6;
    fireEvent.timeUpdate(video);
    expect(screen.getByRole("button", { name: /Launch Friday/ })).toHaveAttribute("aria-current", "true");
    video.currentTime = 9;
    fireEvent.timeUpdate(video);
    expect(screen.getByRole("button", { name: /Launch Friday/ })).toHaveAttribute("aria-current", "true");
    video.currentTime = 11;
    fireEvent.timeUpdate(video);
    expect(screen.getByRole("button", { name: /Budget is 12000/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: /Long microphone capture/ })).not.toHaveAttribute("aria-current");
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
  it("releases a clicked long passage when playback starts or the media clock changes", () => {
    const view = open({
      ...meeting,
      transcript: [{ id: "long", text: "Long microphone capture", speaker: "Microphone", start: 0, end: 20 }, ...meeting.transcript],
    });
    fireEvent.click(screen.getByRole("tab", { name: "Transcript" }));
    fireEvent.click(screen.getByRole("button", { name: /Long microphone capture/ }));
    const video = view.container.querySelector("video")!;
    video.currentTime = 11;
    fireEvent.timeUpdate(video);
    expect(screen.getByRole("button", { name: /Budget is 12000/ })).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("button", { name: /Long microphone capture/ }));
    video.currentTime = 6;
    fireEvent.play(video);
    expect(screen.getByRole("button", { name: /Launch Friday/ })).toHaveAttribute("aria-current", "true");
  });
  it("uses the next part's absolute timeline and clears filters when following resumes", () => {
    const view = open({
      ...meeting,
      parts: [
        { ...meeting.parts[0], end: 10 },
        { ...meeting.parts[0], id: "p2", start: 10, end: 20 },
      ],
    });
    fireEvent.click(screen.getByRole("tab", { name: "Transcript" }));
    fireEvent.ended(view.container.querySelector("video")!);
    const video = view.container.querySelector("video")!;
    expect(video.getAttribute("src")).toContain("/media/p2");
    fireEvent.loadedMetadata(video);
    video.currentTime = 2;
    fireEvent.timeUpdate(video);
    expect(screen.getByRole("button", { name: /Budget is 12000/ })).toHaveAttribute("aria-current", "true");
    fireEvent.change(screen.getByRole("combobox", { name: "Filter transcript speaker" }), { target: { value: "Client 1" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Search transcript" }), { target: { value: "launch" } });
    fireEvent.click(screen.getByRole("button", { name: "Follow playback: off" }));
    expect(screen.getByRole("combobox", { name: "Filter transcript speaker" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Search transcript" })).toHaveValue("");
    expect(screen.getByRole("button", { name: /Budget is 12000/ })).toHaveAttribute("aria-current", "true");
    fireEvent.wheel(screen.getByLabelText("Playback transcript"));
    expect(screen.getByRole("button", { name: "Follow playback: off" })).toBeInTheDocument();
  });
  it("hides legacy citations before revealing an answer and appends only on explicit request", async () => {
    vi.mocked(libraryRequest).mockResolvedValue({
      markdown: "## Decision\n\nShip Friday. [cite:abc, 123e4567-e89b-12d3-a456-426614174000]",
    } as never);
    const view = open();
    fireEvent.click(screen.getByRole("tab", { name: "Ask AI" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Question about this meeting" }), { target: { value: "What did we decide?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByRole("button", { name: "Show full answer" });
    expect(view.container.textContent).not.toContain("cite:");
    expect(view.container.textContent).not.toContain("123e4567");
    expect(screen.getByRole("button", { name: "Append to note draft" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Show full answer" }));
    expect(screen.getByLabelText("Meeting AI answer")).toHaveAttribute("aria-busy", "false");
    expect(memoServiceClient.createMemo).not.toHaveBeenCalled();
    expect(memoServiceClient.updateMemo).not.toHaveBeenCalled();
    expect(libraryRequest).not.toHaveBeenCalledWith("/meetings/meeting1", "PATCH", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Append to note draft" }));
    expect(screen.getByText(/Ship Friday/)).toBeInTheDocument();
    expect(memoServiceClient.createMemo).not.toHaveBeenCalled();
  });
  it("keeps organized notes as a draft until Save note is chosen", async () => {
    vi.mocked(libraryRequest).mockResolvedValue({ markdown: "# Review\n\n## Action items\n- [ ] Ship Friday" } as never);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Organize notes" }));
    await screen.findByText(/Ship Friday/);
    expect(memoServiceClient.createMemo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(memoServiceClient.createMemo).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(libraryRequest).toHaveBeenCalledWith("/notes", "POST", { name: "memos/meeting-meeting1", meetingId: "meeting1" }),
    );
  });
  it("keeps manually edited notes when AI organization finishes", async () => {
    vi.mocked(libraryRequest).mockResolvedValue({ markdown: "AI proposal" } as never);
    open({ ...meeting, draft: "Original notes" });
    fireEvent.click(screen.getByRole("button", { name: "Edit draft" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Meeting note draft" }), { target: { value: "My manual corrections" } });
    fireEvent.click(screen.getByRole("button", { name: "Organize notes" }));
    await screen.findByText("AI proposal");
    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
    expect(screen.getByRole("textbox", { name: "Meeting note draft" })).toHaveValue("My manual corrections");
    expect(memoServiceClient.createMemo).not.toHaveBeenCalled();
  });
  it("reuses a note created before a failed local copy instead of creating a duplicate", async () => {
    vi.mocked(memoServiceClient.getMemo).mockResolvedValue({ name: "memos/meeting-meeting1" } as never);
    open({ ...meeting, draft: "Reviewed notes" });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(memoServiceClient.updateMemo).toHaveBeenCalledOnce());
    expect(memoServiceClient.createMemo).not.toHaveBeenCalled();
  });
});
describe("meeting timeline helpers", () => {
  it("formats hour-long meetings and rejects foreign or invalid seek links", () => {
    expect(clock(3661)).toBe("1:01:01");
    expect(sourceTime("/?meeting=m1&t=12.5", "m1")).toBe(12.5);
    expect(sourceTime("https://example.com/?meeting=m1&t=12", "m1")).toBeNull();
    expect(sourceTime("/?meeting=m1&t=NaN", "m1")).toBeNull();
    expect(matchingLines(meeting.transcript, "FRIDAY", "Client 1")).toHaveLength(1);
  });
});
