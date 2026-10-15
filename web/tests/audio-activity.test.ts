import { afterEach, describe, expect, it, vi } from "vitest";
import { detectAudioActivity, hasAudibleSamples } from "@/components/MemoEditor/utils/audioActivity";

const rate = 16000;
const voice = (seconds = 0.16, amplitude = 0.006) =>
  Float32Array.from({ length: rate * seconds }, (_, index) => amplitude * Math.sin(index / 6));
afterEach(() => vi.unstubAllGlobals());

describe("meeting quiet-audio gate", () => {
  it("rejects silence, very quiet room noise, DC offset, and isolated clicks", () => {
    expect(hasAudibleSamples([new Float32Array(rate * 4)], rate)).toBe(false);
    expect(hasAudibleSamples([voice(4, 0.0002)], rate)).toBe(false);
    expect(hasAudibleSamples([new Float32Array(rate).fill(0.04)], rate)).toBe(false);
    expect(hasAudibleSamples([voice(0.02, 0.6)], rate)).toBe(false);
  });
  it("retains a short, soft utterance and activity in either channel", () => {
    expect(hasAudibleSamples([voice()], rate)).toBe(true);
    expect(hasAudibleSamples([new Float32Array(rate), voice()], rate)).toBe(true);
  });
  it("does not suppress speech when the decoder is unavailable or fails", async () => {
    vi.stubGlobal("OfflineAudioContext", undefined);
    expect(await detectAudioActivity(new Blob())).toBeNull();
    vi.stubGlobal(
      "OfflineAudioContext",
      class {
        decodeAudioData() {
          return Promise.reject(new Error("Unsupported codec"));
        }
      },
    );
    expect(await detectAudioActivity(new Blob())).toBeNull();
  });
});
