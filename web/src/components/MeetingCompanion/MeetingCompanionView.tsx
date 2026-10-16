import { create } from "@bufbuild/protobuf";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  Maximize2Icon,
  MicIcon,
  MonitorIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { useLocation, useNavigate } from "react-router-dom";
import MemoContent from "@/components/MemoContent";
import { displaySpeaker } from "@/components/MemoEditor/utils/meetingSpeakers";
import { MemoViewContext, type MemoViewContextValue } from "@/components/MemoView/MemoViewContext";
import { Button } from "@/components/ui/button";
import { useMeetingCompanion } from "@/contexts/MeetingCompanionContext";
import { useTranscriptFollow } from "@/hooks/useTranscriptFollow";
import { libraryRequest } from "@/lib/meeting-library";
import { cn } from "@/lib/utils";
import { MemoSchema } from "@/types/proto/api/memo_service_pb";

// Meeting previews have no persisted memo to mutate. Tags and task checkboxes
// still need the same rendering context as a saved note.
const MEETING_PREVIEW_CONTEXT: MemoViewContextValue = {
  memo: create(MemoSchema),
  creator: undefined,
  currentUser: undefined,
  parentPage: "/",
  cardWidth: 440,
  isArchived: false,
  readonly: true,
  showBlurredContent: false,
  blurred: false,
  openEditor: () => {},
  toggleBlurVisibility: () => {},
  openPreview: () => {},
};

export function MeetingCompanionView() {
  const {
    isMeetingMode,
    isCollapsed,
    exitMeetingMode,
    setCollapsed,
    meetingTaker: meeting,
    activeSpeaker,
    setActiveSpeaker,
    manualText,
    setManualText,
    handleAddManualLine,
    requestDraft,
    captureMode,
    setCaptureMode,
    meetingTitle,
    setMeetingTitle,
    currentMeetingId,
    storageError,
    flushTranscript,
    newMeeting,
  } = useMeetingCompanion();
  const [tab, setTab] = useState<"notes" | "transcript">("notes");
  const transcriptFollow = useTranscriptFollow(meeting.transcript, tab === "transcript" && isMeetingMode && !isCollapsed);
  const [preparing, setPreparing] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [replaceCurrent, setReplaceCurrent] = useState(false);
  const preparingRef = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();
  const busy = meeting.isStarting || meeting.isFinishing;
  const time = `${Math.floor(meeting.elapsedSeconds / 60)
    .toString()
    .padStart(2, "0")}:${(meeting.elapsedSeconds % 60).toString().padStart(2, "0")}`;
  const review = async () => {
    if (preparingRef.current) return;
    preparingRef.current = true;
    setPreparing(true);
    setDraftError(null);
    try {
      await meeting.stopMeeting();
      const mid = await flushTranscript?.();
      const analysis = mid
        ? await libraryRequest<{ markdown: string }>(`/meetings/${mid}/organize`, "POST", {})
        : await meeting.runAnalysisNow({ fullTranscript: true });
      const content = analysis.markdown?.trim();
      if (!content) throw new Error("AI returned no organized notes. Retry organization or copy the transcript.");
      meeting.setOrganizedDraft?.(content);
      requestDraft(content, replaceCurrent ? "replace" : "append", mid);
      await exitMeetingMode();
      if (!(location.pathname === "/" || location.pathname === "/archived" || /^\/memos\/[^/]+$/.test(location.pathname))) navigate("/");
    } catch (error) {
      setDraftError(`Nothing was saved. ${error instanceof Error ? error.message : "Could not organize this meeting."}`);
    } finally {
      preparingRef.current = false;
      setPreparing(false);
    }
  };
  if (!isMeetingMode) return null;
  if (isCollapsed)
    return (
      <aside
        className="noter-meeting fixed inset-y-0 right-0 z-50 flex w-14 flex-col items-center justify-between border-l border-border bg-card py-4"
        aria-label="Compact meeting assistant"
      >
        <span
          className={cn("size-2 rounded-full", meeting.isRecording ? "bg-destructive" : "bg-muted-foreground")}
          aria-label={meeting.isRecording ? "Recording" : "Paused"}
        />
        <div className="flex flex-col gap-3">
          <Button variant="ghost" size="icon" aria-label="Expand meeting assistant" onClick={() => void setCollapsed(false)}>
            <ChevronLeftIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={meeting.isRecording ? "Pause recording" : "Resume recording"}
            disabled={busy}
            onClick={() =>
              void (meeting.isRecording ? meeting.stopMeeting() : meeting.startMeeting()).catch((error) => setDraftError(error.message))
            }
          >
            {meeting.isRecording ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon" aria-label="Restore notes workspace" onClick={() => void exitMeetingMode()}>
            <Maximize2Icon className="size-4" />
          </Button>
        </div>
        <span className="text-[10px] tabular-nums">{time}</span>
      </aside>
    );
  return (
    <aside
      className="noter-meeting fixed inset-y-0 right-0 z-50 flex h-dvh w-full max-w-[440px] flex-col overflow-y-auto border-l border-border bg-card text-foreground"
      aria-label="Meeting assistant"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <span className={cn("size-2 rounded-full", meeting.isRecording ? "bg-destructive" : "bg-muted-foreground")} />
        <h2 className="flex-1 text-sm font-semibold">Noter meeting</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{time}</span>
        <Button variant="ghost" size="icon" aria-label="Collapse meeting assistant" onClick={() => void setCollapsed(true)}>
          <ChevronRightIcon className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Restore notes workspace" onClick={() => void exitMeetingMode()}>
          <Maximize2Icon className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Stop and close meeting"
          disabled={meeting.isFinishing || preparing}
          onClick={() =>
            void meeting
              .stopMeeting()
              .then(exitMeetingMode)
              .catch((error) => setDraftError(error.message))
          }
        >
          <XIcon className="size-4" />
        </Button>
      </header>
      <div className="shrink-0 space-y-3 border-b border-border p-4">
        {setCaptureMode && (
          <div className="space-y-2">
            <input
              aria-label="Meeting title"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={meetingTitle ?? "Meeting"}
              disabled={meeting.isRecording || busy || !!currentMeetingId}
              onChange={(event) => setMeetingTitle?.(event.target.value)}
            />
            <label className="flex items-center justify-between gap-2 text-xs">
              Capture
              <select
                aria-label="Meeting capture mode"
                className="rounded border border-border bg-background px-2 py-1.5"
                value={captureMode ?? "audio"}
                disabled={meeting.isRecording || busy}
                onChange={(event) => setCaptureMode(event.target.value as "audio" | "screen")}
              >
                <option value="audio">Audio only</option>
                <option value="screen">Screen + audio</option>
              </select>
            </label>
          </div>
        )}
        <div className="flex flex-wrap gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <MicIcon className="size-3.5" />
            Mic: {meeting.micChannelActive ? (meeting.microphoneActivity === "quiet" ? "quiet" : "on") : "off"}
          </span>
          <span className="flex items-center gap-1.5">
            <MonitorIcon className="size-3.5" />
            Shared audio: {meeting.clientChannelActive ? "on" : "off"}
          </span>
        </div>
        <details className="text-xs leading-5 text-muted-foreground">
          <summary className="cursor-pointer">Capture sources & speaker labels</summary>
          <p>
            Share your meeting tab or screen with audio enabled. Microphone and shared audio are transcribed separately. Let participants
            know you are recording.
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            Microphone identifies the input channel, not a verified speaker. Echo reduction filters matching shared-audio speech.
          </p>
        </details>
        {currentMeetingId && (
          <button
            type="button"
            className="text-xs underline"
            onClick={async () => {
              try {
                await meeting.stopMeeting();
                await flushTranscript?.();
                await exitMeetingMode();
                navigate(`/?meeting=${currentMeetingId}`);
              } catch (error) {
                setDraftError((error as Error).message);
              }
            }}
          >
            Open recording & transcript
          </button>
        )}
        {meeting.speakerStatus && (
          <p role="status" className="text-xs leading-5 text-muted-foreground">
            {meeting.speakerStatus}
          </p>
        )}
        <Button
          className="w-full"
          variant={meeting.isRecording ? "outline" : "default"}
          disabled={busy || preparing}
          onClick={() =>
            void (meeting.isRecording ? meeting.stopMeeting() : meeting.startMeeting()).catch((error) => setDraftError(error.message))
          }
        >
          {meeting.isRecording ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
          {meeting.isStarting
            ? "Choose audio sources…"
            : meeting.isFinishing
              ? "Finishing transcription…"
              : meeting.isRecording
                ? "Pause recording"
                : "Start recording"}
        </Button>
        {setCaptureMode && (
          <Button
            variant="ghost"
            size="sm"
            disabled={!meeting.isRecording}
            onClick={() => meeting.appendTranscript("[Note]", "Marked moment")}
          >
            Mark moment
          </Button>
        )}
        {(draftError || storageError || meeting.error) && (
          <p role="alert" className="text-xs leading-5 text-destructive">
            {draftError || storageError || meeting.error}
          </p>
        )}
      </div>
      <div
        className="flex shrink-0 border-b border-border px-4"
        role="tablist"
        aria-label="Meeting content"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? "notes" : event.key === "End" ? "transcript" : tab === "notes" ? "transcript" : "notes";
          setTab(next);
          event.currentTarget.querySelector<HTMLButtonElement>(`[data-meeting-tab="${next}"]`)?.focus();
        }}
      >
        {(["notes", "transcript"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            data-meeting-tab={value}
            onClick={() => setTab(value)}
            className={cn("px-4 py-3 text-xs", tab === value ? "font-semibold text-primary" : "text-muted-foreground")}
          >
            {value === "notes" ? "Organized notes" : `Transcript (${meeting.transcript.length})`}
          </button>
        ))}
      </div>
      {tab === "transcript" && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
          <span>{transcriptFollow.following ? "Following live transcript" : "Reading earlier transcript"}</span>
          <Button type="button" variant="ghost" size="sm" disabled={transcriptFollow.following} onClick={transcriptFollow.resume}>
            Jump to latest
          </Button>
        </div>
      )}
      <div
        ref={transcriptFollow.panelRef}
        onScroll={tab === "transcript" ? transcriptFollow.onScroll : undefined}
        className="min-h-24 flex-1 overflow-y-auto p-4"
        role="tabpanel"
        aria-label={tab === "transcript" ? "Live transcript" : "Organized meeting notes"}
        tabIndex={0}
      >
        {tab === "notes" ? (
          <div className="space-y-6">
            {meeting.isAnalyzing && (
              <p className="text-xs text-muted-foreground" role="status">
                Organizing the conversation…
              </p>
            )}
            {meeting.organizedMarkdown ? (
              <MemoViewContext.Provider value={MEETING_PREVIEW_CONTEXT}>
                <MemoContent content={meeting.organizedMarkdown} contentClassName="text-sm [&_h1]:text-lg [&_h2]:text-sm [&_h2]:mt-5" />
              </MemoViewContext.Provider>
            ) : (
              <p className="text-sm leading-6 text-muted-foreground">
                Important details, dates, decisions, and action items will appear here. Organize & review prepares an editable draft in your
                current note.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {!meeting.transcript.length && (
              <p className="text-sm leading-6 text-muted-foreground">
                Your conversation will appear here. Shared audio is labeled Client; microphone audio is labeled You.
              </p>
            )}
            {meeting.transcript.map((line) => (
              <div key={line.id}>
                <p className="mb-1 text-xs text-muted-foreground">
                  {displaySpeaker(line.speaker)} · {line.timestamp}
                </p>
                <p className="text-sm leading-6">{line.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
      <form
        className="flex shrink-0 gap-2 border-t border-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          handleAddManualLine();
        }}
      >
        <select
          aria-label="Transcript speaker"
          value={activeSpeaker}
          onChange={(event) => setActiveSpeaker(event.target.value as typeof activeSpeaker)}
          className="rounded border border-border bg-card px-1 text-xs"
        >
          <option value="[Client]">Shared audio</option>
          <option value="[You]">Microphone</option>
        </select>
        <input
          aria-label="Add transcript line"
          placeholder="Add a missed detail…"
          value={manualText}
          onChange={(event) => setManualText(event.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-card px-2 text-xs"
        />
        <Button type="submit" variant="ghost" size="icon" aria-label="Add transcript line" disabled={!manualText.trim()}>
          <PlusIcon className="size-4" />
        </Button>
      </form>
      <footer className="shrink-0 space-y-2 border-t border-border p-3">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={replaceCurrent}
            disabled={preparing || busy}
            onChange={(event) => setReplaceCurrent(event.target.checked)}
            className="size-4 accent-primary"
          />
          Replace current note text
        </label>
        <p className="text-xs leading-5 text-muted-foreground">
          {replaceCurrent ? "Replace the text in your current tab." : "Add below the text in your current tab."} Review the draft, then
          save.
        </p>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={preparing || busy || meeting.isAnalyzing || !meeting.transcript.length}
            onClick={() => void review()}
          >
            {preparing ? "Organizing full meeting…" : "Organize & review"}
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={meeting.organizedMarkdown ? "Copy organized notes" : "Copy transcript"}
            disabled={!meeting.transcript.length}
            onClick={() =>
              void navigator.clipboard.writeText(meeting.formatAsMarkdown()).then(
                () => toast.success("Notes copied"),
                () => toast.error("Could not copy notes"),
              )
            }
          >
            <CopyIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            disabled={busy || preparing}
            onClick={() => {
              if (
                window.confirm("Clear this meeting transcript and organized notes? Draft and save a note first if you need to keep them.")
              )
                void (newMeeting ? newMeeting().catch((error) => setDraftError(error.message)) : meeting.clearMeeting());
            }}
          >
            Clear
          </Button>
        </div>
      </footer>
    </aside>
  );
}
