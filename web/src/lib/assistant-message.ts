import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";

// Hide database resource names in generated prose while retaining valid note
// links. Edit text positions only: route destinations and code blocks stay intact.
export function formatAssistantMessage(content: string): string {
  const edits: { start: number; end: number; value: string }[] = [];
  const resource = /\bmemos\/([A-Za-z0-9_-]+)/g;
  const walk = (node: Nodes, inLink = false) => {
    if (node.type === "text" || node.type === "inlineCode") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      const original = content.slice(start, end);
      const raw = node.type === "inlineCode" ? node.value : original;
      if (node.type === "inlineCode" && !/^memos\/[A-Za-z0-9_-]+$/.test(raw)) return;
      const value = raw.replace(resource, (_, uid: string) => (inLink ? "Open note" : `[Open note](/memos/${uid})`));
      if (value !== raw) edits.push({ start, end, value });
    } else if ("children" in node) {
      for (const child of node.children) walk(child as Nodes, inLink || node.type === "link" || node.type === "linkReference");
    }
  };
  walk(fromMarkdown(content));
  let result = content;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
  return result;
}
