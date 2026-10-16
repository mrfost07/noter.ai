import { useCallback, useEffect, useRef, useState } from "react";
import { transcriptionService } from "../services/transcriptionService";
import type { SpeakerLabel } from "../services/websocketSTT";
import { detectAudioActivity } from "../utils/audioActivity";
import { meetingRequest } from "../utils/meetingRequest";
import { appendCapturedLine, buildSpeakerTurns, displaySpeaker } from "../utils/meetingSpeakers";

export interface TranscriptLine {
  id: string;
  timestamp: string;
  speaker: SpeakerLabel;
  text: string;
  source?: "microphone" | "shared";
  capturedAt?: number;
  recording?: number;
  start?: number;
  end?: number;
  approximate?: boolean;
}

export interface MeetingNoteState {
  tasksForYou: string[];
  midMeetingChanges: string[];
  clientDecisions: string[];
  crucialInfo: string[];
  followUpQuestions: string[];
}

export interface UseMeetingNoteTakerOptions {
  memoName?: string;
  storageKey?: string;
  speakerRecognition?: boolean;
  analyst?: { providerId: string; model: string };
  screenVideo?: boolean;
  onStreams?: (display: MediaStream | null, microphone: MediaStream | null, recording: number) => Promise<void>;
  onCaptureStop?: () => Promise<void>;
  onSourceEnded?: () => void;
}

const EMPTY_NOTES: MeetingNoteState = {
  tasksForYou: [],
  midMeetingChanges: [],
  clientDecisions: [],
  crucialInfo: [],
  followUpQuestions: [],
};

function readMeetingDraft(key?: string): {
  transcript: TranscriptLine[];
  notes: MeetingNoteState;
  elapsedSeconds: number;
  organizedMarkdown: string;
} {
  const empty = { transcript: [], notes: EMPTY_NOTES, elapsedSeconds: 0, organizedMarkdown: "" };
  if (!key) return empty;
  try {
    const draft = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!draft || !Array.isArray(draft.transcript)) return empty;
    const transcript = draft.transcript.filter(
      (line: TranscriptLine) =>
        line &&
        typeof line.id === "string" &&
        typeof line.timestamp === "string" &&
        typeof line.text === "string" &&
        (line.speaker === "[Client]" ||
          line.speaker === "[You]" ||
          line.speaker === "[Note]" ||
          /^\[Client \d+(?: · recording \d+)?\]$/.test(line.speaker)),
    );
    const notes = { ...EMPTY_NOTES };
    for (const section of Object.keys(notes) as (keyof MeetingNoteState)[]) {
      notes[section] = Array.isArray(draft.notes?.[section])
        ? draft.notes[section].filter((item: unknown) => typeof item === "string")
        : [];
    }
    return {
      transcript,
      notes,
      organizedMarkdown: typeof draft.organizedMarkdown === "string" ? draft.organizedMarkdown : "",
      elapsedSeconds: Number.isFinite(draft.elapsedSeconds) && draft.elapsedSeconds >= 0 ? draft.elapsedSeconds : 0,
    };
  } catch {
    return empty;
  }
}

function selectMimeType(): string {
  if (typeof MediaRecorder === "undefined") {
    return "audio/webm";
  }
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return "";
}

export function useMeetingNoteTaker(options: UseMeetingNoteTakerOptions = {}) {
  const { memoName, storageKey } = options;
  const captureOptionsRef = useRef(options);
  captureOptionsRef.current = options;
  const speakerRecognitionRef = useRef(options.speakerRecognition ?? false);
  speakerRecognitionRef.current = options.speakerRecognition ?? false;
  const analystRef = useRef(options.analyst);
  analystRef.current = options.analyst;
  const [restored] = useState(() => readMeetingDraft(storageKey));
  const [speakerStatus, setSpeakerStatus] = useState("");
  const recordingRef = useRef(Math.max(0, ...restored.transcript.map((line) => line.recording ?? 0)));
  const speakerCaptureRef = useRef<{
    recorder: MediaRecorder;
    chunks: Blob[];
    bytes: number;
    startedAt: number;
    recording: number;
    generation: number;
    done: Promise<void>;
  } | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const startingRef = useRef(false);
  const finishingRef = useRef(false);
  const finishingWaitRef = useRef<Promise<void>>(Promise.resolve());
  const generationRef = useRef(0);
  const pendingRef = useRef(new Set<Promise<void>>());
  const requestsRef = useRef(new Set<AbortController>());
  const transcriptionEpoch = useRef(0);
  const analysisBusyRef = useRef(false);
  const analysisFinishedRef = useRef<Promise<void>>(Promise.resolve());
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(restored.elapsedSeconds);
  const [clientChannelActive, setClientChannelActive] = useState(false);
  const [micChannelActive, setMicChannelActive] = useState(false);
  const [microphoneActivity, setMicrophoneActivity] = useState<"quiet" | "audio" | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>(restored.transcript);
  const [notes, setNotes] = useState<MeetingNoteState>(restored.notes);
  const [organizedMarkdown, setOrganizedMarkdown] = useState(restored.organizedMarkdown);
  const organizedMarkdownRef = useRef(restored.organizedMarkdown);
  const [statusSummary, setStatusSummary] = useState<string>("");
  const [relatedMemoNames, setRelatedMemoNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const clientStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const intervalsRef = useRef<number[]>([]);
  const timeoutsRef = useRef<number[]>([]);
  const activeRecordersRef = useRef<Set<MediaRecorder>>(new Set());
  const isRecordingActiveRef = useRef(false);
  const transcriptRef = useRef<TranscriptLine[]>([]);
  const notesRef = useRef<MeetingNoteState>(EMPTY_NOTES);
  const lastAnalyzedCountRef = useRef<number>(0);
  const memoNameRef = useRef(memoName);

  transcriptRef.current = transcript;
  notesRef.current = notes;
  memoNameRef.current = memoName;
  const elapsedRef = useRef(elapsedSeconds);
  elapsedRef.current = elapsedSeconds;
  useEffect(() => {
    if (!storageKey) return;
    try {
      if (!transcript.length && !Object.values(notes).some((items) => items.length)) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, JSON.stringify({ transcript, notes, organizedMarkdown, elapsedSeconds: elapsedRef.current }));
    } catch {
      setError("This meeting could not be backed up on this device. Save it as a note to keep a copy.");
    }
  }, [storageKey, transcript, notes, organizedMarkdown]);

  const appendTranscript = useCallback(
    (
      speaker: SpeakerLabel,
      text: string,
      capture?: Pick<TranscriptLine, "source" | "capturedAt" | "recording" | "start" | "end" | "approximate">,
    ) => {
      const clean = text.trim();
      if (!clean || !/[\p{L}\p{N}]/u.test(clean)) return;
      const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const manualCapture =
        !capture && captureOptionsRef.current.onStreams && isRecordingActiveRef.current
          ? { capturedAt: Date.now(), recording: recordingRef.current, approximate: true }
          : {};
      const next = appendCapturedLine(transcriptRef.current, {
        id: crypto.randomUUID(),
        timestamp: now,
        speaker,
        text: clean,
        ...manualCapture,
        ...capture,
      });
      transcriptRef.current = next;
      setTranscript(next);
    },
    [],
  );

  const startChannelChunkLoop = useCallback(
    (stream: MediaStream, speaker: SpeakerLabel, chunkMs = 6000) => {
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) return;

      const audioOnlyStream = new MediaStream(audioTracks);
      const mimeType = selectMimeType();
      const generation = generationRef.current;
      const recording = recordingRef.current;
      const epoch = transcriptionEpoch.current;
      let queue = Promise.resolve();
      let queued = 0;

      const recordSingleChunk = () => {
        if (!audioOnlyStream.active || !isRecordingActiveRef.current) return;
        if (queued >= 3) {
          setError(
            "Transcription cannot keep up. Some live passages may be missing; the local recording continues. Review its audio before relying on these notes.",
          );
          return;
        }
        let recorder: MediaRecorder;
        const capturedAt = Date.now();
        try {
          recorder = mimeType ? new MediaRecorder(audioOnlyStream, { mimeType }) : new MediaRecorder(audioOnlyStream);
        } catch {
          return;
        }

        activeRecordersRef.current.add(recorder);
        queued++;
        const chunks: BlobPart[] = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        let finish = () => {};
        const pending = new Promise<void>((resolve) => {
          finish = resolve;
        });
        pendingRef.current.add(pending);
        recorder.onstop = () => {
          activeRecordersRef.current.delete(recorder);
          queue = queue
            .then(async () => {
              if (generation !== generationRef.current || epoch !== transcriptionEpoch.current || chunks.length === 0) return;
              try {
                await meetingRequest(async (signal) => {
                  const effectiveType = recorder.mimeType || mimeType || "audio/webm";
                  const blob = new Blob(chunks, { type: effectiveType });
                  if (!blob.size) return;
                  const activity = audioTracks.every((track) => track.enabled === false || track.muted)
                    ? false
                    : await detectAudioActivity(blob);
                  if (generation !== generationRef.current || signal.aborted) return;
                  if (speaker === "[You]") setMicrophoneActivity(activity === null ? null : activity ? "audio" : "quiet");
                  if (activity === false) return;
                  const ext = effectiveType.includes("mp4") ? "m4a" : "webm";
                  const file = new File([blob], `${speaker === "[Client]" ? "client" : "you"}-${Date.now()}.${ext}`, {
                    type: effectiveType,
                  });
                  if (captureOptionsRef.current.onStreams && transcriptionService.transcribeTimedFile) {
                    const result = await transcriptionService.transcribeTimedFile(file, signal);
                    if (generation === generationRef.current && !signal.aborted) {
                      const segments = result.segments.filter(
                        (segment) =>
                          segment.text.trim() &&
                          Number.isFinite(segment.start) &&
                          Number.isFinite(segment.end) &&
                          segment.start >= 0 &&
                          segment.end >= segment.start,
                      );
                      if (segments.length)
                        segments.forEach((segment) =>
                          appendTranscript(speaker, segment.text, {
                            source: speaker === "[You]" ? "microphone" : "shared",
                            capturedAt: capturedAt + segment.start * 1000,
                            recording,
                            start: segment.start,
                            end: segment.end,
                          }),
                        );
                      else if (result.text)
                        appendTranscript(speaker, result.text, {
                          source: speaker === "[You]" ? "microphone" : "shared",
                          capturedAt,
                          recording,
                          start: 0,
                          end: chunkMs / 1000,
                          approximate: true,
                        });
                    }
                  } else {
                    const text = await transcriptionService.transcribeFile(file, signal);
                    if (text && generation === generationRef.current && !signal.aborted)
                      appendTranscript(speaker, text, { source: speaker === "[You]" ? "microphone" : "shared", capturedAt, recording });
                  }
                }, requestsRef.current);
              } catch (err) {
                if (generation === generationRef.current)
                  setError(err instanceof Error ? err.message : `Could not transcribe ${speaker} audio.`);
              }
            })
            .finally(() => {
              queued--;
              pendingRef.current.delete(pending);
              finish();
            });
        };

        recorder.start();
        const timeoutId = window.setTimeout(() => {
          timeoutsRef.current = timeoutsRef.current.filter((id) => id !== timeoutId);
          if (recorder.state === "recording") {
            recorder.stop();
          }
        }, chunkMs);
        timeoutsRef.current.push(timeoutId);
      };

      recordSingleChunk();
      const id = window.setInterval(recordSingleChunk, chunkMs);
      intervalsRef.current.push(id);
    },
    [appendTranscript],
  );

  const runAnalysisNow = useCallback(
    async (
      analysisOptions: { fullTranscript?: boolean } = {},
    ): Promise<{
      notes?: MeetingNoteState;
      markdown?: string;
      statusSummary?: string;
    }> => {
      const requestedGeneration = generationRef.current;
      if (analysisBusyRef.current) {
        await analysisFinishedRef.current;
        if (requestedGeneration !== generationRef.current || !analysisOptions.fullTranscript) return {};
      }
      const lines = transcriptRef.current;
      if (lines.length === 0) return {};
      let finishAnalysis = () => {};
      analysisFinishedRef.current = new Promise<void>((resolve) => {
        finishAnalysis = resolve;
      });
      analysisBusyRef.current = true;
      const generation = generationRef.current;

      setIsAnalyzing(true);
      setError(null);
      try {
        const recentLines = analysisOptions.fullTranscript ? lines : lines.slice(Math.max(0, lastAnalyzedCountRef.current - 2));
        const fullTranscriptText = recentLines.map((l) => `[${l.timestamp}] ${l.speaker}: ${l.text}`).join("\n");
        const response = await meetingRequest(
          (signal) =>
            transcriptionService.analyzeMeetingTranscript(
              {
                transcript: fullTranscriptText,
                previousState: analysisOptions.fullTranscript ? undefined : notesRef.current,
                memoName: memoNameRef.current,
                providerId: analystRef.current?.providerId,
                model: analystRef.current?.model,
              },
              signal,
            ),
          requestsRef.current,
          90000,
        );

        if (generation !== generationRef.current) return {};
        let nextNotes: MeetingNoteState | undefined;
        if (response.notes) {
          nextNotes = {
            tasksForYou: [...(response.notes.tasksForYou ?? [])],
            midMeetingChanges: [...(response.notes.midMeetingChanges ?? [])],
            clientDecisions: [...(response.notes.clientDecisions ?? [])],
            crucialInfo: [...(response.notes.crucialInfo ?? [])],
            followUpQuestions: [...(response.notes.followUpQuestions ?? [])],
          };
          notesRef.current = nextNotes;
          setNotes(nextNotes);
        }
        if (response.markdown) {
          organizedMarkdownRef.current = response.markdown;
          setOrganizedMarkdown(response.markdown);
        }
        if (response.relatedMemoNames && response.relatedMemoNames.length > 0) {
          const related = [...response.relatedMemoNames];
          setRelatedMemoNames(related);
        }
        if (response.statusSummary) {
          setStatusSummary(response.statusSummary);
        } else if (response.notes) {
          setStatusSummary(`Updated ${response.notes.tasksForYou.length} tasks, ${response.notes.clientDecisions.length} decisions`);
        }
        lastAnalyzedCountRef.current = lines.length;
        return {
          notes: nextNotes,
          markdown: response.markdown,
          statusSummary: response.statusSummary,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to analyze meeting transcript";
        setError(msg);
        throw err;
      } finally {
        finishAnalysis();
        analysisBusyRef.current = false;
        setIsAnalyzing(false);
      }
    },
    [],
  );

  const startMeeting = useCallback(async () => {
    if (isRecordingActiveRef.current || startingRef.current || finishingRef.current) return;
    if (typeof MediaRecorder === "undefined") {
      setError("Audio recording is unavailable in this browser. You can add transcript lines manually.");
      return;
    }
    startingRef.current = true;
    setIsStarting(true);
    setMicrophoneActivity(null);
    setError(null);
    const generation = generationRef.current;
    recordingRef.current++;
    setSpeakerStatus(
      speakerRecognitionRef.current
        ? "Client numbers will be added after this recording stops."
        : "Shared audio is grouped. Optional speaker recognition is available in AI & meetings settings.",
    );
    let hasAnyChannel = false;
    isRecordingActiveRef.current = true;

    // 1. Capture [Client] System / Tab Audio via getDisplayMedia
    if (navigator.mediaDevices?.getDisplayMedia) {
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        if (generation !== generationRef.current) {
          displayStream.getTracks().forEach((track) => track.stop());
          startingRef.current = false;
          setIsStarting(false);
          return;
        }
        if (displayStream.getAudioTracks().length > 0 || captureOptionsRef.current.screenVideo) {
          clientStreamRef.current = displayStream;
          if (speakerRecognitionRef.current) {
            try {
              const recorder = new MediaRecorder(new MediaStream(displayStream.getAudioTracks()), {
                mimeType: selectMimeType(),
                audioBitsPerSecond: 64000,
              });
              let finishCapture = () => {};
              const done = new Promise<void>((resolve) => {
                finishCapture = resolve;
              });
              const capture = {
                recorder,
                chunks: [] as Blob[],
                bytes: 0,
                startedAt: Date.now(),
                recording: recordingRef.current,
                generation,
                done,
              };
              recorder.ondataavailable = (event) => {
                capture.bytes += event.data.size;
                if (capture.bytes <= 25 * 1024 * 1024) capture.chunks.push(event.data);
                else {
                  capture.chunks = [];
                  setSpeakerStatus("Speaker recognition exceeded the 25 MiB limit. Live transcript is retained.");
                }
              };
              recorder.onstop = finishCapture;
              recorder.onerror = finishCapture;
              speakerCaptureRef.current = capture;
              recorder.start(4000);
            } catch {
              setSpeakerStatus("Speaker recognition recording is unavailable. Live transcript is retained.");
            }
          }
          setClientChannelActive(displayStream.getAudioTracks().length > 0);
          displayStream.getTracks().forEach((track) =>
            track.addEventListener(
              "ended",
              () => {
                setClientChannelActive(false);
                setError("Screen sharing ended. Shared audio is no longer being captured.");
                if (track.kind === "video" && captureOptionsRef.current.screenVideo) captureOptionsRef.current.onSourceEnded?.();
              },
              { once: true },
            ),
          );
          startChannelChunkLoop(displayStream, "[Client]", 4000);
          hasAnyChannel = true;
        } else {
          displayStream.getTracks().forEach((track) => track.stop());
          setClientChannelActive(false);
          setError("System/tab audio was not shared. Recording microphone ([You]) only.");
        }
      } catch {
        if (generation !== generationRef.current) {
          startingRef.current = false;
          setIsStarting(false);
          return;
        }
        setClientChannelActive(false);
        setError("Shared audio is off. Select a screen or tab and enable Share audio to capture other participants.");
      }
    }

    // 2. Capture [You] Microphone Audio via getUserMedia
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (generation !== generationRef.current) {
          micStream.getTracks().forEach((track) => track.stop());
          startingRef.current = false;
          setIsStarting(false);
          return;
        }
        micStreamRef.current = micStream;
        setMicChannelActive(true);
        startChannelChunkLoop(micStream, "[You]", 4000);
        hasAnyChannel = true;
      } catch (err) {
        if (generation !== generationRef.current) {
          startingRef.current = false;
          setIsStarting(false);
          return;
        }
        setMicChannelActive(false);
        if (!hasAnyChannel) {
          setError(err instanceof Error ? err.message : "Failed to start meeting audio capture");
          isRecordingActiveRef.current = false;
          startingRef.current = false;
          setIsStarting(false);
          return;
        }
        setError("Microphone is off. Only shared audio is being captured.");
      }
    }

    startingRef.current = false;
    setIsStarting(false);
    if (!hasAnyChannel) {
      isRecordingActiveRef.current = false;
      setError("No audio input channel available. Check microphone or screen audio permissions.");
      return;
    }

    try {
      startingRef.current = true;
      setIsStarting(true);
      await captureOptionsRef.current.onStreams?.(clientStreamRef.current, micStreamRef.current, recordingRef.current);
      if (generation !== generationRef.current) {
        await captureOptionsRef.current.onCaptureStop?.();
        startingRef.current = false;
        setIsStarting(false);
        return;
      }
    } catch (error) {
      isRecordingActiveRef.current = false;
      intervalsRef.current.forEach((id) => window.clearInterval(id));
      timeoutsRef.current.forEach((id) => window.clearTimeout(id));
      activeRecordersRef.current.forEach((recorder) => {
        if (recorder.state === "recording") recorder.stop();
      });
      clientStreamRef.current?.getTracks().forEach((track) => track.stop());
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      setClientChannelActive(false);
      setMicChannelActive(false);
      startingRef.current = false;
      setIsStarting(false);
      setError(error instanceof Error ? error.message : "Recording could not start. Your existing files are retained.");
      return;
    }
    startingRef.current = false;
    setIsStarting(false);

    // 3. Elapsed timer (1s)
    const elapsedTimer = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    intervalsRef.current.push(elapsedTimer);

    // 4. Periodically run AI analysis every 10s when new transcript lines arrive
    const analysisTimer = window.setInterval(() => {
      if (transcriptRef.current.length > lastAnalyzedCountRef.current) {
        void runAnalysisNow().catch(() => undefined);
      }
    }, 10000);
    intervalsRef.current.push(analysisTimer);

    isRecordingActiveRef.current = true;
    setIsRecording(true);
  }, [runAnalysisNow, startChannelChunkLoop]);

  const stopMeeting = useCallback(async () => {
    if (finishingRef.current) return finishingWaitRef.current;
    let finishStop = () => {};
    finishingWaitRef.current = new Promise<void>((resolve) => {
      finishStop = resolve;
    });
    finishingRef.current = true;
    setIsFinishing(true);
    if (startingRef.current) generationRef.current++;
    isRecordingActiveRef.current = false;
    let speakerCapture = speakerCaptureRef.current;
    speakerCaptureRef.current = null;
    if (speakerCapture?.recorder.state === "recording") {
      try {
        speakerCapture.recorder.stop();
      } catch {
        speakerCapture = null;
        setSpeakerStatus("Speaker recording could not finish. Live transcript is retained.");
      }
    }
    intervalsRef.current.forEach((id) => window.clearInterval(id));
    intervalsRef.current = [];
    timeoutsRef.current.forEach((id) => window.clearTimeout(id));
    timeoutsRef.current = [];
    activeRecordersRef.current.forEach((r) => {
      try {
        if (r.state === "recording") {
          r.stop();
        }
      } catch {
        // Ignore during stop.
      }
    });
    activeRecordersRef.current.clear();
    clientStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    clientStreamRef.current = null;
    micStreamRef.current = null;
    setClientChannelActive(false);
    setMicChannelActive(false);
    setIsRecording(false);
    try {
      let captureError: unknown;
      try {
        await captureOptionsRef.current.onCaptureStop?.();
      } catch (error) {
        captureError = error;
      }
      const finishDeadline = window.setTimeout(() => {
        transcriptionEpoch.current++;
        for (const request of requestsRef.current)
          request.abort(
            new Error("Stopped waiting for the provider. Some transcript passages may be missing; review the saved recording."),
          );
      }, 30000);
      try {
        await Promise.all([...pendingRef.current]);
        await analysisFinishedRef.current;
      } finally {
        window.clearTimeout(finishDeadline);
      }
      if (speakerCapture && speakerCapture.generation === generationRef.current) {
        await meetingRequest(() => speakerCapture.done, requestsRef.current, 10000);
        if (speakerCapture.bytes > 0 && speakerCapture.bytes <= 25 * 1024 * 1024 && speakerCapture.chunks.length) {
          setSpeakerStatus("Identifying voices in shared audio…");
          try {
            const type = speakerCapture.recorder.mimeType || "audio/webm";
            const file = new File(speakerCapture.chunks, `meeting-${speakerCapture.recording}.${type.includes("mp4") ? "m4a" : "webm"}`, {
              type,
            });
            const result = await meetingRequest(
              (signal) => transcriptionService.recognizeSpeakers(file, signal),
              requestsRef.current,
              60000,
            );
            if (speakerCapture.generation === generationRef.current) {
              const turns = buildSpeakerTurns(result.segments, speakerCapture.startedAt, speakerCapture.recording);
              if (turns.some((line) => line.speaker !== "[Client]")) {
                const retained = transcriptRef.current.filter(
                  (line) => !(line.source === "shared" && line.recording === speakerCapture.recording),
                );
                const next = turns.reduce(appendCapturedLine, retained).sort((a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0));
                transcriptRef.current = next;
                setTranscript(next);
                setSpeakerStatus("Client numbers added for this recording. They are voice labels, not verified identities.");
              } else setSpeakerStatus("No speaker identities were returned. Shared audio is kept grouped.");
            }
          } catch (error) {
            if (speakerCapture.generation === generationRef.current)
              setSpeakerStatus(
                `Speaker recognition failed; live transcript is retained. ${error instanceof Error ? error.message : "Retry with a supported provider."}`,
              );
          }
        }
      }
      if (captureError) throw captureError;
    } finally {
      finishingRef.current = false;
      setIsFinishing(false);
      finishStop();
    }
  }, []);

  const clearMeeting = useCallback(() => {
    generationRef.current++;
    void stopMeeting();
    transcriptRef.current = [];
    notesRef.current = EMPTY_NOTES;
    setTranscript([]);
    setNotes(EMPTY_NOTES);
    organizedMarkdownRef.current = "";
    setOrganizedMarkdown("");
    setStatusSummary("");
    setRelatedMemoNames([]);
    setElapsedSeconds(0);
    setError(null);
    setSpeakerStatus("");
    lastAnalyzedCountRef.current = 0;
  }, [stopMeeting]);

  useEffect(() => {
    return () => {
      generationRef.current++;
      for (const request of requestsRef.current) request.abort();
      try {
        speakerCaptureRef.current?.recorder.stop();
      } catch {
        /* Already stopped. */
      }
      speakerCaptureRef.current = null;
      isRecordingActiveRef.current = false;
      intervalsRef.current.forEach((id) => window.clearInterval(id));
      timeoutsRef.current.forEach((id) => window.clearTimeout(id));
      activeRecordersRef.current.forEach((r) => {
        try {
          if (r.state === "recording") {
            r.stop();
          }
        } catch {
          // Ignore during unmount.
        }
      });
      activeRecordersRef.current.clear();
      clientStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const formatAsMarkdown = useCallback((): string => {
    if (organizedMarkdownRef.current.trim()) return organizedMarkdownRef.current;
    const currentNotes = notesRef.current;
    const currentTranscript = transcriptRef.current;
    if (!currentTranscript.length && !Object.values(currentNotes).some((items) => items.length)) return "";
    const lines = ["# Meeting notes", ""];
    const sections: [string, string[], boolean][] = [
      ["Tasks & fixes", currentNotes.tasksForYou, true],
      ["Requirements & scope changes", currentNotes.midMeetingChanges, false],
      ["Decisions", currentNotes.clientDecisions, false],
      ["Project requirements & constraints", currentNotes.crucialInfo, false],
      ["Follow-up questions", currentNotes.followUpQuestions, false],
    ];
    for (const [title, items, checklist] of sections) {
      if (items.length) lines.push(`## ${title}`, ...items.map((item) => `- ${checklist ? "[ ] " : ""}${item}`), "");
    }
    if (currentTranscript.length)
      lines.push(
        "## Transcript",
        "",
        ...currentTranscript.map((line) => `- [${line.timestamp}] **${displaySpeaker(line.speaker)}**: ${line.text}`),
      );
    return lines.join("\n");
  }, []);

  return {
    readTranscript: () => transcriptRef.current,
    setOrganizedDraft: (markdown: string) => {
      organizedMarkdownRef.current = markdown;
      setOrganizedMarkdown(markdown);
    },
    speakerStatus,
    isRecording,
    isStarting,
    isFinishing,
    isAnalyzing,
    elapsedSeconds,
    clientChannelActive,
    micChannelActive,
    microphoneActivity,
    transcript,
    notes,
    organizedMarkdown,
    statusSummary,
    relatedMemoNames,
    error,
    startMeeting,
    stopMeeting,
    clearMeeting,
    appendTranscript,
    runAnalysisNow,
    formatAsMarkdown,
  };
}
