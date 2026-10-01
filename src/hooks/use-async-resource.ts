import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "@/lib/errors";

export type AsyncResource<T> =
  { status: "loading"; data?: T } | { status: "ready"; data: T } | { status: "error"; error: string; data?: T };

/**
 * Loads `fetch()` on mount and whenever `key` changes; `reload()` fetches again.
 * Previous data stays available while reloading; stale responses are ignored.
 */
export function useAsyncResource<T>(key: string, fetch: () => Promise<T>): AsyncResource<T> & { reload: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; attempt: number; value: AsyncResource<T> } | undefined>();

  useEffect(() => {
    let cancelled = false;
    fetch().then(
      (data) => {
        if (!cancelled) setState({ key, attempt, value: { status: "ready", data } });
      },
      (error: unknown) => {
        if (!cancelled)
          setState((prev) => ({
            key,
            attempt,
            value: {
              status: "error",
              error: errorMessage(error),
              data: prev?.key === key ? prev.value.data : undefined,
            },
          }));
      },
    );
    return () => {
      cancelled = true;
    };
    // `fetch` is intentionally not a dependency: `key` identifies what is loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const current =
    state && state.key === key && state.attempt === attempt
      ? state.value
      : { status: "loading" as const, data: state?.key === key ? state.value.data : undefined };
  return { ...current, reload };
}
