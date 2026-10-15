import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanMeetingAnswer } from "@/components/MeetingLibrary/meeting-answer";
import { passageAtTime, revealPassage } from "@/components/MeetingLibrary/review-timeline";
import { useMeetingAnswer } from "@/components/MeetingLibrary/useMeetingAnswer";
import { useProgressiveMarkdown } from "@/components/MeetingLibrary/useProgressiveMarkdown";
import { libraryRequest } from "@/lib/meeting-library";

vi.mock("@/lib/meeting-library", () => ({ libraryRequest: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(libraryRequest).mockReset();
});

describe("meeting review interactions", () => {
  it("selects the latest started passage deterministically even if transcript order changes", () => {
    const rows = [
      { id: "old", start: 0, end: 100 },
      { id: "a", start: 8, end: 9 },
      { id: "b", start: 8, end: 10 },
    ].map((row) => ({ ...row, speaker: "Client", text: row.id }));
    expect(passageAtTime(rows, 7)).toBe("old");
    expect(passageAtTime(rows, 12)).toBe("b");
    expect(passageAtTime([...rows].reverse(), 12)).toBe("b");
    expect(passageAtTime(rows, -1)).toBeUndefined();
  });
  it("scrolls only the transcript viewport when a passage is outside it", () => {
    const panel = document.createElement("div");
    const row = document.createElement("button");
    panel.scrollTop = 20;
    panel.getBoundingClientRect = () => ({ top: 100, bottom: 300 }) as DOMRect;
    row.getBoundingClientRect = () => ({ top: 330, bottom: 390 }) as DOMRect;
    const windowScroll = vi.spyOn(window, "scrollTo");
    revealPassage(panel, row);
    expect(panel.scrollTop).toBe(110);
    expect(windowScroll).not.toHaveBeenCalled();
    row.getBoundingClientRect = () => ({ top: 80, bottom: 140 }) as DOMRect;
    revealPassage(panel, row);
    expect(panel.scrollTop).toBe(90);
  });
  it("removes grouped citation markers and bracketed citation IDs while preserving meaningful project IDs", () => {
    expect(
      cleanMeetingAnswer("Ship **Friday**. [cite:id1, id2] [00:15](/?meeting=m1&t=15#segment-x)\n\n[123e4567-e89b-12d3-a456-426614174000]"),
    ).toBe("Ship **Friday**.");
    expect(cleanMeetingAnswer("Project ID is 123e4567-e89b-12d3-a456-426614174000.")).toBe(
      "Project ID is 123e4567-e89b-12d3-a456-426614174000.",
    );
  });
  it("reveals progressively, allows skipping, and presents reduced-motion answers instantly", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const view = renderHook(() => useProgressiveMarkdown("## Decision\n\nShip on Friday with the agreed budget.", 1));
    expect(view.result.current.text).toBe("");
    act(() => vi.advanceTimersByTime(64));
    expect(view.result.current.text.length).toBeGreaterThan(0);
    expect(view.result.current.complete).toBe(false);
    act(() => view.result.current.showAll());
    expect(view.result.current.complete).toBe(true);
    view.unmount();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const reduced = renderHook(() => useProgressiveMarkdown("Complete answer", 2));
    expect(reduced.result.current.text).toBe("Complete answer");
    expect(reduced.result.current.complete).toBe(true);
  });
  it("aborts canceled and unmounted requests and ignores stale provider responses", async () => {
    const first = Promise.withResolvers<{ markdown: string }>();
    const second = Promise.withResolvers<{ markdown: string }>();
    vi.mocked(libraryRequest)
      .mockReturnValueOnce(first.promise as never)
      .mockReturnValueOnce(second.promise as never);
    const view = renderHook(() => useMeetingAnswer("m1"));
    let old!: Promise<void>;
    act(() => {
      old = view.result.current.ask("Old question");
    });
    const oldSignal = vi.mocked(libraryRequest).mock.calls[0][3];
    act(() => view.result.current.cancel());
    expect(oldSignal?.aborted).toBe(true);
    let current!: Promise<void>;
    act(() => {
      current = view.result.current.ask("Current question");
    });
    await act(async () => {
      second.resolve({ markdown: "Current answer" });
      await current;
    });
    await act(async () => {
      first.resolve({ markdown: "Stale answer" });
      await old;
    });
    expect(view.result.current.answer.content).toBe("Current answer");
    const pending = Promise.withResolvers<{ markdown: string }>();
    vi.mocked(libraryRequest).mockReturnValueOnce(pending.promise as never);
    let outstanding!: Promise<void>;
    act(() => {
      outstanding = view.result.current.ask("Unmount question");
    });
    const signal = vi.mocked(libraryRequest).mock.calls[2][3];
    view.unmount();
    expect(signal?.aborted).toBe(true);
    pending.resolve({ markdown: "Late unmounted answer" });
    await outstanding;
  });
  it("reports request failures without producing an answer", async () => {
    vi.mocked(libraryRequest).mockRejectedValue(new Error("Provider unavailable"));
    const view = renderHook(() => useMeetingAnswer("m1"));
    await act(async () => view.result.current.ask("Question"));
    expect(view.result.current.error).toBe("Provider unavailable");
    expect(view.result.current.pending).toBe(false);
    expect(view.result.current.answer.content).toBe("");
  });
  it("times out even if a provider ignores cancellation and ignores its later answer", async () => {
    vi.useFakeTimers();
    const pending = Promise.withResolvers<{ markdown: string }>();
    vi.mocked(libraryRequest).mockReturnValueOnce(pending.promise as never);
    const view = renderHook(() => useMeetingAnswer("m1"));
    let outstanding!: Promise<void>;
    act(() => {
      outstanding = view.result.current.ask("Question");
    });
    act(() => vi.advanceTimersByTime(90000));
    expect(view.result.current.pending).toBe(false);
    expect(view.result.current.error).toContain("took too long");
    await act(async () => {
      pending.resolve({ markdown: "Late answer" });
      await outstanding;
    });
    expect(view.result.current.answer.content).toBe("");
  });
});
