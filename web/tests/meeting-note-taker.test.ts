import { describe, expect, it } from "vitest";
import { encodeMonoWAV } from "@/components/MemoEditor/utils/wavEncoder";

describe("meeting note taker utilities", () => {
  it("encodes a mono Float32Array into a valid 16-bit PCM WAV header and payload", async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const blob = encodeMonoWAV(samples, 16000);

    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(44 + samples.length * 2);

    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    const format = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));

    expect(magic).toBe("RIFF");
    expect(format).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
  });
});
