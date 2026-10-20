import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function useProgressiveMarkdown(content: string, revision: number) {
  const characters = useMemo(() => Array.from(content), [content]);
  const [shown, setShown] = useState({ content, revision, count: 0 });
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const showAll = useCallback(() => {
    clearInterval(timer.current);
    setShown({ content, revision, count: characters.length });
  }, [content, revision, characters.length]);
  useEffect(() => {
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (preference?.matches || !content) {
      showAll();
      return;
    }
    setShown({ content, revision, count: 0 });
    let count = 0;
    const step = Math.max(3, Math.ceil(characters.length / 90));
    timer.current = setInterval(() => {
      count = Math.min(characters.length, count + step);
      setShown({ content, revision, count });
      if (count === characters.length) clearInterval(timer.current);
    }, 32);
    const changed = () => {
      if (preference?.matches) showAll();
    };
    preference?.addEventListener?.("change", changed);
    return () => {
      clearInterval(timer.current);
      preference?.removeEventListener?.("change", changed);
    };
  }, [content, revision, characters, showAll]);
  const count = shown.content === content && shown.revision === revision ? shown.count : 0;
  return { text: characters.slice(0, count).join(""), complete: count >= characters.length, showAll };
}
