/** Older saved/provider replies may contain transport citations. Never reveal these while typing. */
export function cleanMeetingAnswer(markdown: string, preserveRecordingLinks = false): string {
  const content = preserveRecordingLinks ? markdown : markdown.replace(/\[[^\]\n]*\]\([^)\n]*[?&]meeting=[^)\n]*\)/gi, "");
  return content
    .replace(/\[\s*cite\s*:[^\]]*\]/gi, "")
    .replace(
      /\[\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\s*[,;]\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})*\s*\]/gi,
      "",
    )
    .replace(/\[(?:\s|,|;)*\]|\((?:\s|,|;)*\)/g, "")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
