import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMeetingNoteTaker } from "@/components/MemoEditor/hooks/useMeetingNoteTaker";
import { transcriptionService } from "@/components/MemoEditor/services/transcriptionService";

vi.mock("@/components/MemoEditor/services/transcriptionService", () => ({
  transcriptionService: { transcribeFile: vi.fn(), analyzeMeetingTranscript: vi.fn(), recognizeSpeakers: vi.fn() },
}));
const recorders: Recorder[] = [];
class Recorder {
  static isTypeSupported() {
    return true;
  }
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  constructor() {
    recorders.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["final audio"]) });
    this.onstop?.();
  }
}
function stream() {
  const audio = { stop: vi.fn(), addEventListener: vi.fn() };
  const video = { stop: vi.fn(), addEventListener: vi.fn() };
  return { active: true, getAudioTracks: () => [audio], getVideoTracks: () => [video], getTracks: () => [audio, video] };
}
beforeEach(() => {
  vi.mocked(transcriptionService.recognizeSpeakers).mockReset();
  recorders.length = 0;
  vi.mocked(transcriptionService.analyzeMeetingTranscript).mockReset();
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal(
    "MediaStream",
    class {
      active = true;
      constructor(public tracks: unknown[]) {}
      getAudioTracks() {
        return this.tracks;
      }
    },
  );
  vi.mocked(transcriptionService.transcribeFile).mockResolvedValue("Please fix the export bug.");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("meeting capture lifecycle", () => {
  it("skips quiet microphone chunks instead of asking Whisper to invent words", async () => {
    vi.stubGlobal(
      "OfflineAudioContext",
      class {
        async decodeAudioData() {
          return { numberOfChannels: 1, sampleRate: 16000, getChannelData: () => new Float32Array(64000) };
        }
      },
    );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream()) },
    });
    vi.mocked(transcriptionService.transcribeFile).mockClear().mockResolvedValue("Thank you.");
    const { result, unmount } = renderHook(() => useMeetingNoteTaker());
    await act(async () => {
      await result.current.startMeeting();
      await result.current.stopMeeting();
    });
    expect(transcriptionService.transcribeFile).not.toHaveBeenCalled();
    expect(result.current.transcript).toHaveLength(0);
    expect(result.current.microphoneActivity).toBe("quiet");
    unmount();
  });
  it("retains an actually spoken thank you", async () => {
    vi.stubGlobal(
      "OfflineAudioContext",
      class {
        async decodeAudioData() {
          return {
            numberOfChannels: 1,
            sampleRate: 16000,
            getChannelData: () => Float32Array.from({ length: 64000 }, (_, i) => Math.sin(i / 6) * 0.02),
          };
        }
      },
    );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream()) },
    });
    vi.mocked(transcriptionService.transcribeFile).mockClear().mockResolvedValue("Thank you.");
    const { result, unmount } = renderHook(() => useMeetingNoteTaker());
    await act(async () => {
      await result.current.startMeeting();
      await result.current.stopMeeting();
    });
    expect(result.current.transcript.map((line) => line.text)).toEqual(["Thank you."]);
    expect(result.current.microphoneActivity).toBe("audio");
    unmount();
  });
  it("keeps Groq live capture and numbers shared voices in one final optional pass", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getDisplayMedia: vi.fn().mockResolvedValue(stream()), getUserMedia: vi.fn().mockResolvedValue(stream()) },
    });
    vi.mocked(transcriptionService.recognizeSpeakers).mockResolvedValue({
      text: "First Second",
      segments: [
        { text: "First", start: 0, end: 1, speaker: "0" },
        { text: "Second", start: 2, end: 3, speaker: "1" },
      ],
    } as never);
    const { result, unmount } = renderHook(() => useMeetingNoteTaker({ speakerRecognition: true }));
    await act(async () => {
      await result.current.startMeeting();
    });
    await act(async () => {
      await result.current.stopMeeting();
    });
    expect(transcriptionService.transcribeFile).toHaveBeenCalled();
    expect(transcriptionService.recognizeSpeakers).toHaveBeenCalledOnce();
    expect(result.current.transcript.map((line) => line.speaker)).toContain("[You]");
    expect(result.current.transcript.map((line) => line.speaker)).toContain("[Client 1]");
    expect(result.current.transcript.map((line) => line.speaker)).toContain("[Client 2]");
    expect(result.current.speakerStatus).toContain("not verified identities");
    unmount();
  });
  it("re-analyzes the complete conversation for review, including early details", async () => {
    const markdown = "# Atlas launch\n\n## Dates & deadlines\n- Launch on **November 15**";
    vi.mocked(transcriptionService.analyzeMeetingTranscript).mockResolvedValue({ markdown } as never);
    const { result, unmount } = renderHook(() => useMeetingNoteTaker());
    act(() => result.current.appendTranscript("[Client]", "Launch Atlas on November 15 with a $12,000 budget."));
    await act(async () => {
      await result.current.runAnalysisNow();
    });
    act(() => {
      for (let i = 0; i < 8; i++) result.current.appendTranscript("[You]", `Discussion detail ${i}`);
      result.current.appendTranscript("[Client]", "Thank you, goodbye.");
    });
    await act(async () => {
      await result.current.runAnalysisNow({ fullTranscript: true });
    });
    const finalRequest = vi.mocked(transcriptionService.analyzeMeetingTranscript).mock.calls[1][0];
    expect(finalRequest.transcript).toContain("November 15 with a $12,000 budget");
    expect(finalRequest.transcript).toContain("Thank you, goodbye.");
    expect(finalRequest.previousState).toBeUndefined();
    expect(result.current.formatAsMarkdown()).toBe(markdown);
    expect(result.current.organizedMarkdown).toBe(markdown);
    unmount();
  });
  it("waits for an in-flight update and still runs a full final analysis", async () => {
    const pending = Promise.withResolvers<never>();
    vi.mocked(transcriptionService.analyzeMeetingTranscript)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ markdown: "# Complete notes" } as never);
    const { result, unmount } = renderHook(() => useMeetingNoteTaker());
    act(() => result.current.appendTranscript("[Client]", "Initial deadline is Friday."));
    let incremental!: Promise<unknown>;
    let final!: Promise<unknown>;
    act(() => {
      incremental = result.current.runAnalysisNow();
    });
    act(() => result.current.appendTranscript("[Client]", "The revised deadline is Monday."));
    act(() => {
      final = result.current.runAnalysisNow({ fullTranscript: true });
    });
    await act(async () => {
      pending.resolve({ markdown: "# Partial notes" } as never);
      await incremental;
      await final;
    });
    expect(transcriptionService.analyzeMeetingTranscript).toHaveBeenCalledTimes(2);
    expect(vi.mocked(transcriptionService.analyzeMeetingTranscript).mock.calls[1][0].transcript).toContain("revised deadline is Monday");
    expect(result.current.organizedMarkdown).toBe("# Complete notes");
    unmount();
  });
  it("starts both channels immediately and retains their final chunks after stopping", async () => {
    const display = stream();
    const mic = stream();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getDisplayMedia: vi.fn().mockResolvedValue(display), getUserMedia: vi.fn().mockResolvedValue(mic) },
    });
    const { result, unmount } = renderHook(() => useMeetingNoteTaker());
    await act(async () => {
      await result.current.startMeeting();
    });
    expect(recorders).toHaveLength(2);
    expect(display.getVideoTracks()[0].stop).not.toHaveBeenCalled();
    expect(result.current.clientChannelActive).toBe(true);
    expect(result.current.micChannelActive).toBe(true);
    await act(async () => {
      await result.current.stopMeeting();
    });
    expect(result.current.transcript.map((line) => line.speaker)).toEqual(["[Client]", "[You]"]);
    expect(result.current.formatAsMarkdown()).toContain("Please fix the export bug.");
    expect(result.current.isRecording).toBe(false);
    expect(result.current.isFinishing).toBe(false);
    expect(display.getVideoTracks()[0].stop).toHaveBeenCalled();
    unmount();
  });
  it("does not open duplicate permission dialogs while starting", async () => {
    let grant: (value: ReturnType<typeof stream>) => void = () => {};
    const getDisplayMedia = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        grant = resolve;
      }),
    );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getDisplayMedia, getUserMedia: vi.fn().mockResolvedValue(stream()) },
    });
    const { result, unmount } = renderHook(() => useMeetingNoteTaker());
    let start: Promise<void>;
    act(() => {
      start = result.current.startMeeting();
    });
    await act(async () => {
      await result.current.startMeeting();
    });
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    await act(async () => {
      grant(stream());
      await start;
    });
    await act(async () => {
      await result.current.stopMeeting();
    });
    unmount();
  });
  it("does not request the microphone after a cancelled pending share dialog", async () => {
    let rejectShare: (error: Error) => void = () => {};
    const getUserMedia = vi.fn().mockResolvedValue(stream());
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getDisplayMedia: vi.fn().mockReturnValue(
          new Promise((_resolve, reject) => {
            rejectShare = reject;
          }),
        ),
        getUserMedia,
      },
    });
    const { result, unmount } = renderHook(() => useMeetingNoteTaker());
    let start: Promise<void>;
    act(() => {
      start = result.current.startMeeting();
    });
    await act(async () => {
      await result.current.stopMeeting();
    });
    await act(async () => {
      rejectShare(new Error("cancelled"));
      await start;
    });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(result.current.isStarting).toBe(false);
    expect(result.current.isRecording).toBe(false);
    unmount();
  });
  it("starts the next audio chunks at the boundary without a scheduled recording gap", async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getDisplayMedia: vi.fn().mockResolvedValue(stream()), getUserMedia: vi.fn().mockResolvedValue(stream()) },
    });
    const { result, unmount } = renderHook(() => useMeetingNoteTaker());
    await act(async () => {
      await result.current.startMeeting();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(recorders).toHaveLength(4);
    expect(recorders.slice(2).every((recorder) => recorder.state === "recording")).toBe(true);
    await act(async () => {
      await result.current.stopMeeting();
    });
    unmount();
  });
  it("does not restore cleared transcript from an in-flight transcription", async () => {
    let resolveText: (text: string) => void = () => {};
    vi.mocked(transcriptionService.transcribeFile).mockReturnValue(
      new Promise((resolve) => {
        resolveText = resolve;
      }),
    );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getDisplayMedia: vi.fn().mockRejectedValue(new Error("cancelled")), getUserMedia: vi.fn().mockResolvedValue(stream()) },
    });
    const { result, unmount } = renderHook(() => useMeetingNoteTaker());
    await act(async () => {
      await result.current.startMeeting();
    });
    await act(async () => {
      recorders[0].stop();
    });
    act(() => result.current.clearMeeting());
    await act(async () => {
      resolveText("late text");
    });
    expect(result.current.transcript).toEqual([]);
    expect(result.current.formatAsMarkdown()).toBe("");
    unmount();
  });
});
