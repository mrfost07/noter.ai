import { useEffect, useRef, useState } from "react";
import type { Location, Memo } from "@/types/proto/api/memo_service_pb";
import { cacheService, memoService } from "../services";
import { useEditorContext } from "../state";
import type { EditorController } from "../types/editorController";

interface UseMemoInitOptions {
  restoreEdits?: boolean;
  editorRef: React.RefObject<EditorController | null>;
  memo?: Memo;
  cacheKey?: string;
  username: string;
  autoFocus?: boolean | (() => boolean);
  defaultCreateTime?: Date;
  defaultLocation?: Location;
  canChooseSpace?: boolean;
}

export const useMemoInit = ({
  editorRef,
  restoreEdits = false,
  memo,
  cacheKey,
  username,
  autoFocus,
  defaultCreateTime,
  defaultLocation,
  canChooseSpace = false,
}: UseMemoInitOptions) => {
  const { actions, dispatch } = useEditorContext();
  const initializedRef = useRef(false);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const key = cacheService.key(username, cacheKey);

    if (memo) {
      const initialState = memoService.fromMemo(memo);
      const draft = restoreEdits ? cacheService.loadDraft(key) : undefined;
      if (draft?.content) {
        initialState.content = draft.content;
        initialState.metadata.attachments = draft.attachments;
        initialState.metadata.relations = draft.relations ?? initialState.metadata.relations;
      }
      if (!restoreEdits) cacheService.clear(key);
      dispatch(actions.initMemo(initialState));
    } else {
      const cachedDraft = cacheService.loadDraft(key);
      if (cachedDraft.content) {
        dispatch(actions.setContent(cachedDraft.content));
      }
      if (cachedDraft.relations) dispatch(actions.setMetadata({ relations: cachedDraft.relations }));
      if (cachedDraft.attachments.length > 0) {
        dispatch(actions.setMetadata({ attachments: cachedDraft.attachments }));
      }
      dispatch(actions.setMetadata({ location: cachedDraft.location === null ? undefined : (cachedDraft.location ?? defaultLocation) }));
      if (canChooseSpace) {
        dispatch(actions.setMetadata({ space: cachedDraft.space }));
      }
      if (defaultCreateTime) {
        dispatch(actions.setTimestamps({ createTime: defaultCreateTime, updateTime: defaultCreateTime }));
      }
    }

    const cachedCursor = cacheService.loadCursor(key);
    let restoreCursorTimer: ReturnType<typeof setTimeout> | undefined;
    if (autoFocus || cachedCursor !== undefined) {
      restoreCursorTimer = setTimeout(() => {
        if (cachedCursor !== undefined) {
          editorRef.current?.setCursor(cachedCursor);
        }
        if (typeof autoFocus === "function" ? autoFocus() : autoFocus) {
          editorRef.current?.focus();
        }
      }, 100);
    }

    setIsInitialized(true);
    return () => {
      if (restoreCursorTimer) {
        clearTimeout(restoreCursorTimer);
      }
    };
  }, [memo, restoreEdits, cacheKey, username, autoFocus, defaultCreateTime, defaultLocation, canChooseSpace, actions, dispatch, editorRef]);

  return { isInitialized };
};
