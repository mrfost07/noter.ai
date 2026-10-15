import toast from "react-hot-toast";

/**
 * Helper to invoke Tauri IPC commands safely when running inside the Tauri desktop app.
 * Returns null gracefully when running in web browser environments.
 */
export async function invokeTauri<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (typeof window === "undefined") {
    return null;
  }
  const tauri = (
    window as unknown as {
      __TAURI__?: {
        core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<T> };
        invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<T>;
      };
    }
  ).__TAURI__;

  if (!tauri) {
    return null;
  }

  const invoke = tauri.core?.invoke ?? tauri.invoke;
  if (typeof invoke === "function") {
    try {
      return await invoke(command, args);
    } catch (err) {
      console.warn(`[Tauri] Command "${command}" failed:`, err);
      toast.error("Desktop window controls are unavailable. Your meeting stays available in this window.");
    }
  }
  return null;
}

export function isTauriEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    (
      window as unknown as {
        __TAURI__?: unknown;
      }
    ).__TAURI__,
  );
}
