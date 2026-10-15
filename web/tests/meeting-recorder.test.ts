import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LibraryIndex, libraryRequest } from "@/lib/meeting-library";
import { MeetingRecorder } from "@/lib/meeting-recorder";

vi.mock("@/lib/meeting-library", async (original) => ({
  ...(await original<typeof import("@/lib/meeting-library")>()),
  libraryRequest: vi.fn(),
}));
const instances: FakeRecorder[] = [];
const mixedSources: FakeStream[] = [];
class FakeStream {
  constructor(public tracks: { kind: string; applyConstraints?: () => Promise<void>; addEventListener: () => void }[]) {}
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === "video");
  }
}
class FakeRecorder {
  static isTypeSupported() {
    return true;
  }
  state = "inactive";
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  constructor(
    public stream: FakeStream,
    public options: MediaRecorderOptions,
  ) {
    instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new NodeBlob(["tail"]) as unknown as Blob });
    this.onstop?.();
  }
}
let index: LibraryIndex;
beforeEach(() => {
  instances.length = 0;
  mixedSources.length = 0;
  index = {
    root: "test",
    folders: [],
    notes: [],
    meetings: [
      {
        id: "meeting1",
        title: "Review",
        folderId: "",
        path: "Review",
        createdAt: "",
        updatedAt: "",
        status: "recording",
        duration: 0,
        parts: [],
        transcript: [],
        draft: "",
        noteName: "",
        trashed: false,
      },
    ],
  };
  vi.stubGlobal("MediaStream", FakeStream);
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal(
    "AudioContext",
    class {
      resume = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockResolvedValue(undefined);
      createMediaStreamDestination() {
        return { stream: new FakeStream([{ kind: "audio", addEventListener() {} }]) };
      }
      createMediaStreamSource(stream: FakeStream) {
        mixedSources.push(stream);
        return { connect: () => ({ connect() {} }) };
      }
      createGain() {
        return { gain: { value: 1 } };
      }
    },
  );
  vi.mocked(libraryRequest)
    .mockReset()
    .mockImplementation(async (path, method, body) => {
      if (path?.endsWith("/parts") && method === "POST")
        index.meetings[0].parts = [
          { id: "part1", file: "recording.webm", type: "video/webm", start: 0, end: 0, bytes: 0, complete: false },
        ];
      if (method === "PUT")
        return { committed: Number(new URL(`http://localhost${path}`).searchParams.get("offset")) + (body as Blob).size } as never;
      return { library: structuredClone(index), desktop: false } as never;
    });
});
afterEach(() => vi.unstubAllGlobals());
const stream = (video = false) =>
  new FakeStream([
    { kind: "audio", addEventListener() {} },
    ...(video ? [{ kind: "video", applyConstraints: () => Promise.resolve(), addEventListener() {} }] : []),
  ]) as unknown as MediaStream;
describe("progressive meeting recording", () => {
  it("mixes both audio sources with video and drains the last chunk before finalizing", async () => {
    const recorder = new MeetingRecorder();
    await recorder.start(stream(true), stream(), "screen", "Review", "");
    expect(mixedSources).toHaveLength(2);
    expect(instances[0].stream.getAudioTracks()).toHaveLength(1);
    expect(instances[0].stream.getVideoTracks()).toHaveLength(1);
    instances[0].ondataavailable?.({ data: new NodeBlob(["first"]) as unknown as Blob });
    await recorder.stop();
    const calls = vi.mocked(libraryRequest).mock.calls;
    const writes = calls.filter((call) => call[1] === "PUT");
    expect(writes).toHaveLength(2);
    expect(writes[0][0]).toContain("offset=0");
    expect(writes[1][0]).toContain("offset=5");
    expect(calls[calls.length - 1][0]).toContain("/finish");
  });
  it("retries the same bytes at the same offset and stops after repeated storage failures", async () => {
    const original = vi.mocked(libraryRequest).getMockImplementation();
    let attempts = 0;
    vi.mocked(libraryRequest).mockImplementation(async (...args) => {
      if (args[1] === "PUT") {
        attempts++;
        throw new Error("Disk full");
      }
      return original?.(...args) as never;
    });
    const recorder = new MeetingRecorder();
    await recorder.start(stream(true), stream(), "screen", "Review", "");
    await expect(recorder.stop()).rejects.toThrow("Disk full");
    expect(attempts).toBe(3);
    expect(
      vi
        .mocked(libraryRequest)
        .mock.calls.filter((call) => call[1] === "PUT")
        .every((call) => call[0]?.includes("offset=0")),
    ).toBe(true);
    expect(vi.mocked(libraryRequest).mock.calls.some((call) => call[0]?.endsWith("/finish"))).toBe(false);
  });
  it("does not save video in audio-only mode", async () => {
    const recorder = new MeetingRecorder();
    await recorder.start(stream(true), stream(), "audio", "Review", "");
    expect(instances[0].stream.getVideoTracks()).toHaveLength(0);
    expect(instances[0].options.mimeType).toContain("audio/");
    await recorder.stop();
  });
});
