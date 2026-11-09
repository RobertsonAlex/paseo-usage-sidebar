/**
 * The app-wide pin store: one selection per app, shared by every host's copy
 * of the plugin and kept across reloads where the platform has localStorage.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { Selection } from "../shared/selection/contract";
import { createSelectionStore, type SelectionStorage } from "../client/selection/store";

const pinned = (keys: string[]): Selection => ({ keys, configured: true, showPace: true, displayAs: "used" });
const unpinned: Selection = { keys: [], configured: false, showPace: true, displayAs: "used" };

function memoryStorage(initial: Record<string, string> = {}): SelectionStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe("selection store", () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    storage = memoryStorage();
  });

  it("starts empty with nothing saved", () => {
    assert.equal(createSelectionStore({}, storage).get(), null);
  });

  it("is shared by every copy that finds the same scope", () => {
    const scope = {};
    const mac = createSelectionStore(scope, storage);
    const vm = createSelectionStore(scope, storage);
    let heard: Selection | null = null;
    mac.subscribe((selection) => {
      heard = selection;
    });
    vm.publish(pinned(["claude:weekly"]));
    assert.deepEqual(mac.get(), pinned(["claude:weekly"]));
    assert.deepEqual(heard, pinned(["claude:weekly"]));
  });

  it("survives a reload through storage", () => {
    createSelectionStore({}, storage).publish(pinned(["claude:weekly"]));
    assert.deepEqual(createSelectionStore({}, storage).get(), pinned(["claude:weekly"]));
  });

  it("ignores a corrupt saved value", () => {
    storage.setItem("paseo-usage-sidebar:selection:v1", "{nope");
    assert.equal(createSelectionStore({}, storage).get(), null);
  });

  it("seeds from a host's pins when the app has none", () => {
    const store = createSelectionStore({}, storage);
    store.seed(pinned(["claude:five_hour"]));
    assert.deepEqual(store.get(), pinned(["claude:five_hour"]));
    assert.deepEqual(createSelectionStore({}, storage).get(), pinned(["claude:five_hour"]), "and keeps them");
  });

  it("lets a host with pins replace one without, but not the other way round", () => {
    const store = createSelectionStore({}, storage);
    store.seed(unpinned);
    assert.deepEqual(store.get(), unpinned);
    assert.equal(createSelectionStore({}, storage).get(), null, "an unpinned host is not saved");
    store.seed(pinned(["claude:weekly"]));
    store.seed(unpinned);
    store.seed(pinned(["other:weekly"]));
    assert.deepEqual(store.get(), pinned(["claude:weekly"]), "the first host with pins wins");
  });

  it("never lets a host's copy overwrite the app's own edit", () => {
    const store = createSelectionStore({}, storage);
    store.publish(pinned(["claude:weekly"]));
    store.seed(pinned(["claude:five_hour"]));
    assert.deepEqual(store.get(), pinned(["claude:weekly"]));
  });

  it("works in memory where there is no storage", () => {
    const store = createSelectionStore({}, null);
    store.publish(pinned(["claude:weekly"]));
    assert.deepEqual(store.get(), pinned(["claude:weekly"]));
  });

  it("keeps working when storage throws", () => {
    const broken: SelectionStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    const store = createSelectionStore({}, broken);
    store.publish(pinned(["claude:weekly"]));
    assert.deepEqual(store.get(), pinned(["claude:weekly"]));
  });
});
