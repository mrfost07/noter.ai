import { useCallback, useLayoutEffect, useRef, useState } from "react";

export function useTranscriptFollow(revision: unknown, active = true) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const followRef = useRef(true);
  const onScroll = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const nearBottom = panel.scrollHeight - panel.clientHeight - panel.scrollTop <= 48;
    followRef.current = nearBottom;
    setFollowing(nearBottom);
  }, []);
  const resume = useCallback(() => {
    followRef.current = true;
    setFollowing(true);
    const panel = panelRef.current;
    if (panel) panel.scrollTop = panel.scrollHeight;
  }, []);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (active && followRef.current && panel) panel.scrollTop = panel.scrollHeight;
  }, [revision, active]);
  return { panelRef, following, onScroll, resume };
}
