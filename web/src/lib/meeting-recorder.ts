import { findMeeting, type LibraryMeeting, libraryRequest, type RecordingPart } from "./meeting-library";

export type CaptureMode = "audio" | "screen";

/** One continuous MediaRecorder container per part; chunks are persisted, never concatenated independent containers. */
export class MeetingRecorder {
  onFailure?: (error: Error) => void;
  recorder?: MediaRecorder;
  context?: AudioContext;
  meeting?: LibraryMeeting;
  part?: RecordingPart;
  startedAt = 0;
  wallStartedAt = 0;
  endedAt = 0;
  offset = 0;
  queuedBytes = 0;
  failure?: Error;
  queue: Promise<void> = Promise.resolve();
  done: Promise<void> = Promise.resolve();

  async start(
    display: MediaStream | null,
    microphone: MediaStream | null,
    mode: CaptureMode,
    title: string,
    folderId: string,
    meetingId?: string,
  ) {
    if (this.recorder?.state === "recording") throw new Error("Recording is already active.");
    const candidates =
      mode === "screen" ? ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"] : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
    if (!mimeType) throw new Error("This device has no supported meeting recording format.");
    const video = mode === "screen" ? (display?.getVideoTracks() ?? []) : [];
    if (mode === "screen" && !video.length) throw new Error("Choose a window or screen to record video.");
    const sources = [display, microphone].filter((stream): stream is MediaStream => !!stream && stream.getAudioTracks().length > 0);
    if (!sources.length && !video.length) throw new Error("No recording source is available.");
    let audio: MediaStreamTrack[] = [];
    if (sources.length) {
      this.context = new AudioContext();
      await this.context.resume();
      const destination = this.context.createMediaStreamDestination();
      for (const source of sources) {
        const node = this.context.createMediaStreamSource(new MediaStream(source.getAudioTracks()));
        const gain = this.context.createGain();
        gain.gain.value = sources.length > 1 ? 0.7 : 1;
        node.connect(gain).connect(destination);
      }
      audio = destination.stream.getAudioTracks();
    }
    const response = meetingId ? await libraryRequest() : await libraryRequest("/meetings", "POST", { title, folderId });
    this.meeting = meetingId ? findMeeting(response.library, meetingId) : response.library.meetings[response.library.meetings.length - 1];
    const partResponse = await libraryRequest(`/meetings/${this.meeting.id}/parts`, "POST", { type: mimeType });
    this.meeting = findMeeting(partResponse.library, this.meeting.id);
    this.part = this.meeting.parts[this.meeting.parts.length - 1];
    this.offset = 0;
    this.queuedBytes = 0;
    this.failure = undefined;
    this.queue = Promise.resolve();
    const meeting = this.meeting;
    const part = this.part;
    const sharp = response.library.quality === "sharp";
    for (const track of video)
      await track
        .applyConstraints({
          width: { ideal: sharp ? 1920 : 1280 },
          height: { ideal: sharp ? 1080 : 720 },
          frameRate: { ideal: 15, max: 30 },
        })
        .catch(() => undefined);
    const recorder = new MediaRecorder(new MediaStream([...video, ...audio]), {
      mimeType,
      videoBitsPerSecond: sharp ? 2500000 : 1500000,
      audioBitsPerSecond: 128000,
    });
    this.recorder = recorder;
    let finish = () => {};
    this.done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    recorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      this.queuedBytes += event.data.size;
      if (this.queuedBytes > 64 * 1024 * 1024) {
        this.failure = new Error("Storage cannot keep up with recording. Completed chunks are retained; stop and review the meeting.");
        this.onFailure?.(this.failure);
        if (recorder.state === "recording") recorder.stop();
        return;
      }
      const elapsed = Math.max(0, (performance.now() - this.startedAt) / 1000);
      this.queue = this.queue
        .then(async () => {
          if (this.failure) return;
          for (let position = 0; position < event.data.size; position += 2 * 1024 * 1024) {
            const chunk = event.data.slice(position, position + 2 * 1024 * 1024);
            let error: unknown;
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                const response = await libraryRequest<{ committed: number }>(
                  `/meetings/${meeting.id}/parts/${part.id}?offset=${this.offset}&elapsed=${elapsed}`,
                  "PUT",
                  chunk,
                );
                this.offset = response.committed;
                error = undefined;
                break;
              } catch (failure) {
                error = failure;
              }
            }
            if (error) throw error;
          }
        })
        .catch((error) => {
          this.failure = error instanceof Error ? error : new Error("Recording could not be written to disk.");
          this.onFailure?.(this.failure);
          if (recorder.state === "recording") recorder.stop();
        })
        .finally(() => {
          this.queuedBytes -= event.data.size;
        });
    };
    recorder.onerror = () => {
      this.failure = new Error("Screen recording stopped unexpectedly. Completed chunks were retained.");
      this.onFailure?.(this.failure);
      finish();
    };
    this.endedAt = 0;
    recorder.onstop = () => {
      this.endedAt = performance.now();
      finish();
    };
    this.startedAt = performance.now();
    this.wallStartedAt = Date.now();
    recorder.start(2000);
    video.forEach((track) =>
      track.addEventListener(
        "ended",
        () => {
          if (recorder.state === "recording") recorder.stop();
        },
        { once: true },
      ),
    );
    return meeting;
  }

  async stop() {
    if (!this.recorder || !this.meeting || !this.part) return;
    if (this.recorder.state === "recording" || this.recorder.state === "paused") this.recorder.stop();
    await this.done;
    await this.queue;
    const duration = Math.max(0, ((this.endedAt || performance.now()) - this.startedAt) / 1000);
    await this.context?.close();
    if (this.failure) throw this.failure;
    const response = await libraryRequest(`/meetings/${this.meeting.id}/parts/${this.part.id}/finish`, "POST", { duration });
    this.meeting = findMeeting(response.library, this.meeting.id);
    this.recorder = undefined;
    return this.meeting;
  }
}
