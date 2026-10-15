export type SpeakerLabel = "[Client]" | "[You]" | "[Note]" | `[Client ${number}]` | `[Client ${number} · recording ${number}]`;

export interface WebSocketSTTCallbacks {
  onTranscript: (speaker: SpeakerLabel, text: string, isFinal: boolean) => void;
  onError?: (err: Error) => void;
}

/**
 * Connects a MediaStream to Deepgram Nova-3 WebSocket for real-time sub-300ms transcription.
 */
export function connectDeepgramWebSocket(
  apiKey: string,
  speaker: SpeakerLabel,
  stream: MediaStream,
  callbacks: WebSocketSTTCallbacks,
  language = "en",
): () => void {
  const url = `wss://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&interim_results=true&language=${encodeURIComponent(language)}`;
  const ws = new WebSocket(url, ["token", apiKey]);

  let recorder: MediaRecorder | null = null;

  ws.onopen = () => {
    recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
        ws.send(e.data);
      }
    };
    recorder.start(250);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      const transcript = data?.channel?.alternatives?.[0]?.transcript?.trim();
      if (transcript) {
        callbacks.onTranscript(speaker, transcript, Boolean(data.is_final));
      }
    } catch {
      // Ignore non-JSON frames.
    }
  };

  ws.onerror = () => callbacks.onError?.(new Error("Deepgram WebSocket error"));

  return () => {
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "CloseStream" }));
      ws.close();
    }
  };
}
