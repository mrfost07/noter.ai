import { getRequestToken } from "@/connect";

export interface LibraryFolder {
  id: string;
  title: string;
  parentId: string;
  path: string;
}
export interface LibraryLine {
  id: string;
  text: string;
  speaker: string;
  start: number;
  end: number;
  approximate?: boolean;
}
export interface RecordingPart {
  id: string;
  file: string;
  type: string;
  start: number;
  end: number;
  bytes: number;
  complete: boolean;
}
export interface LibraryMeeting {
  id: string;
  title: string;
  folderId: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  duration: number;
  parts: RecordingPart[];
  transcript: LibraryLine[];
  draft: string;
  noteName: string;
  trashed: boolean;
}
export interface LibraryNote {
  name: string;
  folderId: string;
  meetingId: string;
  path: string;
  hash: string;
}
export interface LibraryDraft {
  id: string;
  title: string;
  content: string;
  name?: string;
  folderId?: string;
  meetingId?: string;
}
export interface LibraryIndex {
  quality?: "balanced" | "sharp";
  root: string;
  folders: LibraryFolder[];
  meetings: LibraryMeeting[];
  notes: LibraryNote[];
  drafts?: LibraryDraft[];
}
export interface LibraryResponse {
  library: LibraryIndex;
  desktop: boolean;
}

export const libraryEvents = "noter-library-changed";
export const clock = (seconds: number) => {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return value >= 3600
    ? `${Math.floor(value / 3600)}:${String(Math.floor(value / 60) % 60).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`
    : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
};

export async function libraryRequest<T = LibraryResponse>(path = "", method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const token = await getRequestToken();
  const binary = body instanceof Blob;
  const response = await fetch(`/api/library${path}`, {
    signal,
    method,
    credentials: "same-origin",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": binary ? "application/octet-stream" : "application/json" } : {}),
    },
    body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Library request failed (${response.status})`);
  }
  const result = await response.json();
  if (method !== "GET" && !binary) window.dispatchEvent(new Event(libraryEvents));
  return result as T;
}

export function findMeeting(index: LibraryIndex, id: string) {
  const meeting = index.meetings.find((item) => item.id === id);
  if (!meeting) throw new Error("This meeting is no longer available.");
  return meeting;
}

export function sourceTime(href: string, meetingId: string): number | null {
  try {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin || url.searchParams.get("meeting") !== meetingId) return null;
    const raw = url.searchParams.get("t");
    const seconds = raw === null ? NaN : Number(raw);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  } catch {
    return null;
  }
}

export function matchingLines(lines: LibraryLine[], query: string, speaker: string) {
  const search = query.trim().toLocaleLowerCase();
  return lines.filter((line) => (!speaker || line.speaker === speaker) && (!search || line.text.toLocaleLowerCase().includes(search)));
}
