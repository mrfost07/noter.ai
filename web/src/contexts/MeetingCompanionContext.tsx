import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useMeetingNoteTaker } from "@/components/MemoEditor/hooks/useMeetingNoteTaker";
import type { SpeakerLabel } from "@/components/MemoEditor/services/websocketSTT";
import { useInstance } from "@/contexts/InstanceContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import { findMeeting, type LibraryLine, libraryRequest } from "@/lib/meeting-library";
import { type CaptureMode, MeetingRecorder } from "@/lib/meeting-recorder";
import { readMeetingRecovery, saveMeetingRecovery } from "@/lib/meeting-recovery";
import { invokeTauri } from "@/utils/tauri";

export interface MeetingDraft {
  id: string;
  content: string;
  mode?: "append" | "replace";
  meetingId?: string;
  targetTabId?: string;
}

interface MeetingCompanionContextValue {
  pendingDraft: MeetingDraft | null;
  requestDraft: (content: string, mode?: MeetingDraft["mode"], meetingId?: string, targetTabId?: string) => void;
  consumeDraft: (id: string) => void;
  isMeetingMode: boolean;
  isCollapsed: boolean;
  enterMeetingMode: () => Promise<void>;
  exitMeetingMode: () => Promise<void>;
  toggleCollapsed: () => Promise<void>;
  setCollapsed: (collapsed: boolean) => Promise<void>;
  activeSpeaker: SpeakerLabel;
  setActiveSpeaker: (speaker: SpeakerLabel) => void;
  manualText: string;
  setManualText: (text: string) => void;
  handleAddManualLine: () => void;
  meetingTaker: ReturnType<typeof useMeetingNoteTaker>;
  captureMode?: CaptureMode;
  setCaptureMode?: (mode: CaptureMode) => void;
  meetingTitle?: string;
  setMeetingTitle?: (title: string) => void;
  meetingFolder?: string;
  setMeetingFolder?: (folder: string) => void;
  currentMeetingId?: string;
  storageError?: string;
  flushTranscript?: () => Promise<string>;
  newMeeting?: () => Promise<void>;
}

export const MeetingCompanionContext = createContext<MeetingCompanionContextValue | null>(null);

export const MeetingCompanionProvider = ({ children }: { children: ReactNode }) => {
  const [pendingDraft, setPendingDraft] = useState<MeetingDraft | null>(null);
  const requestDraft = useCallback(
    (content: string, mode: MeetingDraft["mode"] = "append", meetingId?: string, targetTabId?: string) =>
      setPendingDraft({ id: crypto.randomUUID(), content, mode, meetingId, targetTabId }),
    [],
  );
  const consumeDraft = useCallback((id: string) => setPendingDraft((draft) => (draft?.id === id ? null : draft)), []);
  const [isMeetingMode, setIsMeetingMode] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState<SpeakerLabel>("[Client]");
  const [manualText, setManualText] = useState("");

  const userName = useCurrentUser()?.name;
  const [recovery] = useState(() => readMeetingRecovery(userName));
  const { aiSetting } = useInstance();
  const [captureMode, setCaptureMode] = useState<CaptureMode>("audio");
  const [meetingTitle, setMeetingTitle] = useState(recovery?.title ?? "Meeting");
  const [meetingFolder, setMeetingFolder] = useState(recovery?.folder ?? "");
  const [currentMeetingId, setCurrentMeetingId] = useState<string | undefined>(recovery?.id);
  const [storageError, setStorageError] = useState("");
  const recorderRef = useRef(new MeetingRecorder());
  const currentIdRef = useRef<string | undefined>(undefined);
  currentIdRef.current = currentMeetingId;
  const sessions = useRef(new Map<number, { wall: number; start: number }>(recovery?.sessions));
  const savedLines = useRef<LibraryLine[]>([]);
  const capturedLineIds = useRef(new Set<string>());
  const recoveryLoaded = useRef(false);
  const recoveryRequest = useRef<Promise<void> | null>(null);
  const ensureRecovered = useCallback(async () => {
    if (recoveryLoaded.current) return;
    if (!recovery && !takerRef.current.readTranscript().length) {
      recoveryLoaded.current = true;
      return;
    }
    if (!recoveryRequest.current) {
      recoveryRequest.current = libraryRequest()
        .then(({ library }) => {
          let meeting = recovery ? findMeeting(library, recovery.id) : undefined;
          if (!recovery) {
            // Older builds backed up passages without the library meeting ID.
            const ids = new Set(takerRef.current.readTranscript().map((line) => line.id));
            const matches = library.meetings.filter((item) => !item.trashed && item.transcript.some((line) => ids.has(line.id)));
            const recorded = matches.filter((item) => item.parts.length);
            const candidates = recorded.length ? recorded : matches;
            if (candidates.length > 1)
              throw new Error(
                "Several saved meetings match this recovered transcript. Review the originals in the library before continuing.",
              );
            meeting = candidates[0];
          }
          if (meeting) {
            savedLines.current = meeting.transcript;
            recorderRef.current.meeting = meeting;
            currentIdRef.current = meeting.id;
            setCurrentMeetingId(meeting.id);
            setMeetingTitle(meeting.title);
            setMeetingFolder(meeting.folderId);
            saveMeetingRecovery(userName, {
              id: meeting.id,
              title: meeting.title,
              folder: meeting.folderId,
              sessions: [...sessions.current],
            });
          }
          recoveryLoaded.current = true;
        })
        .finally(() => {
          recoveryRequest.current = null;
        });
    }
    await recoveryRequest.current;
  }, [recovery, userName]);
  const persistRecovery = useCallback(() => {
    try {
      saveMeetingRecovery(
        userName,
        currentIdRef.current
          ? { id: currentIdRef.current, title: meetingTitle, folder: meetingFolder, sessions: [...sessions.current] }
          : undefined,
      );
    } catch {
      setStorageError("Meeting recovery could not be saved. Keep this window open until the transcript is saved to the library.");
    }
  }, [userName, meetingTitle, meetingFolder]);
  useEffect(persistRecovery, [currentMeetingId, persistRecovery]);
  const onStreams = async (display: MediaStream | null, microphone: MediaStream | null, recording: number) => {
    setStorageError("");
    recorderRef.current.onFailure = (error) => {
      setStorageError(error.message);
      void stopAndPersist().catch(() => undefined);
    };
    try {
      await ensureRecovered();
      const meeting = await recorderRef.current.start(display, microphone, captureMode, meetingTitle, meetingFolder, currentIdRef.current);
      currentIdRef.current = meeting.id;
      setCurrentMeetingId(meeting.id);
      sessions.current.set(recording, { wall: recorderRef.current.wallStartedAt, start: recorderRef.current.part?.start ?? 0 });
      persistRecovery();
      await invokeTauri("set_recording_active", { active: true });
    } catch (error) {
      await recorderRef.current.context?.close();
      setStorageError(error instanceof Error ? error.message : "Could not start local recording.");
      const orphan = recorderRef.current.meeting?.id;
      if (orphan) {
        currentIdRef.current = orphan;
        setCurrentMeetingId(orphan);
        await libraryRequest(`/meetings/${orphan}/interrupt`, "POST", {}).catch(() => undefined);
      }
      throw error;
    }
  };
  const meetingTaker = useMeetingNoteTaker({
    storageKey: userName ? `noter-meeting:${userName}` : undefined,
    speakerRecognition: Boolean(aiSetting?.transcription?.speakerProviderId),
    analyst: aiSetting?.assistant,
    screenVideo: captureMode === "screen",
    onStreams,
    onSourceEnded: () => {
      void stopAndPersist().catch((error) => setStorageError(error.message));
    },
    onCaptureStop: async () => {
      try {
        await recorderRef.current.stop();
      } catch (error) {
        setStorageError(error instanceof Error ? error.message : "Recording could not finish.");
        if (currentIdRef.current) await libraryRequest(`/meetings/${currentIdRef.current}/interrupt`, "POST", {}).catch(() => undefined);
        throw error;
      }
    },
  });
  const takerRef = useRef(meetingTaker);
  takerRef.current = meetingTaker;
  useEffect(() => {
    const closeRequested = () =>
      setStorageError("A meeting is recording. Pause or stop it before closing Noter.ai so the final recording chunk can be saved.");
    window.addEventListener("noter-recording-close-requested", closeRequested);
    return () => window.removeEventListener("noter-recording-close-requested", closeRequested);
  }, []);
  const flushQueue = useRef<Promise<string>>(Promise.resolve(""));
  const flushTranscript = useCallback(() => {
    const pending = flushQueue.current
      .catch(() => "")
      .then(async () => {
        await ensureRecovered();
        let mid = currentIdRef.current;
        if (!mid) {
          const response = await libraryRequest("/meetings", "POST", { title: meetingTitle, folderId: meetingFolder });
          mid = response.library.meetings[response.library.meetings.length - 1].id;
          currentIdRef.current = mid;
          setCurrentMeetingId(mid);
          persistRecovery();
        }
        const byId = new Map(savedLines.current.filter((line) => !capturedLineIds.current.has(line.id)).map((line) => [line.id, line]));
        const previousLines = new Map(savedLines.current.map((line) => [line.id, line]));
        for (const line of takerRef.current.readTranscript()) {
          capturedLineIds.current.add(line.id);
          const session = sessions.current.get(line.recording ?? 0);
          const previous = previousLines.get(line.id);
          const start = session
            ? session.start + Math.max(0, ((line.capturedAt ?? Date.now()) - session.wall) / 1000)
            : (previous?.start ?? recorderRef.current.meeting?.duration ?? 0);
          const length = line.end !== undefined && line.start !== undefined ? line.end - line.start : 4;
          byId.set(line.id, {
            id: line.id,
            text: line.text,
            speaker:
              line.speaker === "[You]" ? "Microphone" : line.speaker === "[Client]" ? "Shared audio" : line.speaker.replace(/[[\]]/g, ""),
            start,
            end: !session && previous ? previous.end : start + length,
            approximate: line.approximate ?? previous?.approximate ?? (!session || (line.capturedAt ?? 0) < session.wall),
          });
        }
        const transcript = [...byId.values()].sort((a, b) => a.start - b.start);
        await libraryRequest(`/meetings/${mid}`, "PATCH", { transcript });
        savedLines.current = transcript;
        return mid;
      });
    flushQueue.current = pending;
    return pending;
  }, [meetingTitle, meetingFolder, ensureRecovered, persistRecovery]);
  const stopAndPersist = useCallback(async () => {
    let error: unknown;
    try {
      await takerRef.current.stopMeeting();
    } catch (failure) {
      error = failure;
    }
    try {
      if (currentIdRef.current) await flushTranscript();
    } finally {
      await invokeTauri("set_recording_active", { active: false });
    }
    if (error) throw error;
  }, [flushTranscript]);
  useEffect(() => {
    if (!currentMeetingId || !meetingTaker.transcript.length) return;
    const timer = window.setTimeout(() => void flushTranscript().catch((error) => setStorageError(error.message)), 500);
    return () => window.clearTimeout(timer);
  }, [currentMeetingId, meetingTaker.transcript, flushTranscript]);
  const newMeeting = useCallback(async () => {
    await stopAndPersist();
    takerRef.current.clearMeeting();
    setCurrentMeetingId(undefined);
    currentIdRef.current = undefined;
    sessions.current.clear();
    savedLines.current = [];
    capturedLineIds.current.clear();
    recoveryLoaded.current = true;
    saveMeetingRecovery(userName);
    recorderRef.current = new MeetingRecorder();
    setMeetingTitle("Meeting");
    setStorageError("");
  }, [stopAndPersist, userName]);

  const handleAddManualLine = useCallback(() => {
    const trimmed = manualText.trim();
    if (!trimmed) return;
    meetingTaker.appendTranscript(activeSpeaker, trimmed);
    setManualText("");
  }, [activeSpeaker, manualText, meetingTaker]);

  const enterMeetingMode = useCallback(async () => {
    setIsMeetingMode(true);
    setIsCollapsed(false);
    // Opening or reviewing a meeting does not restart capture. Recording has its own explicit control.
    await invokeTauri("set_meeting_mode", { enabled: true });
  }, []);

  const exitMeetingMode = useCallback(async () => {
    setIsMeetingMode(false);
    setIsCollapsed(false);
    await invokeTauri("set_meeting_mode", { enabled: false });
  }, []);

  const setCollapsed = useCallback(async (collapsed: boolean) => {
    setIsCollapsed(collapsed);
    await invokeTauri("toggle_meeting_collapsed", { collapsed });
  }, []);

  const toggleCollapsed = useCallback(async () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    await invokeTauri("toggle_meeting_collapsed", { collapsed: next });
  }, [isCollapsed]);

  const value = useMemo(
    () => ({
      pendingDraft,
      requestDraft,
      consumeDraft,
      isMeetingMode,
      isCollapsed,
      enterMeetingMode,
      exitMeetingMode,
      toggleCollapsed,
      setCollapsed,
      activeSpeaker,
      setActiveSpeaker,
      manualText,
      setManualText,
      handleAddManualLine,
      meetingTaker: { ...meetingTaker, stopMeeting: stopAndPersist },
      captureMode,
      setCaptureMode,
      meetingTitle,
      setMeetingTitle,
      meetingFolder,
      setMeetingFolder,
      currentMeetingId,
      storageError,
      flushTranscript,
      newMeeting,
    }),
    [
      pendingDraft,
      requestDraft,
      consumeDraft,
      isMeetingMode,
      isCollapsed,
      enterMeetingMode,
      exitMeetingMode,
      toggleCollapsed,
      setCollapsed,
      activeSpeaker,
      manualText,
      handleAddManualLine,
      meetingTaker,
      stopAndPersist,
      captureMode,
      meetingTitle,
      meetingFolder,
      currentMeetingId,
      storageError,
      flushTranscript,
      newMeeting,
    ],
  );

  return <MeetingCompanionContext.Provider value={value}>{children}</MeetingCompanionContext.Provider>;
};

const DEFAULT_MEETING_TAKER: ReturnType<typeof useMeetingNoteTaker> = {
  readTranscript: () => [],
  setOrganizedDraft: () => {},
  speakerStatus: "",
  isRecording: false,
  isStarting: false,
  isFinishing: false,
  isAnalyzing: false,
  elapsedSeconds: 0,
  clientChannelActive: false,
  micChannelActive: false,
  microphoneActivity: null,
  transcript: [],
  notes: {
    tasksForYou: [],
    midMeetingChanges: [],
    clientDecisions: [],
    crucialInfo: [],
    followUpQuestions: [],
  },
  organizedMarkdown: "",
  statusSummary: "",
  relatedMemoNames: [],
  error: null,
  startMeeting: async () => {},
  stopMeeting: async () => {},
  clearMeeting: () => {},
  appendTranscript: () => {},
  runAnalysisNow: async () => ({}),
  formatAsMarkdown: () => "",
};

export const useMeetingCompanion = (): MeetingCompanionContextValue => {
  const context = useContext(MeetingCompanionContext);
  if (!context) {
    return {
      pendingDraft: null,
      requestDraft: () => {},
      consumeDraft: () => {},
      isMeetingMode: false,
      isCollapsed: false,
      enterMeetingMode: async () => {},
      exitMeetingMode: async () => {},
      toggleCollapsed: async () => {},
      setCollapsed: async () => {},
      activeSpeaker: "[Client]",
      setActiveSpeaker: () => {},
      manualText: "",
      setManualText: () => {},
      handleAddManualLine: () => {},
      meetingTaker: DEFAULT_MEETING_TAKER,
    };
  }
  return context;
};
