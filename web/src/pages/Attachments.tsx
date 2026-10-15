import { FileIcon, LoaderCircleIcon, Trash2Icon } from "lucide-react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { useBatchDeleteAttachments, useInfiniteAttachments } from "@/hooks/useAttachmentQueries";
import { useTranslate } from "@/utils/i18n";

const Attachments = () => {
  const t = useTranslate();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteAttachments();
  const { mutateAsync: batchDeleteAttachments } = useBatchDeleteAttachments();

  const attachments = data?.pages.flatMap((page) => page.attachments) ?? [];

  const handleDelete = async (name: string) => {
    try {
      await batchDeleteAttachments([name]);
      toast.success(t("resource.delete-all-unused-success"));
    } catch {
      toast.error("Failed to delete attachment");
    }
  };

  return (
    <section className="container mx-auto min-h-full w-full max-w-5xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">{t("common.attachments")}</h1>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoaderCircleIcon className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : attachments.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">{t("message.no-data")}</div>
      ) : (
        <div className="grid gap-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.name}
              className="flex items-center justify-between rounded-lg border border-border/60 bg-card p-3 text-card-foreground shadow-xs"
            >
              <div className="flex min-w-0 items-center gap-3">
                <FileIcon className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{attachment.filename}</p>
                  <p className="text-xs text-muted-foreground">{attachment.type}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => void handleDelete(attachment.name)}
              >
                <Trash2Icon className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {hasNextPage && (
        <div className="mt-6 flex justify-center">
          <Button variant="outline" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? <LoaderCircleIcon className="size-4 animate-spin" /> : null}
            {isFetchingNextPage ? t("resource.fetching-data") : t("memo.load-more")}
          </Button>
        </div>
      )}
    </section>
  );
};

export default Attachments;
