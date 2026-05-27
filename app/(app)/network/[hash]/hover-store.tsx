'use client';

import { createContext, useContext, useRef, useSyncExternalStore } from 'react';

// Hover highlighting used to live in React state and feed the memoized `nodes`
// and `edges` arrays. Every mouse-enter then rebuilt both arrays, churned React
// Flow's internal `nodeInternals` store and forced every floating edge to
// recompute its geometry — the source of the constant re-rendering and lag.
//
// We lift the hovered hash into a tiny external store instead. The node/edge
// arrays no longer depend on it, so they stay referentially stable across
// hovers. Only the leaf node divs and edge paths restyle, and each subscriber
// derives a primitive snapshot so React bails out of re-renders whose visual
// state did not actually change.

type HoverStore = {
  subscribe: (cb: () => void) => () => void;
  get: () => string | null;
  set: (hash: string | null) => void;
};

function makeHoverStore(): HoverStore {
  let value: string | null = null;
  const listeners = new Set<() => void>();
  return {
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    get: () => value,
    set(hash) {
      if (hash === value) return;
      value = hash;
      for (const cb of listeners) cb();
    },
  };
}

const HoverContext = createContext<HoverStore | null>(null);

export function HoverProvider({ children }: { children: React.ReactNode }) {
  const store = useRef<HoverStore>(undefined);
  if (!store.current) store.current = makeHoverStore();
  return <HoverContext.Provider value={store.current}>{children}</HoverContext.Provider>;
}

export function useHoverStore(): HoverStore {
  const store = useContext(HoverContext);
  if (!store) throw new Error('useHoverStore must be used within a HoverProvider');
  return store;
}

const EMPTY: ReadonlySet<string> = new Set();

/** 'none' | 'spotlight' | 'dim' — what hover does to this node right now. */
export type NodeHoverState = 'none' | 'spotlight' | 'dim';

export function useNodeHoverState(
  hash: string,
  neighborHashes: ReadonlySet<string> = EMPTY,
): NodeHoverState {
  const store = useHoverStore();
  return useSyncExternalStore(
    store.subscribe,
    () => {
      const hovered = store.get();
      if (!hovered) return 'none';
      if (hovered === hash || neighborHashes.has(hovered)) return 'spotlight';
      return 'dim';
    },
    () => 'none',
  );
}

/** -1 dim · 0 untouched · 1 spotlight — hover effect on an edge between a/b. */
export function useEdgeHoverState(source: string, target: string): -1 | 0 | 1 {
  const store = useHoverStore();
  return useSyncExternalStore(
    store.subscribe,
    () => {
      const hovered = store.get();
      if (!hovered) return 0;
      return source === hovered || target === hovered ? 1 : -1;
    },
    () => 0,
  );
}
