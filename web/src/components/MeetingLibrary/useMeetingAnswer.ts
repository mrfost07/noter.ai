import { useCallback, useEffect, useRef, useState } from "react";
import { libraryRequest } from "@/lib/meeting-library";
import { cleanMeetingAnswer } from "./meeting-answer";

export function useMeetingAnswer(meetingId: string) {
  const generation = useRef(0);
  const request = useRef<AbortController | undefined>(undefined);
  const [answer, setAnswer] = useState({ content: "", question: "", revision: 0 });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    generation.current++;
    request.current?.abort();
    setAnswer({ content: "", question: "", revision: 0 });
    setPending(false);
    setError("");
    return () => {
      generation.current++;
      request.current?.abort();
    };
  }, [meetingId]);
  const cancel = useCallback(() => {
    generation.current++;
    request.current?.abort();
    setPending(false);
    setError("");
  }, []);
  const present = useCallback((content: string, question = "Organized meeting notes") => {
    const revision = ++generation.current;
    request.current?.abort();
    setPending(false);
    setError("");
    setAnswer({ content: cleanMeetingAnswer(content, true), question, revision });
  }, []);
  const ask = useCallback(
    async (question: string) => {
      const submitted = question.trim();
      if (!submitted) return;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      const revision = ++generation.current;
      setPending(true);
      setError("");
      setAnswer({ content: "", question: submitted, revision });
      const timeout = setTimeout(() => {
        if (generation.current !== revision) return;
        generation.current++;
        controller.abort();
        setPending(false);
        setError("The answer took too long. Please try again.");
      }, 90000);
      try {
        const result = await libraryRequest<{ markdown: string }>(
          `/meetings/${meetingId}/ask`,
          "POST",
          { question: submitted },
          controller.signal,
        );
        if (generation.current !== revision) return;
        const content = cleanMeetingAnswer(result.markdown);
        if (!content) throw new Error("AI returned no answer. Try a more specific question.");
        setAnswer({ content, question: submitted, revision });
      } catch (failure) {
        if (generation.current === revision)
          setError(
            controller.signal.aborted
              ? "The answer took too long. Please try again."
              : failure instanceof Error
                ? failure.message
                : "The answer could not be prepared.",
          );
      } finally {
        clearTimeout(timeout);
        if (generation.current === revision) setPending(false);
      }
    },
    [meetingId],
  );
  return { answer, pending, error, ask, cancel, present };
}
