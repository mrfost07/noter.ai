import { equals } from "@bufbuild/protobuf";
import { useCallback, useEffect, useRef } from "react";
import { AttachmentSchema } from "@/types/proto/api/attachment_service_pb";
import { LocationSchema, MemoRelationSchema } from "@/types/proto/api/memo_service_pb";
import { cacheService, type EditorDraft } from "../services";
import { type EditorState, useEditorStore } from "../state";

const draftFromState = ({ content, metadata }: EditorState, includeRelations = false): EditorDraft => ({
  content,
  attachments: metadata.attachments,
  ...(includeRelations ? { relations: metadata.relations } : {}),
  location: metadata.location ?? null,
  space: metadata.space,
});

const sameDraft = (left: EditorDraft, right: EditorDraft): boolean =>
  left.content === right.content &&
  left.space === right.space &&
  (left.relations ?? []).length === (right.relations ?? []).length &&
  (left.relations ?? []).every(
    (relation, index) => !!right.relations?.[index] && equals(MemoRelationSchema, relation, right.relations[index]),
  ) &&
  (left.location === right.location || (!!left.location && !!right.location && equals(LocationSchema, left.location, right.location))) &&
  left.attachments.length === right.attachments.length &&
  left.attachments.every((attachment, index) => {
    const other = right.attachments[index];
    return other !== undefined && equals(AttachmentSchema, attachment, other);
  });

/**
 * Persists the editor's content and already-uploaded attachments to localStorage
 * as a draft. Subscribes to the editor store directly rather than taking draft
 * state as props, so the component that mounts this hook does not re-render on
 * every keystroke.
 */
export const useAutoSave = (username: string, cacheKey: string | undefined, enabled = true, includeRelations = false) => {
  const store = useEditorStore();
  const latestDraftRef = useRef<EditorDraft>(draftFromState(store.getState(), includeRelations));
  const discardedDraftRef = useRef<EditorDraft | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;

    const key = cacheService.key(username, cacheKey);
    const persist = (draft: EditorDraft) => {
      latestDraftRef.current = draft;
      if (discardedDraftRef.current !== undefined && !sameDraft(discardedDraftRef.current, draft)) {
        discardedDraftRef.current = undefined;
      }
      cacheService.save(key, draft);
    };

    // Persist the current draft on mount/enable, then on every relevant change.
    persist(draftFromState(store.getState(), includeRelations));
    return store.subscribe(() => {
      const draft = draftFromState(store.getState(), includeRelations);
      if (!sameDraft(draft, latestDraftRef.current)) {
        persist(draft);
      }
    });
  }, [store, username, cacheKey, enabled, includeRelations]);

  useEffect(() => {
    if (!enabled) return;

    const key = cacheService.key(username, cacheKey);
    const flushDraft = () => {
      if (discardedDraftRef.current && sameDraft(discardedDraftRef.current, latestDraftRef.current)) {
        return;
      }

      cacheService.saveNow(key, latestDraftRef.current);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushDraft();
      }
    };

    window.addEventListener("pagehide", flushDraft);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      // Flush on unmount (e.g. editor closes) to ensure the draft is persisted
      // before the component is torn down — distinct from the visibility flush above.
      flushDraft();
      window.removeEventListener("pagehide", flushDraft);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [store, username, cacheKey, enabled, includeRelations]);

  const discardDraft = useCallback(() => {
    const key = cacheService.key(username, cacheKey);
    discardedDraftRef.current = latestDraftRef.current;
    cacheService.clear(key);
  }, [username, cacheKey]);

  return { discardDraft };
};
