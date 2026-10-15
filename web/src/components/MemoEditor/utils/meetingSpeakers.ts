import type { TranscriptLine } from "../hooks/useMeetingNoteTaker";
import type { SpeakerLabel } from "../services/websocketSTT";

const words = (text: string) => text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

// Remove only long, verbatim microphone echoes of the shared channel. Short
// acknowledgements, mixed speech, and manually entered text remain untouched.
const isSharedEcho = (mic: TranscriptLine, shared: TranscriptLine) => {
  if (mic.source !== "microphone" || shared.source !== "shared" || mic.recording !== shared.recording) return false;
  if (mic.capturedAt === undefined || shared.capturedAt === undefined || Math.abs(mic.capturedAt - shared.capturedAt) > 8000) return false;
  const micWords = words(mic.text);
  return micWords.length >= 6 && ` ${words(shared.text).join(" ")} `.includes(` ${micWords.join(" ")} `);
};

export function appendCapturedLine(current: TranscriptLine[], line: TranscriptLine): TranscriptLine[] {
  if (line.source === "microphone" && current.some((shared) => isSharedEcho(line, shared))) return current;
  const retained = line.source === "shared" ? current.filter((mic) => !isSharedEcho(mic, line)) : current;
  return [...retained, line];
}

export const displaySpeaker = (speaker: SpeakerLabel) => {
  if (speaker === "[You]") return "Microphone";
  if (speaker === "[Client]") return "Shared audio";
  return speaker.slice(1, -1);
};

export function buildSpeakerTurns(
  segments: { text: string; start: number; end: number; speaker: string }[],
  startedAt: number,
  recording: number,
): TranscriptLine[] {
  const speakerNumbers = new Map<string, number>();
  return segments
    .filter((segment) => segment.text.trim() && Number.isFinite(segment.start) && segment.start >= 0 && segment.end >= segment.start)
    .map((segment) => {
      const id = segment.speaker.trim();
      if (id && !speakerNumbers.has(id)) speakerNumbers.set(id, speakerNumbers.size + 1);
      const number = speakerNumbers.get(id);
      const speaker: SpeakerLabel = number
        ? (`[Client ${number}${recording > 1 ? ` · recording ${recording}` : ""}]` as SpeakerLabel)
        : "[Client]";
      const capturedAt = startedAt + segment.start * 1000;
      return {
        id: crypto.randomUUID(),
        text: segment.text.trim(),
        speaker,
        capturedAt,
        start: segment.start,
        end: segment.end,
        approximate: false,
        recording,
        source: "shared" as const,
        timestamp: new Date(capturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      };
    });
}
