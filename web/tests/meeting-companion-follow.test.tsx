import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { MeetingCompanionView } from "@/components/MeetingCompanion/MeetingCompanionView";

const { meeting } = vi.hoisted(() => ({
  meeting: {
    transcript: [{ id: "first", timestamp: "10:00", speaker: "[You]", text: "Initial detail" }],
    isStarting: false,
    isFinishing: false,
    isRecording: true,
    isAnalyzing: false,
    elapsedSeconds: 1,
    micChannelActive: true,
    microphoneActivity: "quiet",
    clientChannelActive: true,
    stopMeeting: vi.fn(),
    startMeeting: vi.fn(),
    appendTranscript: vi.fn(),
    formatAsMarkdown: vi.fn(),
    organizedMarkdown: "",
    error: null,
  },
}));
vi.mock("@/contexts/MeetingCompanionContext", () => ({
  useMeetingCompanion: () => ({
    isMeetingMode: true,
    isCollapsed: false,
    meetingTaker: meeting,
    activeSpeaker: "[Client]",
    manualText: "",
    setActiveSpeaker: vi.fn(),
    setManualText: vi.fn(),
    exitMeetingMode: vi.fn(),
    setCollapsed: vi.fn(),
  }),
}));

describe("live companion transcript", () => {
  it("shows quiet microphone state and lets the reader resume following new lines", () => {
    const content = (
      <MemoryRouter>
        <MeetingCompanionView />
      </MemoryRouter>
    );
    const view = render(content);
    expect(screen.getByText("Mic: quiet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Transcript (1)" }));
    const panel = screen.getByRole("tabpanel", { name: "Live transcript" });
    Object.defineProperties(panel, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { value: 200 } });
    panel.scrollTop = 100;
    fireEvent.scroll(panel);
    expect(screen.getByText("Reading earlier transcript")).toBeInTheDocument();
    meeting.transcript = [...meeting.transcript, { id: "last", timestamp: "10:01", speaker: "[Client]", text: "Newest detail" }];
    view.rerender(
      <MemoryRouter>
        <MeetingCompanionView />
      </MemoryRouter>,
    );
    expect(panel.scrollTop).toBe(100);
    fireEvent.click(screen.getByRole("button", { name: "Jump to latest" }));
    expect(panel.scrollTop).toBe(1000);
    expect(screen.getByText("Following live transcript")).toBeInTheDocument();
  });
});
