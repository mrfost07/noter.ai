/** Bound provider work even if a transport ignores cancellation. */
export async function meetingRequest<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  controllers: Set<AbortController>,
  milliseconds = 45000,
): Promise<T> {
  const controller = new AbortController();
  controllers.add(controller);
  let aborted = () => {};
  const cancellation = new Promise<never>((_, reject) => {
    aborted = () => reject(controller.signal.reason ?? new Error("Meeting request cancelled."));
    controller.signal.addEventListener("abort", aborted, { once: true });
  });
  const timer = window.setTimeout(
    () => controller.abort(new Error("Meeting provider timed out. Recording and existing text are retained.")),
    milliseconds,
  );
  try {
    return await Promise.race([operation(controller.signal), cancellation]);
  } finally {
    window.clearTimeout(timer);
    controller.signal.removeEventListener("abort", aborted);
    controllers.delete(controller);
  }
}
