import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MeetingCompanionProvider, useMeetingCompanion } from "@/contexts/MeetingCompanionContext";
import { libraryRequest } from "@/lib/meeting-library";
import { meetingRecoveryKey, readMeetingRecovery } from "@/lib/meeting-recovery";

const state = vi.hoisted(() => ({ transcript: [] as unknown[] }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/alice" }) }));
vi.mock("@/contexts/InstanceContext", () => ({ useInstance: () => ({ aiSetting: {} }) }));
vi.mock("@/utils/tauri", () => ({ invokeTauri: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/meeting-library", async (original) => ({
  ...(await original<typeof import("@/lib/meeting-library")>()),
  libraryRequest: vi.fn(),
}));
vi.mock("@/components/MemoEditor/hooks/useMeetingNoteTaker", () => ({
  useMeetingNoteTaker: () => ({
    readTranscript: () => state.transcript,
    transcript: state.transcript,
    stopMeeting: vi.fn(),
    clearMeeting: vi.fn(),
  }),
}));
const wrapper = ({ children }: { children: ReactNode }) => <MeetingCompanionProvider>{children}</MeetingCompanionProvider>;
beforeEach(() => {
  localStorage.clear();
  vi.mocked(libraryRequest).mockReset();
  state.transcript = [];
});

describe("meeting recovery", () => {
  it("reconnects older transcript-only backups to their existing recording", async () => {
    state.transcript = [{ id: "legacy-line", text: "Friday", speaker: "[Client]" }];
    vi.mocked(libraryRequest).mockResolvedValue({
      library: {
        meetings: [
          {
            id: "original",
            title: "Original recording",
            folderId: "project",
            parts: [{ id: "video" }],
            transcript: [{ id: "legacy-line", text: "Friday", speaker: "Shared audio", start: 8, end: 10 }],
            duration: 30,
          },
          { id: "duplicate", parts: [], transcript: [{ id: "legacy-line", text: "Friday", speaker: "Shared audio", start: 0, end: 4 }] },
        ],
      },
    } as never);
    const view = renderHook(useMeetingCompanion, { wrapper });
    await act(async () => {
      await view.result.current.flushTranscript?.();
    });
    expect(libraryRequest).toHaveBeenLastCalledWith("/meetings/original", "PATCH", {
      transcript: [expect.objectContaining({ start: 8, end: 10 })],
    });
    expect(view.result.current.currentMeetingId).toBe("original");
    view.unmount();
  });
  it("retains the original meeting and recording timeline after remount", async () => {
    localStorage.setItem(
      meetingRecoveryKey("users/alice"),
      JSON.stringify({ id: "meeting-one", sessions: [[1, { wall: 100000, start: 20 }]] }),
    );
    state.transcript = [{ id: "line-one", text: "Friday", speaker: "[Client]", recording: 1, capturedAt: 103000, start: 0, end: 2 }];
    vi.mocked(libraryRequest).mockResolvedValue({ library: { meetings: [{ id: "meeting-one", transcript: [], duration: 40 }] } } as never);
    const first = renderHook(useMeetingCompanion, { wrapper });
    await act(async () => {
      await first.result.current.flushTranscript?.();
    });
    first.unmount();
    const second = renderHook(useMeetingCompanion, { wrapper });
    await act(async () => {
      await second.result.current.flushTranscript?.();
    });
    const writes = vi.mocked(libraryRequest).mock.calls.filter((call) => call[1] === "PATCH");
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(["/meetings/meeting-one", "PATCH", { transcript: [expect.objectContaining({ start: 23, end: 25 })] }]);
    expect(vi.mocked(libraryRequest).mock.calls.some((call) => call[1] === "POST")).toBe(false);
    second.unmount();
  });
  it("preserves saved passage times when older recovery data has no session clock", async () => {
    localStorage.setItem(meetingRecoveryKey("users/alice"), JSON.stringify({ id: "meeting-one" }));
    state.transcript = [{ id: "line-one", text: "Friday", speaker: "[Client]" }];
    vi.mocked(libraryRequest).mockResolvedValue({
      library: {
        meetings: [
          {
            id: "meeting-one",
            transcript: [{ id: "line-one", text: "Friday", speaker: "Shared audio", start: 12, end: 15 }],
            duration: 40,
          },
        ],
      },
    } as never);
    const view = renderHook(useMeetingCompanion, { wrapper });
    await act(async () => {
      await view.result.current.flushTranscript?.();
    });
    expect(libraryRequest).toHaveBeenLastCalledWith("/meetings/meeting-one", "PATCH", {
      transcript: [expect.objectContaining({ start: 12, end: 15 })],
    });
    view.unmount();
  });
  it("keeps recovery account scoped and rejects invalid clocks", () => {
    localStorage.setItem(meetingRecoveryKey("users/alice"), JSON.stringify({ id: "meeting-one", sessions: [[1, { wall: 4, start: -2 }]] }));
    expect(readMeetingRecovery("users/alice")?.sessions).toEqual([]);
    expect(readMeetingRecovery("users/bob")).toBeUndefined();
  });
});
