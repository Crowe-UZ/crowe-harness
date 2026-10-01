/**
 * Controllable `window.matchMedia` for jsdom (which has none).
 *
 * Every query starts as not matching (desktop width, light system theme). `setMatches(query, value)`
 * flips a query and notifies all MediaQueryLists created for it, through `addEventListener("change")`,
 * the legacy `addListener` API and `onchange` — like a real browser.
 */

type LegacyListener = (this: MediaQueryList, event: MediaQueryListEvent) => void;

const state = new Map<string, boolean>();
const lists = new Set<MockMediaQueryList>();

class MockMediaQueryList extends EventTarget implements MediaQueryList {
  readonly media: string;
  onchange: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null = null;
  private readonly legacy = new Set<LegacyListener>();

  constructor(media: string) {
    super();
    this.media = media;
  }

  get matches(): boolean {
    return state.get(this.media) ?? false;
  }

  addListener(listener: LegacyListener | null): void {
    if (listener) this.legacy.add(listener);
  }

  removeListener(listener: LegacyListener | null): void {
    if (listener) this.legacy.delete(listener);
  }

  notify(): void {
    const event = Object.assign(new Event("change"), {
      matches: this.matches,
      media: this.media,
    }) as MediaQueryListEvent;
    this.dispatchEvent(event);
    this.onchange?.call(this, event);
    for (const listener of this.legacy) listener.call(this, event);
  }
}

function matchMedia(query: string): MediaQueryList {
  const list = new MockMediaQueryList(query);
  lists.add(list);
  return list;
}

/** Installs the mock on `window` (idempotent). */
export function installMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: matchMedia });
}

/** Sets whether `query` matches and fires `change` on every list created for it (only when the value changes). */
export function setMatches(query: string, matches: boolean): void {
  if ((state.get(query) ?? false) === matches) return;
  state.set(query, matches);
  for (const list of lists) {
    if (list.media === query) list.notify();
  }
}

/** Forgets all queries and lists; every query is "not matching" again. */
export function resetMatchMedia(): void {
  state.clear();
  lists.clear();
}

export const PREFERS_DARK = "(prefers-color-scheme: dark)";
