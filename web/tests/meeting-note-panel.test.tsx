import { create } from "@bufbuild/protobuf";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MeetingNotePanel } from "@/components/MemoEditor/components/MeetingNotePanel";
import { aiServiceClient } from "@/connect";
import { AnalyzeMeetingTranscriptResponseSchema, MeetingNotesStateSchema } from "@/types/proto/api/ai_service_pb";

vi.mock("@/connect", () => ({
  aiServiceClient: {
    analyzeMeetingTranscript: vi.fn(),
    transcribe: vi.fn(),
  },
}));

describe("MeetingNotePanel", () => {
  it("renders dual-channel status badges, adds speaker lines, runs 4-list AI analysis, and inserts GFM markdown", async () => {
    const analyzeSpy = vi.mocked(aiServiceClient.analyzeMeetingTranscript).mockResolvedValue(
      create(AnalyzeMeetingTranscriptResponseSchema, {
        notes: create(MeetingNotesStateSchema, {
          tasksForYou: ["Send SAML architecture diagram by Thursday"],
          clientDecisions: ["Approved Okta SAML 2.0 integration"],
          crucialInfo: ["Budget capped at $25k; deadline Friday"],
          followUpQuestions: ["Which Okta environment should we target first?"],
        }),
        markdown: [
          "## ✅ Tasks & Action Items (For You)",
          "- [ ] Send SAML architecture diagram by Thursday",
          "",
          "## 🤝 Client Decisions & Agreements",
          "- Approved Okta SAML 2.0 integration",
        ].join("\n"),
      }),
    );

    const onInsertNotes = vi.fn();
    const onSyncMarkdownToEditor = vi.fn();
    const onClose = vi.fn();

    render(<MeetingNotePanel onInsertNotes={onInsertNotes} onSyncMarkdownToEditor={onSyncMarkdownToEditor} onClose={onClose} />);

    // Verify dual-channel speaker indicators render
    expect(screen.getAllByText("Shared audio").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Microphone")).toBeInTheDocument();

    // Add a [Client] utterance
    const input = screen.getByPlaceholderText(/Add a Shared audio line/i);
    fireEvent.change(input, { target: { value: "We approve Okta SAML 2.0 within the $25k budget." } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("We approve Okta SAML 2.0 within the $25k budget.")).toBeInTheDocument();

    // Toggle speaker to [You] and add a [You] utterance
    const speakerToggle = screen.getByTitle("Toggle speaker tag");
    fireEvent.click(speakerToggle);
    expect(speakerToggle).toHaveTextContent("Microphone");

    const youInput = screen.getByPlaceholderText(/Add a Microphone line/i);
    fireEvent.change(youInput, { target: { value: "I will send the SAML architecture diagram by Thursday." } });
    fireEvent.keyDown(youInput, { key: "Enter" });

    expect(screen.getByText("I will send the SAML architecture diagram by Thursday.")).toBeInTheDocument();

    // Click "Analyze Now"
    const analyzeBtn = screen.getByRole("button", { name: /Analyze Now/i });
    fireEvent.click(analyzeBtn);

    await waitFor(() => {
      expect(analyzeSpy).toHaveBeenCalledTimes(1);
    });

    // Verify all 4 structured lists populate in the UI without changing the editor before review
    expect(await screen.findByText("Send SAML architecture diagram by Thursday")).toBeInTheDocument();
    expect(screen.getByText("Approved Okta SAML 2.0 integration")).toBeInTheDocument();
    expect(screen.getByText("Budget capped at $25k; deadline Friday")).toBeInTheDocument();
    expect(screen.getByText("Which Okta environment should we target first?")).toBeInTheDocument();
    expect(onSyncMarkdownToEditor).not.toHaveBeenCalled();

    // Explicitly prepare the editable draft.
    const insertBtn = screen.getByRole("button", { name: /Organize & draft/i });
    fireEvent.click(insertBtn);

    await waitFor(() => {
      expect(onSyncMarkdownToEditor).toHaveBeenCalledOnce();
      expect(onSyncMarkdownToEditor).toHaveBeenCalledWith(expect.stringContaining("Send SAML architecture diagram by Thursday"));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
