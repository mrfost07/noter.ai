import { HeadphonesIcon, LoaderCircleIcon, Maximize2Icon, MicIcon, PlusIcon, SparklesIcon, SquareIcon, XIcon } from "lucide-react";
import { type FC, useState } from "react";
import { formatAudioTime } from "@/components/MemoMetadata/Attachment/attachmentHelpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMeetingCompanion } from "@/contexts/MeetingCompanionContext";
import { useTranscriptFollow } from "@/hooks/useTranscriptFollow";
import { cn } from "@/lib/utils";
import { useMeetingNoteTaker } from "../hooks/useMeetingNoteTaker";
import type { SpeakerLabel } from "../services/websocketSTT";
import { displaySpeaker } from "../utils/meetingSpeakers";

export interface MeetingNotePanelProps {
  memoName?: string;
  onInsertNotes: (markdown: string) => void;
  onSyncMarkdownToEditor?: (markdown: string) => void;
  onSyncRelatedMemos?: (memoNames: string[]) => void;
  onClose: () => void;
}

export const MeetingNotePanel: FC<MeetingNotePanelProps> = ({ memoName, onInsertNotes, onSyncMarkdownToEditor, onClose }) => {
  const {
    isRecording,
    isAnalyzing,
    elapsedSeconds,
    clientChannelActive,
    micChannelActive,
    transcript,
    notes,
    statusSummary,
    error,
    startMeeting,
    stopMeeting,
    appendTranscript,
    runAnalysisNow,
  } = useMeetingNoteTaker({
    memoName,
  });

  const { enterMeetingMode } = useMeetingCompanion();
  const transcriptFollow = useTranscriptFollow(transcript);

  const [manualSpeaker, setManualSpeaker] = useState<SpeakerLabel>("[Client]");
  const [manualText, setManualText] = useState("");
  const [preparingDraft, setPreparingDraft] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const handleAddManualLine = () => {
    const trimmed = manualText.trim();
    if (!trimmed) return;
    appendTranscript(manualSpeaker, trimmed);
    setManualText("");
  };

  const handleFinishAndInsert = async () => {
    setPreparingDraft(true);
    setDraftError(null);
    try {
      await stopMeeting();
      const result = await runAnalysisNow({ fullTranscript: true });
      if (!result.markdown?.trim()) throw new Error("AI returned no organized notes. Retry before drafting.");
      (onSyncMarkdownToEditor ?? onInsertNotes)(result.markdown);
      onClose();
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "Could not organize the meeting. Your transcript is still available.");
    } finally {
      setPreparingDraft(false);
    }
  };

  const hasContent =
    transcript.length > 0 ||
    notes.tasksForYou.length > 0 ||
    notes.midMeetingChanges?.length > 0 ||
    notes.clientDecisions.length > 0 ||
    notes.crucialInfo.length > 0 ||
    notes.followUpQuestions.length > 0;

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 dark:bg-muted/20">
      {/* Compact recorder bar matching AudioRecorderPanel.tsx */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {isAnalyzing ? (
            <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            <HeadphonesIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          )}

          <span className="text-xs font-medium text-foreground">{isRecording ? "Meeting Note Taker" : "AI Meeting Notes"}</span>

          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{formatAudioTime(elapsedSeconds)}</span>

          <span
            className={cn(
              "rounded-md border border-border px-1.5 py-0.5 font-mono text-xs",
              clientChannelActive ? "bg-background text-foreground" : "bg-muted text-muted-foreground",
            )}
          >
            Shared audio
          </span>
          <span
            className={cn(
              "rounded-md border border-border px-1.5 py-0.5 font-mono text-xs",
              micChannelActive ? "bg-background text-foreground" : "bg-muted text-muted-foreground",
            )}
          >
            Microphone
          </span>

          {(isAnalyzing || statusSummary) && (
            <span className="truncate text-xs text-muted-foreground">{isAnalyzing ? "Updating Tasks & Decisions..." : statusSummary}</span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1 border-s border-border/60 ps-2">
          {!isRecording ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void startMeeting()}>
              <MicIcon className="mr-1.5 size-3.5" />
              Start Dual-Channel
            </Button>
          ) : (
            <Button type="button" variant="destructive" size="sm" onClick={stopMeeting}>
              <SquareIcon className="mr-1.5 size-3.5" />
              Stop Capture
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void runAnalysisNow().catch(() => undefined)}
            disabled={isAnalyzing || transcript.length === 0}
          >
            <SparklesIcon className="mr-1.5 size-3.5" />
            Analyze Now
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              onClose();
              void enterMeetingMode();
            }}
            title="Dock as floating side companion for Zoom / Meet / Slack"
          >
            <Maximize2Icon className="mr-1.5 size-3.5" />
            Companion Mode
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleFinishAndInsert}
            disabled={!hasContent || isAnalyzing || preparingDraft}
          >
            {preparingDraft ? "Organizing full meeting…" : "Organize & draft"}
          </Button>

          <Button type="button" variant="ghost" size="icon" className="rounded-full" onClick={onClose} aria-label="Close meeting notes">
            <XIcon className="size-4" />
          </Button>
        </div>
      </div>

      {(draftError || error) && (
        <p role="alert" className="text-xs text-destructive">
          {draftError || error}
        </p>
      )}

      {/* Speaker utterance input */}
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 font-mono text-xs text-foreground"
          onClick={() => setManualSpeaker((prev) => (prev === "[Client]" ? "[You]" : "[Client]"))}
          title="Toggle speaker tag"
        >
          {displaySpeaker(manualSpeaker)}
        </Button>
        <Input
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAddManualLine();
            }
          }}
          placeholder={`Add a ${displaySpeaker(manualSpeaker)} line…`}
          className="h-8 text-xs"
        />
        <Button type="button" size="sm" variant="outline" onClick={handleAddManualLine} disabled={!manualText.trim()}>
          <PlusIcon className="size-3.5" />
        </Button>
      </div>

      {/* Live Transcript + 4 Structured AI Lists */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div className="flex flex-col rounded-md border border-border bg-background text-xs">
          <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1 text-muted-foreground">
            <span>Live transcript · shared audio & microphone</span>
            <Button type="button" variant="ghost" size="sm" disabled={transcriptFollow.following} onClick={transcriptFollow.resume}>
              Latest
            </Button>
          </div>
          <div
            ref={transcriptFollow.panelRef}
            onScroll={transcriptFollow.onScroll}
            className="flex max-h-44 flex-col gap-1 overflow-y-auto p-2"
          >
            {transcript.length === 0 ? (
              <p className="text-muted-foreground">
                Click "Start Dual-Channel" and share your meeting tab/window audio, or add speaker lines above.
              </p>
            ) : (
              transcript.map((line) => (
                <div key={line.id} className="leading-relaxed">
                  <span className="font-mono text-xs text-muted-foreground">[{line.timestamp}] </span>
                  <span className="font-mono text-xs font-medium text-foreground">{displaySpeaker(line.speaker)}: </span>
                  <span className="text-foreground">{line.text}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="grid max-h-44 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
          <NoteCard title="Action items" items={notes.tasksForYou} emptyText="No action items yet" />
          <NoteCard title="Decisions" items={notes.clientDecisions} emptyText="No decisions yet" />
          <NoteCard title="Key details" items={notes.crucialInfo} emptyText="No specs/dates yet" />
          <NoteCard title="Open questions" items={notes.followUpQuestions} emptyText="No questions yet" />
        </div>
      </div>
    </div>
  );
};

const NoteCard: FC<{ title: string; items: string[]; emptyText: string }> = ({ title, items, emptyText }) => (
  <div className="flex flex-col gap-1 rounded-md border border-border bg-background p-2 text-xs">
    <div className="font-medium text-foreground">{title}</div>
    {items.length === 0 ? (
      <span className="text-muted-foreground">{emptyText}</span>
    ) : (
      <ul className="list-disc space-y-0.5 pl-4">
        {items.map((item, idx) => (
          <li key={idx} className="text-foreground">
            {item}
          </li>
        ))}
      </ul>
    )}
  </div>
);
