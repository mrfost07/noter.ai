import { act, fireEvent, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTranscriptFollow } from "@/hooks/useTranscriptFollow";

describe("live transcript following", () => {
  it("follows new content, pauses when reading older lines, and resumes explicitly", () => {
    const panel = document.createElement("div");
    Object.defineProperties(panel, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { value: 200 } });
    const { result, rerender } = renderHook(({ count }) => useTranscriptFollow(count), { initialProps: { count: 0 } });
    result.current.panelRef.current = panel;
    rerender({ count: 1 });
    expect(panel.scrollTop).toBe(1000);
    act(() => {
      panel.scrollTop = 100;
      result.current.onScroll();
    });
    expect(result.current.following).toBe(false);
    Object.defineProperty(panel, "scrollHeight", { value: 1200 });
    rerender({ count: 2 });
    expect(panel.scrollTop).toBe(100);
    act(() => result.current.resume());
    expect(result.current.following).toBe(true);
    expect(panel.scrollTop).toBe(1200);
  });
  it("resumes when scrolled to the bottom and catches up when the transcript tab opens", () => {
    const panel = document.createElement("div");
    Object.defineProperties(panel, { scrollHeight: { value: 600 }, clientHeight: { value: 200 } });
    const { result, rerender } = renderHook(({ active }) => useTranscriptFollow(1, active), { initialProps: { active: false } });
    result.current.panelRef.current = panel;
    rerender({ active: true });
    expect(panel.scrollTop).toBe(600);
    act(() => {
      panel.scrollTop = 0;
      result.current.onScroll();
    });
    expect(result.current.following).toBe(false);
    act(() => {
      panel.scrollTop = 400;
      fireEvent.scroll(panel);
      result.current.onScroll();
    });
    expect(result.current.following).toBe(true);
  });
});
