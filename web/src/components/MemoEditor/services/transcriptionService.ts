import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { aiServiceClient } from "@/connect";
import {
  AnalyzeMeetingTranscriptRequestSchema,
  type AnalyzeMeetingTranscriptResponse,
  type MeetingNotesState,
  MeetingNotesStateSchema,
  TranscribeRequestSchema,
  TranscriptionAudioSchema,
} from "@/types/proto/api/ai_service_pb";
import type { Attachment } from "@/types/proto/api/attachment_service_pb";
import { getAttachmentUrl } from "@/utils/attachment";

// Mirrors maxTranscriptionAudioSizeBytes in server/api/ai_service.go so an
// oversized attachment is rejected before it is downloaded, with the server's error.
const MAX_AUDIO_SIZE = 25 * 1024 * 1024;
const MAX_MEETING_TRANSCRIPT_BYTES = 256 * 1024;

const checkAudioSize = (size: number) => {
  if (size > MAX_AUDIO_SIZE) throw new ConnectError("audio file is too large; maximum size is 25 MiB", Code.InvalidArgument);
};

const transcribe = async (content: Uint8Array, filename: string, contentType: string, signal?: AbortSignal): Promise<string> => {
  signal?.throwIfAborted();
  const response = await aiServiceClient.transcribe(
    create(TranscribeRequestSchema, {
      audio: create(TranscriptionAudioSchema, {
        source: {
          case: "content",
          value: content,
        },
        filename,
        contentType,
      }),
    }),
    { signal },
  );

  return response.text;
};

export interface MeetingAnalysisInput {
  transcript: string;
  previousState?: Pick<MeetingNotesState, "tasksForYou" | "midMeetingChanges" | "clientDecisions" | "crucialInfo" | "followUpQuestions">;
  providerId?: string;
  model?: string;
  memoName?: string;
}

const getDefaultAIAssistantConfig = (): { providerId: string; model: string } => {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return { providerId: "", model: "" };
    }
    const raw = window.localStorage.getItem("memos-ai-assistant-config");
    if (!raw) return { providerId: "", model: "" };
    const parsed = JSON.parse(raw) as { providerId?: string; model?: string };
    return {
      providerId: typeof parsed.providerId === "string" ? parsed.providerId : "",
      model: typeof parsed.model === "string" ? parsed.model : "",
    };
  } catch {
    return { providerId: "", model: "" };
  }
};

export const transcriptionService = {
  async transcribeTimedFile(file: File, signal?: AbortSignal) {
    checkAudioSize(file.size);
    return aiServiceClient.transcribe(
      create(TranscribeRequestSchema, {
        audio: create(TranscriptionAudioSchema, {
          source: { case: "content", value: new Uint8Array(await file.arrayBuffer()) },
          filename: file.name,
          contentType: file.type,
        }),
      }),
      { signal },
    );
  },
  async transcribeAttachment(attachment: Attachment, signal?: AbortSignal): Promise<string> {
    checkAudioSize(Number(attachment.size));
    const response = await fetch(getAttachmentUrl(attachment), { signal, credentials: "same-origin" });
    if (!response.ok) throw new Error(`Failed to download audio (${response.status})`);
    checkAudioSize(Number(response.headers.get("Content-Length")));
    const content = new Uint8Array(await response.arrayBuffer());
    checkAudioSize(content.byteLength);
    return transcribe(content, attachment.filename, attachment.type, signal);
  },

  async transcribeFile(file: File, signal?: AbortSignal): Promise<string> {
    return transcribe(new Uint8Array(await file.arrayBuffer()), file.name, file.type, signal);
  },

  async recognizeSpeakers(file: File, signal?: AbortSignal) {
    checkAudioSize(file.size);
    return aiServiceClient.transcribe(
      create(TranscribeRequestSchema, {
        audio: create(TranscriptionAudioSchema, {
          source: { case: "content", value: new Uint8Array(await file.arrayBuffer()) },
          filename: file.name,
          contentType: file.type,
        }),
        diarize: true,
      }),
      { signal },
    );
  },

  async analyzeMeetingTranscript(input: MeetingAnalysisInput, signal?: AbortSignal): Promise<AnalyzeMeetingTranscriptResponse> {
    signal?.throwIfAborted();
    const encodedSize = new TextEncoder().encode(input.transcript).byteLength;
    if (encodedSize > MAX_MEETING_TRANSCRIPT_BYTES) {
      throw new ConnectError("transcript is too large; maximum size is 256 KiB", Code.InvalidArgument);
    }

    const defaults = getDefaultAIAssistantConfig();

    return aiServiceClient.analyzeMeetingTranscript(
      create(AnalyzeMeetingTranscriptRequestSchema, {
        transcript: input.transcript,
        previousState: input.previousState
          ? create(MeetingNotesStateSchema, {
              tasksForYou: input.previousState.tasksForYou,
              midMeetingChanges: input.previousState.midMeetingChanges,
              clientDecisions: input.previousState.clientDecisions,
              crucialInfo: input.previousState.crucialInfo,
              followUpQuestions: input.previousState.followUpQuestions,
            })
          : undefined,
        providerId: input.providerId ?? defaults.providerId,
        model: input.model ?? defaults.model,
        memoName: input.memoName ?? "",
      }),
      { signal },
    );
  },
};
