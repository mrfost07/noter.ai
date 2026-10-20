import { FileTextIcon, FolderIcon, FolderPlusIcon, HeadphonesIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { clock, type LibraryMeeting, type LibraryResponse, libraryRequest } from "@/lib/meeting-library";
import type { NoteTab } from "@/lib/noter-workspace";
import type { Memo } from "@/types/proto/api/memo_service_pb";

export function LibrarySidebar({
  library,
  error,
  loading,
  notes,
  tabs,
  activeName,
  search,
  onSearch,
  onNote,
  onDraft,
  onMeeting,
  newNote,
  folder,
  onFolder,
  archived,
  onRetry,
  hasMore,
  loadMore,
  hideItems = false,
  onBrowse,
}: {
  library?: LibraryResponse;
  error?: string;
  loading: boolean;
  notes: Memo[];
  tabs: NoteTab[];
  activeName?: string;
  search: string;
  onSearch: (text: string) => void;
  onNote: (note: Memo) => void;
  onDraft: (id: string) => void;
  onMeeting: (meeting: LibraryMeeting, time?: number) => void;
  newNote: () => void;
  folder: string;
  onFolder: (id: string) => void;
  archived: boolean;
  onRetry: () => void;
  hasMore?: boolean;
  loadMore: () => void;
  hideItems?: boolean;
  onBrowse?: () => void;
}) {
  const [view, setView] = useState<"notes" | "meetings" | "pinned" | "drafts">("notes");
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [folderTitle, setFolderTitle] = useState("");
  const [folderError, setFolderError] = useState("");
  const folderMatch = (id: string) => folder === "*" || folder === id;
  const visibleNotes = notes.filter(
    (note) =>
      folderMatch(library?.library.notes.find((item) => item.name === note.name)?.folderId ?? "") && (view !== "pinned" || note.pinned),
  );
  const meetings = (library?.library.meetings ?? [])
    .filter(
      (meeting) =>
        meeting.trashed === archived &&
        folderMatch(meeting.folderId) &&
        (!search.trim() ||
          `${meeting.title}\n${meeting.transcript.map((line) => line.text).join("\n")}`
            .toLocaleLowerCase()
            .includes(search.toLocaleLowerCase())),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const drafts = tabs.filter((tab) => !tab.name || tab.dirty);
  return (
    <div className="noter-library-shell">
      <nav className="noter-library-nav" aria-label="Library navigation">
        <p className="px-3 pb-3 text-sm font-semibold">Library</p>
        {(["notes", "meetings", "pinned", "drafts"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-current={view === value ? "page" : undefined}
            onClick={() => {
              setView(value);
              onBrowse?.();
            }}
          >
            {value === "meetings" ? <HeadphonesIcon className="size-4" /> : <FileTextIcon className="size-4" />}
            {value === "notes" ? "Notes" : value === "meetings" ? "Meetings" : value === "pinned" ? "Pinned" : "Drafts"}
          </button>
        ))}
        <div className="mt-5 flex items-center justify-between px-3 text-xs text-muted-foreground">
          <span>Folders</span>
          <Button variant="ghost" size="icon" aria-label="Create folder" onClick={() => setCreating(!creating)}>
            <FolderPlusIcon className="size-4" />
          </Button>
        </div>
        <button type="button" aria-pressed={folder === "*"} onClick={() => onFolder("*")}>
          <FolderIcon className="size-4" />
          All folders
        </button>
        <button type="button" aria-pressed={folder === ""} onClick={() => onFolder("")}>
          <FolderIcon className="size-4" />
          Inbox
        </button>
        {(library?.library.folders ?? []).map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={folder === item.id}
            title={item.title}
            onClick={() => onFolder(item.id)}
            style={{ paddingInlineStart: `${12 + (item.path.split("/").length - 1) * 10}px` }}
          >
            <FolderIcon className="size-4 shrink-0" />
            <span className="truncate">{item.title}</span>
          </button>
        ))}
        {folder !== "*" && folder !== "" && (
          <button
            type="button"
            className="text-muted-foreground"
            onClick={() => {
              setFolderTitle(library?.library.folders.find((item) => item.id === folder)?.title || "");
              setRenaming(true);
              setCreating(true);
            }}
          >
            Rename selected folder
          </button>
        )}
        {creating && (
          <form
            className="space-y-2 px-2 pt-2"
            onSubmit={async (event) => {
              event.preventDefault();
              setFolderError("");
              try {
                const response = await libraryRequest(renaming ? `/folders/${folder}` : "/folders", renaming ? "PATCH" : "POST", {
                  title: folderTitle,
                  ...(renaming ? {} : { parentId: folder === "*" ? "" : folder }),
                });
                if (!renaming) onFolder(response.library.folders[response.library.folders.length - 1].id);
                setFolderTitle("");
                setCreating(false);
                setRenaming(false);
              } catch (error) {
                setFolderError((error as Error).message);
              }
            }}
          >
            <input
              autoFocus
              aria-label="Folder name"
              placeholder="Client or project name"
              className="w-full rounded border border-border bg-background p-2 text-xs"
              value={folderTitle}
              maxLength={120}
              onChange={(event) => setFolderTitle(event.target.value)}
            />
            <Button type="submit" size="sm" className="w-full" disabled={!folderTitle.trim()}>
              {renaming ? "Rename folder" : "Create folder"}
            </Button>
            {folderError && (
              <p role="alert" className="text-xs">
                {folderError}
              </p>
            )}
          </form>
        )}
        <div className="mt-auto space-y-2 px-3 pt-6 text-xs">
          <Link to={archived ? "/" : "/archived"}>{archived ? "Back to library" : "Archive"}</Link>
          <Link className="block" to="/setting#library">
            Library & recordings
          </Link>
        </div>
      </nav>
      {!hideItems && (
        <aside className="noter-library" aria-label="Notes library">
          <div className="flex items-center justify-between px-4 py-3">
            <h1 className="text-sm font-semibold">
              {archived ? "Archived " : ""}
              {view === "meetings" ? "Meetings" : view === "drafts" ? "Drafts" : view === "pinned" ? "Pinned notes" : "Your notes"}
            </h1>
            <Button variant="ghost" size="icon" aria-label="New note" onClick={newNote}>
              +
            </Button>
          </div>
          <label className="noter-search">
            <SearchIcon className="size-4 shrink-0" />
            <input
              aria-label="Search notes and meetings"
              placeholder="Search notes and meetings"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
            />
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
            {loading && (
              <p role="status" className="p-3 text-xs">
                Opening library…
              </p>
            )}
            {error && (
              <div role="alert" className="p-3 text-xs leading-5">
                {error}
                <Button variant="ghost" size="sm" onClick={onRetry}>
                  Retry
                </Button>
              </div>
            )}
            {(view === "notes" || view === "pinned") &&
              visibleNotes.map((note) => (
                <button
                  type="button"
                  key={note.name}
                  className={`noter-note-row ${activeName === note.name ? "is-selected" : ""}`}
                  onClick={() => onNote(note)}
                  aria-current={activeName === note.name ? "page" : undefined}
                >
                  <FileTextIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {note.content
                        .split("\n")
                        .find((line) => line.trim())
                        ?.replace(/^#+\s*/, "") || "Untitled note"}
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {note.content.replace(/\s+/g, " ").slice(0, 85)}
                    </span>
                  </span>
                </button>
              ))}
            {view === "drafts" &&
              drafts.map((tab) => (
                <button key={tab.id} type="button" className="noter-note-row" onClick={() => onDraft(tab.id)}>
                  <FileTextIcon className="size-4 shrink-0" />
                  <span className="truncate">
                    {tab.title}
                    <span className="mt-1 block text-xs text-muted-foreground">Unsaved draft</span>
                  </span>
                </button>
              ))}
            {(view === "meetings" || !!search.trim()) &&
              meetings.map((meeting) => {
                const match = search.trim()
                  ? meeting.transcript.find((line) => line.text.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
                  : undefined;
                return (
                  <button key={meeting.id} type="button" className="noter-note-row" onClick={() => onMeeting(meeting, match?.start)}>
                    <HeadphonesIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{meeting.title}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {new Date(meeting.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} ·{" "}
                        {clock(meeting.duration)} · {meeting.status}
                      </span>
                      {match && (
                        <span className="mt-2 block text-xs leading-5">
                          Transcript · {clock(match.start)} · {match.text.slice(0, 110)}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            {!loading &&
              !error &&
              ((view === "meetings" && !meetings.length) ||
                (view === "drafts" && !drafts.length) ||
                ((view === "notes" || view === "pinned") && !visibleNotes.length && !search.trim())) && (
                <p className="p-3 text-xs leading-6 text-muted-foreground">
                  {view === "meetings"
                    ? "Your recorded meetings will appear here. Start a meeting from the top bar."
                    : view === "drafts"
                      ? "No unsaved drafts in this workspace."
                      : "Your saved notes will appear here. Start with a thought, a task, or a meeting."}
                </p>
              )}
            {hasMore && view !== "meetings" && (
              <Button variant="ghost" className="w-full" onClick={loadMore}>
                Load more notes
              </Button>
            )}
          </div>
          <footer className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
            {view === "meetings"
              ? `${meetings.length} ${meetings.length === 1 ? "meeting" : "meetings"}`
              : `${visibleNotes.length}${hasMore ? "+" : ""} ${visibleNotes.length === 1 && !hasMore ? "note" : "notes"}`}
          </footer>
        </aside>
      )}
    </div>
  );
}
