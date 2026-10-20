import { FolderOpenIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useLibrary } from "@/hooks/useLibraryQueries";
import { libraryRequest } from "@/lib/meeting-library";
import { User_Role } from "@/types/proto/api/user_service_pb";
import { invokeTauri, isTauriEnvironment } from "@/utils/tauri";

export default function LibrarySettings() {
  const query = useLibrary();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [destination, setDestination] = useState("");
  const response = query.data;
  const user = useCurrentUser();
  const nativeFiles = !!response?.desktop && isTauriEnvironment();
  const [space, setSpace] = useState<number | null>(null);
  useEffect(() => {
    if (nativeFiles && response)
      void invokeTauri<{ available: number }>("library_disk_space", { root: response.library.root }).then((result) =>
        setSpace(result?.available ?? null),
      );
  }, [nativeFiles, response]);
  return (
    <section className="mb-8 space-y-4 border-b border-border pb-8" aria-label="Library and recordings settings">
      <div>
        <h2 className="text-lg font-semibold">Library & recordings</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Notes, recordings, and timed transcripts stay together in real folders. AI uses your existing provider settings.
        </p>
      </div>
      {query.isPending && <p role="status">Opening library…</p>}
      {query.isError && <p role="alert">{query.error.message}</p>}
      {response && (
        <>
          <label className="flex flex-wrap items-center gap-3 text-sm">
            Screen recording quality
            <select
              aria-label="Screen recording quality"
              className="rounded-md border border-border bg-background p-2"
              value={response.library.quality || "balanced"}
              onChange={(event) =>
                void libraryRequest("/preferences", "POST", { quality: event.target.value }).catch((error) => setError(error.message))
              }
            >
              <option value="balanced">Balanced · 720p target</option>
              <option value="sharp">Sharp · 1080p target</option>
            </select>
          </label>
          {space !== null && <p className="text-xs text-muted-foreground">{(space / 1024 ** 3).toFixed(1)} GB available on this drive</p>}
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await libraryRequest("/import-saved-notes", "POST", {});
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Create local copies of existing notes
          </Button>
          <label className="block text-xs text-muted-foreground">
            {response.desktop ? "Local library folder" : "Server library folder"}
            <input
              className="mt-2 w-full rounded-md border border-border bg-background p-3 text-sm text-foreground"
              readOnly
              aria-label="Library folder path"
              value={response.library.root}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!nativeFiles}
              onClick={() => void invokeTauri("open_library_folder", { root: response.library.root, relative: "" })}
            >
              <FolderOpenIcon className="size-4" />
              Open folder
            </Button>
            <Button
              variant="outline"
              disabled={!nativeFiles || user?.role !== User_Role.ADMIN || busy}
              onClick={async () => {
                setError("");
                const path = await invokeTauri<string>("pick_library_folder");
                if (path) setDestination(path);
              }}
            >
              Change location
            </Button>
          </div>
          {!nativeFiles && (
            <p className="text-xs leading-5 text-muted-foreground">
              Folder actions are available in the Windows desktop app. You can download recordings from meeting review. When connected to a
              remote server, the library path belongs to that server.
            </p>
          )}
          {destination && (
            <div className="space-y-3 rounded-md border border-border p-4">
              <p className="break-all text-sm">Copy library to: {destination}</p>
              <p className="text-xs leading-5 text-muted-foreground">
                Choose an empty folder. Noter.ai verifies the copied files before switching; the original copy is kept. Stop recording
                first.
              </p>
              <div className="flex gap-2">
                <Button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await libraryRequest("/location", "POST", { path: destination });
                      setDestination("");
                    } catch (error) {
                      setError((error as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Copying and verifying…" : "Copy and use this folder"}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setDestination("")}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          <p className="text-xs leading-5 text-muted-foreground">
            Screen video uses up to 2.5 Mbps, plus audio. Recording parts are written progressively and retained if transcription or AI
            fails. Pausing ends a part; resuming creates another part on the same meeting timeline.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
    </section>
  );
}
