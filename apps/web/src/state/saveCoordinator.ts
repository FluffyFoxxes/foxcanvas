export type SaveStatus = "saved" | "saving" | "unsaved" | "error" | "conflict";
export type SaveOptions = { keepalive: boolean };

type CoordinatorOptions<T> = {
  initialValue: T;
  initialVersion: string;
  debounceMs: number;
  save: (
    value: T,
    version: string,
    options: SaveOptions,
  ) => Promise<{ updatedAt: string }>;
  onStatus?: (status: SaveStatus) => void;
  onDirtySnapshot?: (value: T, baseVersion: string) => void;
  statusForError?: (
    error: unknown,
  ) => Extract<SaveStatus, "error" | "conflict">;
};

export class SaveCoordinator<T> {
  private currentValue: T;
  private revision = 0;
  private savedRevision = 0;
  private version: string;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private queuedKeepalive = false;

  constructor(private readonly options: CoordinatorOptions<T>) {
    this.currentValue = options.initialValue;
    this.version = options.initialVersion;
  }

  change(value: T) {
    this.currentValue = value;
    this.revision += 1;
    this.options.onStatus?.("unsaved");
    this.options.onDirtySnapshot?.(this.currentValue, this.version);
    this.schedule();
  }

  isDirty() {
    return this.revision !== this.savedRevision;
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.options.debounceMs);
  }

  async flush(options: Partial<SaveOptions> = {}) {
    const saveOptions: SaveOptions = { keepalive: options.keepalive ?? false };
    if (!this.isDirty()) return;
    if (this.inFlight) {
      this.queuedKeepalive ||= saveOptions.keepalive;
      await this.inFlight;
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    const revision = this.revision;
    const value = this.currentValue;
    const version = this.version;
    let succeeded = false;
    this.options.onStatus?.("saving");
    this.inFlight = (async () => {
      try {
        const result = await this.options.save(value, version, saveOptions);
        this.version = result.updatedAt;
        this.savedRevision = revision;
        succeeded = true;
        this.options.onStatus?.(this.isDirty() ? "unsaved" : "saved");
        if (this.isDirty())
          this.options.onDirtySnapshot?.(this.currentValue, this.version);
      } catch (error) {
        this.options.onStatus?.(
          this.options.statusForError?.(error) ?? "error",
        );
      }
    })();

    await this.inFlight;
    this.inFlight = undefined;
    const keepalive = this.queuedKeepalive;
    this.queuedKeepalive = false;
    if (this.isDirty() && (succeeded || keepalive)) {
      void this.flush({ keepalive });
    }
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

type NavigationCoordinator = Pick<
  SaveCoordinator<unknown>,
  "isDirty" | "flush"
>;

export async function flushBeforeNavigation(
  coordinator: NavigationCoordinator,
  navigate: () => void,
) {
  await coordinator.flush({ keepalive: false });
  if (coordinator.isDirty()) return false;
  navigate();
  return true;
}

export function attachSaveLifecycle(
  target: EventTarget,
  coordinator: Pick<SaveCoordinator<unknown>, "isDirty" | "flush">,
) {
  const beforeUnload = (event: Event) => {
    if (!coordinator.isDirty()) return;
    event.preventDefault();
    event.returnValue = true;
  };
  const pageHide = () => {
    if (coordinator.isDirty()) void coordinator.flush({ keepalive: true });
  };
  target.addEventListener("beforeunload", beforeUnload);
  target.addEventListener("pagehide", pageHide);
  return () => {
    target.removeEventListener("beforeunload", beforeUnload);
    target.removeEventListener("pagehide", pageHide);
  };
}
