import { Code, ConnectError } from "@connectrpc/connect";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, DownloadIcon, FolderOpenIcon, SearchIcon, SparklesIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { memoServiceClient } from "@/connect";
import { clock, type LibraryMeeting, type LibraryResponse, libraryRequest, matchingLines, sourceTime } from "@/lib/meeting-library";
import { invokeTauri, isTauriEnvironment } from "@/utils/tauri";
import { NotePreview } from "./NotePreview";
import { passageAtTime, revealPassage } from "./review-timeline";
import { useMeetingAnswer } from "./useMeetingAnswer";
import { useProgressiveMarkdown } from "./useProgressiveMarkdown";

function highlightedText(text: string, query: string) {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return text;
  const folded = text.toLocaleLowerCase();
  const pieces = [];
  let offset = 0;
  let found = folded.indexOf(term);
  while (found >= 0) {
    pieces.push(text.slice(offset, found));
    pieces.push(
      <mark key={found} className="rounded-sm bg-amber-200 px-0.5 text-slate-950">
        {text.slice(found, found + term.length)}
      </mark>,
    );
    offset = found + term.length;
    found = folded.indexOf(term, offset);
  }
  pieces.push(text.slice(offset));
  return pieces;
}

export function MeetingReview({
  meeting,
  library,
  initialTime = 0,
  initialView = initialTime > 0 ? "transcript" : "notes",
  onClose,
}: {
  meeting: LibraryMeeting;
  library: LibraryResponse;
  initialTime?: number;
  initialView?: "notes" | "transcript";
  onClose: () => void;
}) {
  const client = useQueryClient();
  const nativeFiles = library.desktop && isTauriEnvironment();
  const player = useRef<HTMLVideoElement>(null);
  const [partIndex, setPartIndex] = useState(() =>
    Math.max(
      0,
      meeting.parts.findIndex((part) => initialTime >= part.start && initialTime < part.end),
    ),
  );
  const [time, setTime] = useState(initialTime);
  const [tab, setTab] = useState<"notes" | "transcript" | "ai">(initialView);
  const [query, setQuery] = useState("");
  const [speaker, setSpeaker] = useState("");
  const [follow, setFollow] = useState(true);
  const [selectedSource, setSelectedSource] = useState<string>();
  const selectedTime = useRef<number | undefined>(undefined);
  const [draft, setDraft] = useState(meeting.draft);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState("");
  const assistant = useMeetingAnswer(meeting.id);
  const answer = assistant.answer.content;
  const reveal = useProgressiveMarkdown(answer, assistant.answer.revision);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const transcriptPanel = useRef<HTMLDivElement>(null);
  const passageRefs = useRef(new Map<string, HTMLButtonElement>());
  const savedDraft = useRef(meeting.draft);
  const latestDraft = useRef(draft);
  const latestDirty = useRef(dirty);
  latestDraft.current = draft;
  latestDirty.current = dirty;
  const draftWrites = useRef<Promise<void>>(Promise.resolve());
  const persistDraft = useCallback(
    (content: string) => {
      const pending = draftWrites.current
        .catch(() => undefined)
        .then(async () => {
          await libraryRequest(`/meetings/${meeting.id}`, "PATCH", { draft: content });
          savedDraft.current = content;
        });
      draftWrites.current = pending;
      return pending;
    },
    [meeting.id],
  );
  const savedNoteName = useRef(meeting.noteName);
  const pendingTime = useRef<number | null>(initialTime);
  const playAfterSeek = useRef(initialView === "transcript");
  const part = meeting.parts[partIndex];
  const speakers = [...new Set(meeting.transcript.map((line) => line.speaker))];
  const lines = matchingLines(meeting.transcript, query, speaker);
  const activeId = selectedSource || passageAtTime(meeting.transcript, time);
  useEffect(() => {
    if (!dirty) {
      setDraft(meeting.draft);
      savedDraft.current = meeting.draft;
    }
  }, [meeting.draft, dirty]);
  useEffect(() => {
    const passage = activeId ? passageRefs.current.get(activeId) : undefined;
    if (follow && !query && !speaker && tab === "transcript" && passage && transcriptPanel.current)
      revealPassage(transcriptPanel.current, passage);
  }, [activeId, follow, query, speaker, tab]);
  useEffect(() => {
    if (draft === savedDraft.current) return;
    const timer = window.setTimeout(() => {
      void persistDraft(draft).catch((error) => setError(error.message));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [draft, persistDraft]);
  useEffect(
    () => () => {
      if (latestDraft.current !== savedDraft.current) void persistDraft(latestDraft.current).catch(() => undefined);
    },
    [persistDraft],
  );
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  const seek = useCallback(
    (seconds: number, sourceId?: string) => {
      setSelectedSource(meeting.transcript.some((line) => line.id === sourceId) ? sourceId : undefined);
      selectedTime.current = seconds;
      setTab("transcript");
      setFollow(true);
      if (tab !== "transcript") {
        setQuery("");
        setSpeaker("");
      }
      if (!meeting.parts.length) {
        setTime(seconds);
        setNotice("Transcript passage selected. This meeting has no recording.");
        return;
      }
      if (meeting.duration > 0 && seconds > meeting.duration + 0.1) {
        setError("There is no recording at this transcript moment.");
        return;
      }
      const value = Math.min(Math.max(seconds, 0), meeting.duration || seconds);
      const index = meeting.parts.findIndex(
        (part, index) => value >= part.start && (value < part.end || index === meeting.parts.length - 1),
      );
      if (index < 0) {
        setError("There is no recording at this transcript moment.");
        return;
      }
      pendingTime.current = value;
      setTime(value);
      setTab("transcript");
      setFollow(true);
      playAfterSeek.current = true;
      if (index === partIndex && player.current) {
        player.current.currentTime = Math.max(0, value - meeting.parts[index].start);
        pendingTime.current = null;
        void player.current.play().catch(() => setNotice("Press Play to review this moment."));
      } else setPartIndex(index);
    },
    [meeting.duration, meeting.parts, meeting.transcript, partIndex, tab],
  );
  const previousInitial = useRef(initialTime);
  useEffect(() => {
    if (initialTime !== previousInitial.current) {
      previousInitial.current = initialTime;
      seek(initialTime);
    }
  }, [initialTime, seek]);
  const run = async (action: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(action);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (error) {
      setError(error instanceof Error ? error.message : "This action could not finish.");
    } finally {
      setBusy("");
    }
  };
  const organize = () =>
    run("Organizing…", async () => {
      const result = await libraryRequest<{ markdown: string }>(`/meetings/${meeting.id}/organize`, "POST", {});
      if (latestDirty.current && latestDraft.current.trim()) {
        assistant.present(result.markdown);
        setTab("ai");
        setNotice("AI draft is ready below. Your edited notes were kept; use Append to notes to add it.");
      } else {
        setDraft(result.markdown);
        setDirty(true);
        setEditing(false);
        setTab("notes");
      }
    });
  const save = () =>
    run("Saving…", async () => {
      const submitted = latestDraft.current;
      let name = savedNoteName.current || meeting.noteName;
      if (!name) {
        try {
          name = (await memoServiceClient.getMemo({ name: `memos/meeting-${meeting.id}` })).name;
        } catch (error) {
          if (!(error instanceof ConnectError && error.code === Code.NotFound)) throw error;
        }
      }
      const note = name
        ? await memoServiceClient.updateMemo({ memo: { name, content: submitted }, updateMask: { paths: ["content"] } })
        : await memoServiceClient.createMemo({ memoId: `meeting-${meeting.id}`, memo: { content: submitted } });
      savedNoteName.current = note.name;
      // Link before creating a second note on a retry if the local copy failed.
      await persistDraft(submitted);
      await libraryRequest("/notes", "POST", { name: note.name, meetingId: meeting.id });
      await client.invalidateQueries({ queryKey: ["memos"] });
      const changed = latestDraft.current !== submitted;
      if (changed) await persistDraft(latestDraft.current);
      setDirty(changed);
      setNotice(changed ? "Note saved. Your newer edits remain a draft." : "Note saved. The recording and transcript remain linked.");
    });
  return (
    <section className="meeting-review" role="tabpanel" id={`meeting-panel-${meeting.id}`} aria-labelledby={`tab-meeting-${meeting.id}`}>
      <header className="meeting-review-header">
        <Button variant="ghost" size="icon" aria-label="Back to notes" onClick={onClose}>
          <ArrowLeftIcon className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">{meeting.title}</h1>
          <p className="text-xs text-muted-foreground">
            {new Date(meeting.createdAt).toLocaleDateString()} · {clock(meeting.duration)} ·{" "}
            {meeting.status === "interrupted"
              ? "Interrupted · completed chunks retained"
              : meeting.status === "recording"
                ? "Recording in progress"
                : nativeFiles
                  ? "Saved on this device"
                  : "Stored in library"}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open folder"
          disabled={!nativeFiles}
          onClick={() => void invokeTauri("open_library_folder", { root: library.library.root, relative: meeting.path })}
        >
          <FolderOpenIcon className="size-4" />
          <span className="hidden sm:inline">Open folder</span>
        </Button>
      </header>
      <div className="meeting-review-body">
        <div className="meeting-player-pane">
          {part ? (
            <>
              <video
                key={part.id}
                ref={player}
                src={`/api/library/meetings/${meeting.id}/media/${part.id}`}
                controls
                playsInline
                preload="metadata"
                className={part.type.startsWith("audio/") ? "meeting-player audio-player" : "meeting-player"}
                onLoadedMetadata={() => {
                  if (pendingTime.current !== null && player.current) {
                    player.current.currentTime = Math.max(0, pendingTime.current - part.start);
                    pendingTime.current = null;
                  }
                  if (playAfterSeek.current && player.current) {
                    playAfterSeek.current = false;
                    void player.current.play().catch(() => setNotice("Press Play to review this moment."));
                  }
                }}
                onTimeUpdate={(event) => {
                  const seconds = part.start + event.currentTarget.currentTime;
                  setTime(seconds);
                  if (selectedSource && Math.abs(seconds - (selectedTime.current ?? seconds)) > 0.01) setSelectedSource(undefined);
                }}
                onPlay={() => {
                  setSelectedSource(undefined);
                  if (player.current) setTime(part.start + player.current.currentTime);
                }}
                onEnded={() => {
                  setSelectedSource(undefined);
                  if (partIndex + 1 < meeting.parts.length) {
                    pendingTime.current = meeting.parts[partIndex + 1].start;
                    setTime(meeting.parts[partIndex + 1].start);
                    playAfterSeek.current = true;
                    setPartIndex(partIndex + 1);
                  }
                }}
                onError={() =>
                  setError(
                    "Recording could not be opened. Use Open folder to check the file; the transcript and notes are still available.",
                  )
                }
              >
                <track
                  kind="captions"
                  label="Meeting transcript"
                  srcLang="en"
                  src={`/api/library/meetings/${meeting.id}/captions/${part.id}`}
                />
              </video>
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-xs text-muted-foreground">
                <span>
                  {clock(time)} / {clock(meeting.duration)}
                </span>
                {meeting.parts.length > 1 && (
                  <label>
                    Part{" "}
                    <select
                      aria-label="Recording part"
                      value={partIndex}
                      onChange={(event) => {
                        setSelectedSource(undefined);
                        setPartIndex(Number(event.target.value));
                        pendingTime.current = meeting.parts[Number(event.target.value)].start;
                        setTime(pendingTime.current);
                      }}
                    >
                      {meeting.parts.map((item, index) => (
                        <option key={item.id} value={index}>
                          {index + 1} · {clock(item.start)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <a
                  className="ml-auto flex items-center gap-1.5 text-foreground underline-offset-4 hover:underline"
                  href={`/api/library/meetings/${meeting.id}/media/${part.id}?download=1`}
                  download
                >
                  <DownloadIcon className="size-3.5" />
                  Export this {part.type.startsWith("audio/") ? "audio" : "video"} part
                </a>
              </div>
            </>
          ) : (
            <div className="p-8 text-sm text-muted-foreground">
              This meeting has notes and a transcript, but no screen or audio recording.
            </div>
          )}
          <div className="meeting-file-details">
            <label className="flex items-center gap-2">
              Folder
              <select
                aria-label="Meeting folder"
                value={meeting.folderId}
                disabled={!!busy || meeting.status === "recording"}
                onChange={(event) =>
                  void run("Moving…", async () => {
                    await libraryRequest(`/meetings/${meeting.id}`, "PATCH", { folderId: event.target.value });
                  })
                }
              >
                <option value="">Inbox</option>
                {library.library.folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.title}
                  </option>
                ))}
              </select>
            </label>
            {meeting.noteName && (
              <Link to={`/${meeting.noteName}`} className="underline">
                Open saved note
              </Link>
            )}
            {meeting.status === "interrupted" && part && !part.complete && (
              <Button
                variant="outline"
                size="sm"
                disabled={!!busy}
                onClick={() =>
                  void run("Recovering…", async () => {
                    await libraryRequest(`/meetings/${meeting.id}/parts/${part.id}/finish`, "POST", {
                      duration: Math.max(0, part.end - part.start),
                    });
                  })
                }
              >
                Recover completed chunks
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={!!busy || meeting.status === "recording"}
              onClick={() =>
                void run("Updating…", async () => {
                  await libraryRequest(`/meetings/${meeting.id}`, "PATCH", { trashed: !meeting.trashed });
                })
              }
            >
              {meeting.trashed ? "Restore meeting" : "Archive meeting"}
            </Button>
          </div>
          <p className="px-4 py-3 text-xs text-muted-foreground break-all">
            {library.library.root}\{meeting.path}
          </p>
        </div>
        <aside className="meeting-review-panel" aria-label="Meeting notes and transcript">
          <div
            className="meeting-review-tabs"
            role="tablist"
            aria-label="Review content"
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
              const current = tabs.indexOf(event.target as HTMLButtonElement);
              if (current < 0) return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
              tabs[next]?.focus();
              tabs[next]?.click();
            }}
          >
            {(["notes", "transcript", "ai"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                id={`review-${value}`}
                aria-controls="meeting-review-content"
                aria-selected={tab === value}
                tabIndex={tab === value ? 0 : -1}
                onClick={() => setTab(value)}
              >
                {value === "ai" ? "Ask AI" : value === "notes" ? "Notes" : "Transcript"}
              </button>
            ))}
          </div>
          {(error || notice) && (
            <p className="mx-4 mt-3 text-xs leading-5" role={error ? "alert" : "status"}>
              {error || notice}
            </p>
          )}
          <div id="meeting-review-content" role="tabpanel" aria-labelledby={`review-${tab}`} className="meeting-review-content">
            {tab === "notes" && (
              <>
                <div className="flex flex-wrap gap-2 p-4">
                  <Button variant="outline" size="sm" disabled={!!busy || !meeting.transcript.length} onClick={() => void organize()}>
                    <SparklesIcon className="size-3.5" />
                    {busy === "Organizing…" ? busy : "Organize notes"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(!editing)}>
                    {editing ? "Preview" : "Edit draft"}
                  </Button>
                </div>
                {editing ? (
                  <textarea
                    className="meeting-note-editor"
                    aria-label="Meeting note draft"
                    value={draft}
                    onChange={(event) => {
                      latestDraft.current = event.target.value;
                      latestDirty.current = true;
                      setDraft(event.target.value);
                      setDirty(true);
                      setNotice("");
                    }}
                    placeholder="Write a note, or organize the transcript with AI…"
                  />
                ) : (
                  <div
                    className="meeting-note-preview"
                    onClickCapture={(event) => {
                      const link = (event.target as HTMLElement).closest("a");
                      if (link) {
                        const seconds = sourceTime(link.href, meeting.id);
                        if (seconds !== null) {
                          event.preventDefault();
                          event.stopPropagation();
                          seek(seconds, new URL(link.href).hash.replace(/^#segment-/, ""));
                        }
                      }
                    }}
                  >
                    {draft ? (
                      <NotePreview content={draft} />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Organize this transcript into an editable draft with decisions, tasks, dates, and links to the recording.
                      </p>
                    )}
                  </div>
                )}
                <footer className="meeting-note-footer">
                  <span className="text-xs text-muted-foreground">
                    {dirty ? "Draft · review before saving" : meeting.noteName ? "Linked saved note" : "No note saved yet"}
                  </span>
                  <Button size="sm" disabled={!!busy || !draft.trim()} onClick={() => void save()}>
                    {busy === "Saving…" ? busy : meeting.noteName ? "Update note" : "Save note"}
                  </Button>
                </footer>
              </>
            )}
            {tab === "transcript" && (
              <>
                <div className="space-y-3 border-b border-border p-4">
                  <label className="flex items-center gap-2">
                    <SearchIcon className="size-4" />
                    <input
                      aria-label="Search transcript"
                      placeholder="Find a detail in this meeting…"
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setFollow(false);
                      }}
                      className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                    />
                  </label>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <select
                      aria-label="Filter transcript speaker"
                      value={speaker}
                      onChange={(event) => {
                        setSpeaker(event.target.value);
                        setFollow(false);
                      }}
                    >
                      <option value="">All speakers</option>
                      {speakers.map((speaker) => (
                        <option key={speaker}>{speaker}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="ml-auto underline"
                      aria-pressed={follow}
                      onClick={() => {
                        setFollow(!follow);
                        if (!follow) {
                          setQuery("");
                          setSpeaker("");
                          setSelectedSource(undefined);
                        }
                      }}
                    >
                      Follow playback: {follow ? "on" : "off"}
                    </button>
                    <span role="status">
                      {lines.length} {lines.length === 1 ? "passage" : "passages"}
                    </span>
                  </div>
                </div>
                <div
                  ref={transcriptPanel}
                  className="meeting-transcript-lines"
                  aria-label="Playback transcript"
                  tabIndex={0}
                  onWheel={() => setFollow(false)}
                  onTouchMove={() => setFollow(false)}
                  onPointerDown={(event) => {
                    if (event.target === event.currentTarget) setFollow(false);
                  }}
                  onKeyDown={(event) => {
                    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) setFollow(false);
                  }}
                >
                  {lines.map((line) => (
                    <button
                      key={line.id}
                      type="button"
                      data-line={line.id}
                      ref={(element) => {
                        if (element) passageRefs.current.set(line.id, element);
                        else passageRefs.current.delete(line.id);
                      }}
                      aria-current={activeId === line.id ? "true" : undefined}
                      onClick={() => seek(line.start, line.id)}
                      className={`meeting-transcript-line ${activeId === line.id ? "is-playing" : ""}`}
                    >
                      <span className="mb-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>
                          {clock(line.start)}
                          {line.approximate ? " · approximate" : ""}
                        </span>
                        <span>{line.speaker}</span>
                      </span>
                      <span className="text-sm leading-6">{highlightedText(line.text, query)}</span>
                    </button>
                  ))}
                  {!lines.length && (
                    <p className="p-4 text-sm text-muted-foreground">
                      {query ? "No passages match your search." : "No transcript passages yet."}
                    </p>
                  )}
                </div>
              </>
            )}
            {tab === "ai" && (
              <div className="meeting-ai">
                <p className="mb-4 text-sm leading-6 text-muted-foreground">Ask about the conversation, decisions, or next steps.</p>
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void assistant.ask(question);
                  }}
                >
                  <input
                    className="min-w-0 flex-1 rounded-md border border-border bg-background p-2 text-sm"
                    aria-label="Question about this meeting"
                    placeholder="What changed about the deadline?"
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                  />
                  <Button type="submit" size="sm" disabled={!!busy || assistant.pending || !question.trim() || !meeting.transcript.length}>
                    Ask
                  </Button>
                  {assistant.pending && (
                    <Button type="button" variant="ghost" size="sm" onClick={assistant.cancel}>
                      Cancel
                    </Button>
                  )}
                </form>
                {assistant.pending && (
                  <p role="status" className="py-4 text-sm text-muted-foreground">
                    Thinking about your meeting…
                  </p>
                )}
                {assistant.error && (
                  <p role="alert" className="py-4 text-sm text-destructive">
                    {assistant.error}
                  </p>
                )}
                <div
                  className="meeting-answer-scroll"
                  onClickCapture={(event) => {
                    const link = (event.target as HTMLElement).closest("a");
                    if (link) {
                      const seconds = sourceTime(link.href, meeting.id);
                      if (seconds !== null) {
                        event.preventDefault();
                        event.stopPropagation();
                        seek(seconds, new URL(link.href).hash.replace(/^#segment-/, ""));
                      }
                    }
                  }}
                >
                  {!!assistant.answer.question && <p className="meeting-question">{assistant.answer.question}</p>}
                  {answer && (
                    <div className="meeting-answer" aria-label="Meeting AI answer" aria-busy={!reveal.complete}>
                      <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>{reveal.complete ? "Answer" : "Revealing answer…"}</span>
                        {!reveal.complete && (
                          <Button type="button" variant="ghost" size="sm" onClick={reveal.showAll}>
                            Show full answer
                          </Button>
                        )}
                      </div>
                      <NotePreview content={reveal.text} contentClassName="meeting-answer-prose" />
                    </div>
                  )}
                </div>
                {answer && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    disabled={!reveal.complete || assistant.pending}
                    onClick={() => {
                      setDraft((draft) => `${draft.trim()}\n\n${answer}`.trim());
                      setDirty(true);
                      setTab("notes");
                    }}
                  >
                    Append to note draft
                  </Button>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
