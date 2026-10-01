import { useEffect } from "react";

const APP_NAME = "Crowe Harness";

/** Sets `document.title` to "<parts> · Crowe Harness" while the calling page is shown. */
export function usePageTitle(...parts: (string | undefined)[]) {
  const title = [...parts.filter(Boolean), APP_NAME].join(" · ");
  useEffect(() => {
    document.title = title;
  }, [title]);
}
