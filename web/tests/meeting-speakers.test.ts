import { describe, expect, it } from "vitest";
import type { TranscriptLine } from "@/components/MemoEditor/hooks/useMeetingNoteTaker";
import { appendCapturedLine, buildSpeakerTurns, displaySpeaker } from "@/components/MemoEditor/utils/meetingSpeakers";

const line = (
  source: "microphone" | "shared",
  text = "The Atlas rollout is scheduled for next Friday.",
  capturedAt = 1000,
): TranscriptLine => ({
  id: source,
  timestamp: "10:00",
  speaker: source === "microphone" ? "[You]" : "[Client]",
  source,
  text,
  capturedAt,
  recording: 1,
});

describe("meeting speaker attribution", () => {
  it("removes microphone echoes regardless of which channel finishes first", () => {
    const shared = line("shared");
    const mic = line("microphone");
    expect(appendCapturedLine([shared], mic)).toEqual([shared]);
    expect(appendCapturedLine([mic], shared)).toEqual([shared]);
  });
  it("keeps distinct speech, short replies, distant repetition, and manual text", () => {
    const shared = line("shared");
    for (const mic of [
      line("microphone", "The Atlas rollout is scheduled for next Friday. I disagree."),
      line("microphone", "Yes, agreed"),
      line("microphone", shared.text, 20000),
      { ...line("microphone"), source: undefined },
    ]) {
      expect(appendCapturedLine([shared], mic)).toHaveLength(2);
    }
  });
  it("keeps microphone-only capture without guessing a shared speaker", () => {
    const mic = line("microphone");
    expect(appendCapturedLine([], mic)).toEqual([mic]);
    expect(displaySpeaker(mic.speaker)).toBe("Microphone");
  });
  it("numbers provider-identified voices consistently within one recording", () => {
    const turns = buildSpeakerTurns(
      [
        { text: "First person", start: 0, end: 1, speaker: "speaker_7" },
        { text: "Second person", start: 2, end: 3, speaker: "speaker_2" },
        { text: "First again", start: 4, end: 5, speaker: "speaker_7" },
        { text: "Uncertain voice", start: 6, end: 7, speaker: "" },
      ],
      1000,
      1,
    );
    expect(turns.map((turn) => turn.speaker)).toEqual(["[Client 1]", "[Client 2]", "[Client 1]", "[Client]"]);
    expect(turns[2].capturedAt).toBe(5000);
  });
  it("scopes numbers to later recordings and rejects invalid timestamps", () => {
    expect(buildSpeakerTurns([{ text: "Hello", start: 0, end: 1, speaker: "0" }], 1000, 2)[0].speaker).toBe("[Client 1 · recording 2]");
    expect(buildSpeakerTurns([{ text: "bad", start: -1, end: 2, speaker: "0" }], 0, 1)).toEqual([]);
  });
});
