import { SelectionSchema, type Selection } from "../../shared/selection/contract";

/**
 * The pins, one set per app rather than per host.
 *
 * The sidebar meter shows the whole fleet (shared/usage/fleet.ts), so which
 * windows it pins cannot depend on which host Paseo happened to mount it for.
 * Every host evaluates its own copy of this bundle, but all copies run in the
 * one renderer, so the store lives on `globalThis` and the panel of any host
 * and the meter see one selection, and an edit shows up at once.
 *
 * It is saved to localStorage where there is one (desktop and web). Each host's
 * state file is still written on every edit, and seeds the app the first time
 * it has nothing saved: a fresh install, or a phone, where there is no
 * localStorage and the pins come from the host the panel or meter loads first.
 *
 * The key is versioned because the copies are not the same build: a host that
 * updates later keeps its own per-host store until it does.
 */
const SCOPE_KEY = "__paseoUsageSidebarSelection_v1";
const STORAGE_KEY = "paseo-usage-sidebar:selection:v1";

export type SelectionStorage = Pick<Storage, "getItem" | "setItem">;

type Listener = (selection: Selection) => void;

type Shared = {
  current: Selection | null;
  /** True once the app has pins of its own, from an edit or a host that had pins. */
  owned: boolean;
  listeners: Set<Listener>;
};

export type SelectionStore = {
  get(): Selection | null;
  /** An edit made in this app. */
  publish(selection: Selection): void;
  /** A host's saved pins, used only while the app has none of its own. */
  seed(selection: Selection): void;
  subscribe(listener: Listener): () => void;
};

function load(storage: SelectionStorage | null): Selection | null {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = SelectionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function save(storage: SelectionStorage | null, selection: Selection): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Private mode or a full quota: the pins still hold for this session, and
    // the host's own state file still has them for the next one.
  }
}

/** Parameterized so the tests can hand in their own scope and storage. */
export function createSelectionStore(scope: object, storage: SelectionStorage | null): SelectionStore {
  const bag = scope as Record<string, unknown>;
  let shared = bag[SCOPE_KEY] as Shared | undefined;
  if (!shared) {
    const saved = load(storage);
    shared = { current: saved, owned: saved !== null, listeners: new Set() };
    bag[SCOPE_KEY] = shared;
  }
  const state = shared;

  const set = (selection: Selection, owned: boolean) => {
    state.current = selection;
    state.owned = owned;
    if (owned) {
      save(storage, selection);
    }
    for (const listener of state.listeners) {
      listener(selection);
    }
  };

  return {
    get: () => state.current,
    publish: (selection) => set(selection, true),
    seed: (selection) => {
      if (state.owned) {
        return;
      }
      if (state.current === null || selection.configured) {
        set(selection, selection.configured);
      }
    },
    subscribe: (listener) => {
      state.listeners.add(listener);
      return () => {
        state.listeners.delete(listener);
      };
    },
  };
}

function browserStorage(): SelectionStorage | null {
  try {
    const storage = (globalThis as { localStorage?: SelectionStorage }).localStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}

const store = createSelectionStore(globalThis, browserStorage());

export const getSelection = store.get;
export const publishSelection = store.publish;
export const seedSelection = store.seed;
export const subscribeSelection = store.subscribe;
