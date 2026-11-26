import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SaveCoordinator,
  attachSaveLifecycle,
  flushBeforeNavigation,
  type SaveStatus,
} from "./saveCoordinator";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SaveCoordinator", () => {
  it("keeps one request in flight and immediately saves the newest revision with the returned version", async () => {
    const first = deferred<{ updatedAt: string }>();
    const second = deferred<{ updatedAt: string }>();
    const requests: Array<{ value: { title: string }; version: string }> = [];
    const dirtySnapshots: Array<{ value: { title: string }; version: string }> =
      [];
    const statuses: SaveStatus[] = [];
    const coordinator = new SaveCoordinator({
      initialValue: { title: "Initial" },
      initialVersion: "v0",
      debounceMs: 10_000,
      onStatus: (status) => statuses.push(status),
      onDirtySnapshot: (value, version) =>
        dirtySnapshots.push({ value, version }),
      save: (value, version) => {
        requests.push({ value, version });
        return requests.length === 1 ? first.promise : second.promise;
      },
    });

    coordinator.change({ title: "Revision one" });
    const firstFlush = coordinator.flush();
    coordinator.change({ title: "Revision two" });
    void coordinator.flush();
    expect(requests).toHaveLength(1);

    first.resolve({ updatedAt: "v1" });
    await firstFlush;
    expect(requests).toEqual([
      { value: { title: "Revision one" }, version: "v0" },
      { value: { title: "Revision two" }, version: "v1" },
    ]);
    expect(dirtySnapshots).toEqual([
      { value: { title: "Revision one" }, version: "v0" },
      { value: { title: "Revision two" }, version: "v0" },
      { value: { title: "Revision two" }, version: "v1" },
    ]);
    expect(statuses).not.toContain("saved");

    second.resolve({ updatedAt: "v2" });
    await second.promise;
    await Promise.resolve();
    expect(coordinator.isDirty()).toBe(false);
    expect(statuses.at(-1)).toBe("saved");
  });

  it("stays dirty after failure and retries after a later change", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const statuses: SaveStatus[] = [];
    const coordinator = new SaveCoordinator({
      initialValue: { title: "Initial" },
      initialVersion: "v0",
      debounceMs: 50,
      onStatus: (status) => statuses.push(status),
      save: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("offline");
        return { updatedAt: "v1" };
      },
    });

    coordinator.change({ title: "First edit" });
    await coordinator.flush();
    expect(coordinator.isDirty()).toBe(true);
    expect(statuses.at(-1)).toBe("error");

    coordinator.change({ title: "Second edit" });
    await vi.advanceTimersByTimeAsync(50);
    expect(attempts).toBe(2);
    expect(coordinator.isDirty()).toBe(false);
    expect(statuses.at(-1)).toBe("saved");
  });

  it("retries the newest dirty snapshot with keepalive when pagehide queues behind a rejected normal save", async () => {
    const first = deferred<{ updatedAt: string }>();
    const second = deferred<{ updatedAt: string }>();
    const requests: Array<{
      value: { title: string };
      version: string;
      keepalive: boolean;
    }> = [];
    const coordinator = new SaveCoordinator({
      initialValue: { title: "Initial" },
      initialVersion: "v0",
      debounceMs: 10_000,
      save: (value, version, options) => {
        requests.push({ value, version, keepalive: options.keepalive });
        return requests.length === 1 ? first.promise : second.promise;
      },
    });
    const target = new EventTarget();
    const detach = attachSaveLifecycle(target, coordinator);

    coordinator.change({ title: "First edit" });
    const firstFlush = coordinator.flush();
    coordinator.change({ title: "Latest edit" });
    target.dispatchEvent(new Event("pagehide"));
    expect(requests).toHaveLength(1);

    first.reject(new Error("offline"));
    await firstFlush;
    expect(requests).toEqual([
      { value: { title: "First edit" }, version: "v0", keepalive: false },
      { value: { title: "Latest edit" }, version: "v0", keepalive: true },
    ]);

    second.resolve({ updatedAt: "v1" });
    await second.promise;
    await Promise.resolve();
    expect(coordinator.isDirty()).toBe(false);
    detach();
  });

  it("navigates only after a normal flush leaves the coordinator clean", async () => {
    const navigate = vi.fn();
    const dirtyCoordinator = {
      flush: vi.fn(async () => undefined),
      isDirty: vi.fn(() => true),
    };
    const cleanCoordinator = {
      flush: vi.fn(async () => undefined),
      isDirty: vi.fn(() => false),
    };

    await expect(
      flushBeforeNavigation(dirtyCoordinator, navigate),
    ).resolves.toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(dirtyCoordinator.flush).toHaveBeenCalledWith({ keepalive: false });

    await expect(
      flushBeforeNavigation(cleanCoordinator, navigate),
    ).resolves.toBe(true);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("warns before unload while dirty and flushes pagehide with keepalive", async () => {
    const calls: Array<{ keepalive: boolean }> = [];
    const coordinator = new SaveCoordinator({
      initialValue: { title: "Initial" },
      initialVersion: "v0",
      debounceMs: 10_000,
      save: async (_value, _version, options) => {
        calls.push(options);
        return { updatedAt: "v1" };
      },
    });
    const target = new EventTarget();
    const detach = attachSaveLifecycle(target, coordinator);

    const cleanEvent = new Event("beforeunload", { cancelable: true });
    target.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);

    coordinator.change({ title: "Dirty" });
    const dirtyEvent = new Event("beforeunload", { cancelable: true });
    target.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);
    target.dispatchEvent(new Event("pagehide"));
    await Promise.resolve();
    expect(calls).toEqual([{ keepalive: true }]);
    detach();
  });
});
