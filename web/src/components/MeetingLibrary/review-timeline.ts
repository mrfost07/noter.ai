import type { LibraryLine } from "@/lib/meeting-library";

/** Keep the latest spoken passage as context through gaps, without returning to an older overlapping channel. */
export function passageAtTime(lines: LibraryLine[], seconds: number): string | undefined {
  if (!Number.isFinite(seconds)) return;
  let current: LibraryLine | undefined;
  for (const line of lines) {
    if (!Number.isFinite(line.start) || line.start > seconds || line.start < 0) continue;
    if (!current || line.start > current.start || (line.start === current.start && line.id.localeCompare(current.id) > 0)) current = line;
  }
  return current?.id;
}

/** Scroll only the transcript viewport; scrollIntoView can move the player and the whole document. */
export function revealPassage(panel: HTMLElement, passage: HTMLElement): void {
  const viewport = panel.getBoundingClientRect();
  const row = passage.getBoundingClientRect();
  if (row.top < viewport.top) panel.scrollTop = Math.max(0, panel.scrollTop + row.top - viewport.top);
  else if (row.bottom > viewport.bottom) panel.scrollTop += Math.min(row.bottom - viewport.bottom, Math.max(0, row.top - viewport.top));
}
