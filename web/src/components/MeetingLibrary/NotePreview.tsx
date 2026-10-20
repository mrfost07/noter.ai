import { create } from "@bufbuild/protobuf";
import MemoContent from "@/components/MemoContent";
import { MemoViewContext, type MemoViewContextValue } from "@/components/MemoView/MemoViewContext";
import { MemoSchema } from "@/types/proto/api/memo_service_pb";

const context: MemoViewContextValue = {
  memo: create(MemoSchema),
  creator: undefined,
  currentUser: undefined,
  parentPage: "/",
  cardWidth: 480,
  isArchived: false,
  readonly: true,
  showBlurredContent: false,
  blurred: false,
  openEditor: () => {},
  toggleBlurVisibility: () => {},
  openPreview: () => {},
};
export function NotePreview({ content, className, contentClassName }: { content: string; className?: string; contentClassName?: string }) {
  return (
    <MemoViewContext.Provider value={context}>
      <MemoContent content={content} className={className} contentClassName={contentClassName} />
    </MemoViewContext.Provider>
  );
}
