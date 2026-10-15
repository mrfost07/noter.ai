import { FileTextIcon, HeadphonesIcon, PanelLeftIcon, PlusIcon, SettingsIcon, SparklesIcon, XIcon } from "lucide-react";

import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import AgentSheet from "@/components/AgentSheet/AgentSheet";
import { LibrarySidebar } from "@/components/MeetingLibrary/LibrarySidebar";
import { MeetingReview } from "@/components/MeetingLibrary/MeetingReview";
import { NotePreview } from "@/components/MeetingLibrary/NotePreview";
import MemoActionMenu from "@/components/MemoActionMenu";
import MemoEditor from "@/components/MemoEditor";
import { cacheService } from "@/components/MemoEditor/services/cacheService";
import NoterLogo from "@/components/NoterLogo";
import { Button } from "@/components/ui/button";
import { type MeetingDraft, useMeetingCompanion } from "@/contexts/MeetingCompanionContext";
import { NewMemoProvider } from "@/contexts/NewMemoContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useLibrary } from "@/hooks/useLibraryQueries";
import { useMemoFilters } from "@/hooks/useMemoFilters";
import { useInfiniteMemos, useMemo as useNote } from "@/hooks/useMemoQueries";
import { combineCELFilters } from "@/lib/cel-filter";
import { type LibraryMeeting, libraryRequest } from "@/lib/meeting-library";
import { loadWorkspace, type NoteTab, saveWorkspace } from "@/lib/noter-workspace";
import { cn } from "@/lib/utils";
import { State } from "@/types/proto/api/common_pb";

import type { Memo } from "@/types/proto/api/memo_service_pb";

import "./noter.css";

const titleOf = (content: string) =>
  content
    .split("\n")
    .find((line) => line.trim())
    ?.replace(/^#+\s*/, "")
    .slice(0, 80) || "Untitled note";

function NoteDocument({
  tab,
  active,
  incomingDraft,
  onDraftApplied,
  onSaving,
  onContent,
  onDiscard,
  onDirty,
  onSaved,
}: {
  tab: NoteTab;
  active: boolean;
  incomingDraft?: MeetingDraft | null;
  onDraftApplied: (id: string) => void;
  onSaving: (id: string, saving: boolean) => void;
  onContent: (id: string, content: string) => void;
  onDiscard: (id: string, discard: (() => void) | undefined) => void;
  onDirty: (id: string, dirty: boolean) => void;
  onSaved: (id: string, name: string) => void;
}) {
  const { data: note, isPending, error, refetch, isUnavailable } = useNote(tab.name ?? "", { enabled: !!tab.name });
  const [preview, setPreview] = useState(false);
  const [previewContent, setPreviewContent] = useState<string | undefined>(undefined);
  const navigate = useNavigate();

  const discardReady = useCallback((discard: (() => void) | undefined) => onDiscard(tab.id, discard), [tab.id, onDiscard]);
  const changed = useCallback(
    (content: string) => {
      setPreviewContent(content);
      onContent(tab.id, content);
    },
    [tab.id, onContent],
  );
  const saving = useCallback((value: boolean) => onSaving(tab.id, value), [tab.id, onSaving]);
  const dirty = useCallback((value: boolean) => onDirty(tab.id, value), [tab.id, onDirty]);

  if (tab.name && isPending)
    return (
      <p className="p-6 text-sm text-muted-foreground" role="status">
        Opening note…
      </p>
    );

  if (tab.name && (error || isUnavailable))
    return (
      <div className="p-6 text-sm" role="alert">
        <p>{isUnavailable ? "This note is no longer available." : "Could not open this note."}</p>
        <Button variant="outline" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );

  return (
    <div className="flex min-h-full flex-col">
      {note && (
        <div className="flex items-center justify-between border-b border-border px-6 py-1 text-xs text-muted-foreground">
          <span>{note.state === State.ARCHIVED ? "Archived note" : note.pinned ? "Pinned note" : "Note"}</span>
          <fieldset disabled={tab.dirty || tab.saving} title={tab.dirty ? "Save your changes before organizing this note" : undefined}>
            <MemoActionMenu memo={note} documentMode />
          </fieldset>
        </div>
      )}
      <div className="flex gap-2 border-b border-border px-6 py-2">
        <Button variant={preview ? "ghost" : "secondary"} size="sm" aria-pressed={!preview} onClick={() => setPreview(false)}>
          Edit note
        </Button>
        <Button variant={preview ? "secondary" : "ghost"} size="sm" aria-pressed={preview} onClick={() => setPreview(true)}>
          Preview note
        </Button>
      </div>
      {preview && (
        <div
          className="meeting-note-preview pt-6"
          onClickCapture={(event) => {
            const link = (event.target as HTMLElement).closest("a");
            if (!link) return;
            const url = new URL(link.href);
            if (url.origin === window.location.origin && url.searchParams.has("meeting")) {
              event.preventDefault();
              event.stopPropagation();
              navigate(url.pathname + url.search + url.hash);
            }
          }}
        >
          <NotePreview content={previewContent ?? note?.content ?? ""} />
        </div>
      )}
      <div hidden={preview}>
        <MemoEditor
          key={tab.name ?? tab.id}
          memo={note}
          cacheKey={`noter-${tab.id}`}
          documentMode
          incomingDraft={incomingDraft}
          onDraftApplied={onDraftApplied}
          autoFocus={active && !preview}
          onSavingChange={saving}
          onDocumentChange={changed}
          onDiscardDraftReady={discardReady}
          placeholder="Give this note a title, then start writing…"
          onDirtyChange={dirty}
          onConfirm={(name) => onSaved(tab.id, name)}
          className="flex-1"
        />
      </div>
    </div>
  );
}

export default function Home({ archived = false }: { archived?: boolean }) {
  const libraryQuery = useLibrary();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedFolder, setSelectedFolder] = useState("*");
  const selectedMeetingId = searchParams.get("meeting");
  const selectedMeeting = libraryQuery.data?.library.meetings.find((meeting) => meeting.id === selectedMeetingId);
  const openMeeting = (meeting: LibraryMeeting, time?: number) => {
    setSearchParams({ meeting: meeting.id, t: String(time ?? 0), ...(time !== undefined ? { view: "transcript" } : {}) });
    if (window.innerWidth < 1000) setLibraryOpen(false);
  };
  const { uid } = useParams();

  const user = useCurrentUser();

  const [initialWorkspace] = useState(() =>
    loadWorkspace(`${user?.name ?? ""}${archived ? ":archive" : ""}`, uid ? `memos/${uid}` : undefined),
  );
  const [tabs, setTabs] = useState<NoteTab[]>(initialWorkspace.tabs);
  const [activeId, setActiveId] = useState(initialWorkspace.activeId);
  const [libraryOpen, setLibraryOpen] = useState(() => window.innerWidth >= 760);
  const routeNoteRef = useRef(uid);
  const discardersRef = useRef(new Map<string, () => void>());
  const setDiscarder = useCallback((id: string, discard: (() => void) | undefined) => {
    if (discard) discardersRef.current.set(id, discard);
    else discardersRef.current.delete(id);
  }, []);
  const documentContentRef = useRef(new Map<string, string>());
  const [draftRevision, setDraftRevision] = useState(0);
  const setDocumentContent = useCallback((id: string, content: string) => {
    documentContentRef.current.set(id, content);
    setDraftRevision((revision) => revision + 1);
    const title = titleOf(content);
    setTabs((current) =>
      current.some((tab) => tab.id === id && tab.title !== title)
        ? current.map((tab) => (tab.id === id ? { ...tab, title } : tab))
        : current,
    );
  }, []);
  const recoveredFor = useRef("");
  useEffect(() => {
    if (!user || !libraryQuery.data || recoveredFor.current === user.name) return;
    recoveredFor.current = user.name;
    const drafts = libraryQuery.data.library.drafts ?? [];
    const remount = new Set<string>();
    for (const draft of drafts) {
      const key = cacheService.key(user.name, `noter-${draft.id}`);
      if (!cacheService.load(key) && !tabSnapshot.current.find((tab) => tab.id === draft.id)?.dirty) {
        cacheService.saveNow(key, { content: draft.content, attachments: [] });
        remount.add(draft.id);
      }
    }
    if (drafts.length)
      setTabs((tabs) => [
        ...tabs.map((tab) => (remount.has(tab.id) ? { ...tab, recoveryToken: (tab.recoveryToken ?? 0) + 1 } : tab)),
        ...drafts
          .filter((draft) => !tabs.some((tab) => tab.id === draft.id))
          .map((draft) => ({
            id: draft.id,
            name: draft.name,
            title: draft.title,
            dirty: true,
            folderId: draft.folderId,
            meetingId: draft.meetingId,
          })),
      ]);
  }, [libraryQuery.data, user]);
  useEffect(() => {
    if (!user || !draftRevision) return;
    const timer = window.setTimeout(() => {
      for (const tab of tabs) {
        const content = documentContentRef.current.get(tab.id);
        if (tab.dirty && content !== undefined)
          void libraryRequest("/drafts", "POST", {
            id: tab.id,
            title: tab.title,
            content,
            name: tab.name,
            folderId: tab.folderId,
            meetingId: tab.meetingId,
          }).catch((error) => toast.error(`Draft recovery could not be written: ${error.message}`));
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [draftRevision, tabs, user]);
  useEffect(() => {
    if (user) saveWorkspace(`${user.name}${archived ? ":archive" : ""}`, tabs, activeId);
  }, [user, archived, tabs, activeId]);
  useEffect(() => {
    if (!uid || routeNoteRef.current === uid) return;
    routeNoteRef.current = uid;
    const name = `memos/${uid}`;
    const existing = tabs.find((tab) => tab.name === name);
    if (existing) setActiveId(existing.id);
    else {
      setTabs((current) => [...current, { id: name, name, title: "Opening note…", dirty: false }]);
      setActiveId(name);
    }
  }, [uid, tabs]);

  const [assistantOpen, setAssistantOpen] = useState(false);

  const [search, setSearch] = useState("");

  const [query, setQuery] = useState("");

  const { enterMeetingMode, meetingTaker, pendingDraft, consumeDraft, requestDraft } = useMeetingCompanion();

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const scopeFilter = useMemoFilters({ includePinned: true });
  const notes = useInfiniteMemos(
    {
      pageSize: 40,
      state: archived ? State.ARCHIVED : State.NORMAL,
      orderBy: "pinned desc, update_time desc",
      filter: combineCELFilters(scopeFilter, query ? `content.contains(${JSON.stringify(query)})` : undefined),
    },
    { enabled: !!user },
  );

  const allNotes = notes.data?.pages.flatMap((page) => page.memos) ?? [];

  const activeTab = tabs.find((tab) => tab.id === activeId);

  const hasDirty = tabs.some((tab) => tab.dirty);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (hasDirty || meetingTaker.isRecording) {
        event.preventDefault();
        event.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", beforeUnload);

    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [hasDirty, meetingTaker.isRecording]);

  const setDirty = useCallback(
    (id: string, dirty: boolean) =>
      setTabs((current) => current.map((tab) => (tab.id === id && tab.dirty !== dirty ? { ...tab, dirty } : tab))),
    [],
  );

  const setSaving = useCallback(
    (id: string, saving: boolean) =>
      setTabs((current) =>
        current.some((tab) => tab.id === id && tab.saving !== saving)
          ? current.map((tab) => (tab.id === id ? { ...tab, saving } : tab))
          : current,
      ),
    [],
  );
  const tabSnapshot = useRef(tabs);
  tabSnapshot.current = tabs;
  const onSaved = useCallback((id: string, name: string) => {
    const tab = tabSnapshot.current.find((tab) => tab.id === id);
    setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, name, dirty: false } : tab)));
    void libraryRequest(`/drafts/${encodeURIComponent(id)}`, "DELETE").catch(() => undefined);
    void libraryRequest("/notes", "POST", {
      name,
      ...(tab?.folderId !== undefined ? { folderId: tab.folderId } : {}),
      ...(tab?.meetingId ? { meetingId: tab.meetingId } : {}),
    }).catch((error) => toast.error(`Note saved; local copy needs attention: ${error.message}`));
  }, []);
  const draftApplied = useCallback(
    (id: string) => {
      if (pendingDraft?.meetingId)
        setTabs((tabs) => tabs.map((tab) => (tab.id === activeId ? { ...tab, meetingId: pendingDraft.meetingId } : tab)));
      consumeDraft(id);
    },
    [pendingDraft, activeId, consumeDraft],
  );

  const openNote = (note: Memo) => {
    setSearchParams({});
    const existing = tabs.find((tab) => tab.name === note.name);

    if (existing) setActiveId(existing.id);
    else {
      setTabs((current) => [...current, { id: note.name, name: note.name, title: titleOf(note.content), dirty: false }]);
      setActiveId(note.name);
    }

    if (window.innerWidth < 760) setLibraryOpen(false);
  };

  const newNote = () => {
    const id = crypto.randomUUID();
    setSearchParams({});
    setTabs((current) => [
      ...current,
      { id, title: "Untitled note", dirty: false, folderId: selectedFolder === "*" ? "" : selectedFolder },
    ]);
    setActiveId(id);
  };

  const closeTab = (tab: NoteTab) => {
    if (tab.saving) return;
    if (tab.dirty && !window.confirm("Discard unsaved changes and close this note?")) return;
    void libraryRequest(`/drafts/${encodeURIComponent(tab.id)}`, "DELETE").catch((error) => toast.error(error.message));

    discardersRef.current.get(tab.id)?.();
    cacheService.clear(cacheService.key(user?.name ?? "", `noter-${tab.id}`));
    const remaining = tabs.filter((item) => item.id !== tab.id);

    if (!remaining.length) {
      const id = crypto.randomUUID();
      setTabs([{ id, title: "Untitled note", dirty: false }]);
      setActiveId(id);
    } else {
      setTabs(remaining);
      if (activeId === tab.id) setActiveId(remaining[remaining.length - 1].id);
    }
  };

  const tabTitle = (tab: NoteTab) => {
    const note = allNotes.find((item) => item.name === tab.name);
    return note ? titleOf(note.content) : tab.title;
  };

  return (
    <NewMemoProvider>
      <div className="noter-workspace">
        <header className="noter-titlebar">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle notes list"
            aria-pressed={libraryOpen}
            onClick={() => setLibraryOpen(!libraryOpen)}
          >
            <PanelLeftIcon className="size-4" />
          </Button>

          <NoterLogo compact size="header" className="h-6 w-auto" />

          <span className="noter-titlebar-caption">A little space to think.</span>

          <div className="ml-auto flex items-center gap-1">
            <Button
              variant={meetingTaker.isRecording ? "default" : "outline"}
              size="sm"
              aria-label={meetingTaker.transcript?.length ? "Review meeting" : "Start meeting"}
              onClick={() => void enterMeetingMode()}
            >
              <HeadphonesIcon className="size-4" />
              <span className="hidden sm:inline">
                {meetingTaker.isRecording ? "Meeting in progress" : meetingTaker.transcript?.length ? "Review meeting" : "Start meeting"}
              </span>
            </Button>

            <Button
              variant={assistantOpen ? "secondary" : "ghost"}
              size="sm"
              aria-label="Toggle AI assistant"
              aria-pressed={assistantOpen}
              onClick={() => setAssistantOpen(!assistantOpen)}
            >
              <SparklesIcon className="size-4" />
              <span className="hidden sm:inline">Assistant</span>
            </Button>

            <Link to="/setting#ai" aria-label="AI and transcription settings" className="noter-icon-link">
              <SettingsIcon className="size-4" />
            </Link>
          </div>
        </header>

        <div className="noter-body">
          {libraryOpen && (
            <LibrarySidebar
              hideItems={!!selectedMeetingId}
              onBrowse={() => setSearchParams({})}
              library={libraryQuery.data}
              error={libraryQuery.error?.message || (notes.isError ? "Notes could not be loaded." : undefined)}
              loading={notes.isPending || libraryQuery.isPending}
              notes={allNotes}
              tabs={tabs}
              activeName={activeTab?.name}
              search={search}
              onSearch={setSearch}
              onNote={openNote}
              onDraft={(id) => {
                setActiveId(id);
                setSearchParams({});
              }}
              onMeeting={openMeeting}
              newNote={newNote}
              folder={selectedFolder}
              onFolder={(folder) => {
                setSelectedFolder(folder);
                setSearchParams({});
              }}
              archived={archived}
              onRetry={() => {
                void notes.refetch();
                void libraryQuery.refetch();
              }}
              hasMore={notes.hasNextPage}
              loadMore={() => void notes.fetchNextPage()}
            />
          )}

          <section className="noter-editor-pane" aria-label="Note editor">
            <div
              className="noter-tabs"
              role="tablist"
              aria-label="Open notes"
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
                const index = items.indexOf(event.target as HTMLButtonElement);
                if (index < 0) return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? items.length - 1
                      : (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
                items[next]?.focus();
                items[next]?.click();
              }}
            >
              {tabs.map((tab) => (
                <div className={cn("noter-tab", activeId === tab.id && !selectedMeetingId && "is-active")} key={tab.id}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeId === tab.id && !selectedMeetingId}
                    tabIndex={activeId === tab.id && !selectedMeetingId ? 0 : -1}
                    aria-controls={`panel-${tab.id}`}
                    id={`tab-${tab.id}`}
                    onClick={() => {
                      setActiveId(tab.id);
                      setSearchParams({});
                    }}
                  >
                    <FileTextIcon className="size-3.5 shrink-0" />
                    <span className="truncate">{tabTitle(tab)}</span>
                    {tab.dirty && <span aria-label="Unsaved changes">•</span>}
                  </button>

                  <button type="button" disabled={tab.saving} aria-label={`Close ${tabTitle(tab)}`} onClick={() => closeTab(tab)}>
                    <XIcon className="size-3" />
                  </button>
                </div>
              ))}
              {selectedMeeting && (
                <div className="noter-tab is-active">
                  <button
                    type="button"
                    role="tab"
                    aria-selected="true"
                    id={`tab-meeting-${selectedMeeting.id}`}
                    aria-controls={`meeting-panel-${selectedMeeting.id}`}
                  >
                    <HeadphonesIcon className="size-3.5 shrink-0" />
                    <span className="truncate">{selectedMeeting.title}</span>
                  </button>
                  <button type="button" aria-label={`Close meeting ${selectedMeeting.title}`} onClick={() => setSearchParams({})}>
                    <XIcon className="size-3" />
                  </button>
                </div>
              )}

              <Button variant="ghost" size="icon" className="shrink-0" aria-label="New note tab" onClick={newNote}>
                <PlusIcon className="size-4" />
              </Button>
            </div>

            {selectedMeeting && libraryQuery.data && (
              <MeetingReview
                key={selectedMeeting.id}
                meeting={selectedMeeting}
                library={libraryQuery.data}
                initialTime={Number(searchParams.get("t")) || 0}
                initialView={
                  searchParams.get("view") === "transcript" || window.location.hash.startsWith("#segment-") ? "transcript" : undefined
                }
                onClose={() => setSearchParams({})}
              />
            )}
            {selectedMeetingId && !selectedMeeting && !libraryQuery.isPending && (
              <p role="alert" className="p-6 text-sm">
                This meeting could not be opened.{" "}
                <button type="button" className="underline" onClick={() => setSearchParams({})}>
                  Back to notes
                </button>
              </p>
            )}
            {tabs.map((tab) => (
              <div
                key={tab.id}
                id={`panel-${tab.id}`}
                role="tabpanel"
                aria-labelledby={`tab-${tab.id}`}
                hidden={activeId !== tab.id || !!selectedMeetingId}
                className="noter-document-host"
              >
                <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-2 text-xs text-muted-foreground">
                  <label>
                    Folder{" "}
                    <select
                      aria-label="Note folder"
                      value={tab.folderId ?? libraryQuery.data?.library.notes.find((item) => item.name === tab.name)?.folderId ?? ""}
                      onChange={(event) => {
                        const folderId = event.target.value;
                        setTabs((tabs) => tabs.map((item) => (item.id === tab.id ? { ...item, folderId } : item)));
                        if (tab.name)
                          void libraryRequest("/notes", "POST", { name: tab.name, folderId }).catch((error) => toast.error(error.message));
                      }}
                    >
                      <option value="">Inbox</option>
                      {libraryQuery.data?.library.folders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(tab.meetingId || libraryQuery.data?.library.notes.find((item) => item.name === tab.name)?.meetingId) && (
                    <button
                      type="button"
                      className="underline"
                      onClick={() =>
                        setSearchParams({
                          meeting:
                            tab.meetingId || libraryQuery.data?.library.notes.find((item) => item.name === tab.name)?.meetingId || "",
                        })
                      }
                    >
                      Open recording
                    </button>
                  )}
                </div>
                {tab.name && libraryQuery.data?.library.notes.some((item) => item.name === tab.name) && (
                  <button
                    type="button"
                    className="mx-6 my-2 self-start text-xs underline"
                    onClick={async () => {
                      try {
                        const result = await libraryRequest<{ content: string }>(`/note-file?name=${encodeURIComponent(tab.name || "")}`);
                        requestDraft(result.content, "replace");
                        toast.success("Local file opened as a draft. Review and save to import.");
                      } catch (error) {
                        toast.error((error as Error).message);
                      }
                    }}
                  >
                    Review local Markdown file
                  </button>
                )}
                <NoteDocument
                  key={`${tab.id}:${tab.recoveryToken ?? 0}`}
                  tab={tab}
                  active={activeId === tab.id}
                  incomingDraft={activeId === tab.id ? pendingDraft : null}
                  onDraftApplied={draftApplied}
                  onContent={setDocumentContent}
                  onDiscard={setDiscarder}
                  onSaving={setSaving}
                  onDirty={setDirty}
                  onSaved={onSaved}
                />
              </div>
            ))}

            <footer className="noter-status">
              <span>
                {selectedMeeting
                  ? "Recording · transcript · linked notes"
                  : activeTab?.dirty
                    ? "Unsaved changes"
                    : activeTab?.name
                      ? "Saved note"
                      : "New note · draft kept on this device"}
              </span>
              <span>
                {selectedMeeting ? (
                  "Meeting review"
                ) : (
                  <>
                    Markdown <span className="ml-4 hidden sm:inline">Ctrl + Enter to save</span>
                  </>
                )}
              </span>
            </footer>
          </section>

          {assistantOpen && (
            <aside className="noter-assistant" aria-label="AI assistant">
              <div className="flex justify-end border-b border-border px-2 py-1">
                <Button variant="ghost" size="icon" aria-label="Close assistant" onClick={() => setAssistantOpen(false)}>
                  <XIcon className="size-4" />
                </Button>
              </div>
              <AgentSheet
                embedded
                open
                onOpenChange={setAssistantOpen}
                noteName={activeTab?.name}
                getNoteContent={() => documentContentRef.current.get(activeId) ?? ""}
              />
            </aside>
          )}
        </div>
      </div>
    </NewMemoProvider>
  );
}
