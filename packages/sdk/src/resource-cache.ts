export type ResourceLease<T> = { value: T; release: () => void; retain: () => ResourceLease<T> };

/** Keys are immutable source objects: a refreshed source is a new revision. */
export class ResourceCache<T extends { dispose(): void }> {
  private entries = new Map<object, Map<string, { value: T; references: number }>>();

  acquire(source: object, variant: string, create: () => T): ResourceLease<T> {
    let variants = this.entries.get(source);
    if (!variants) { variants = new Map(); this.entries.set(source, variants); }
    let entry = variants.get(variant);
    if (!entry) { entry = { value: create(), references: 0 }; variants.set(variant, entry); }
    entry.references += 1;
    let released = false;
    return {
      value: entry.value,
      retain: () => {
        if (released) throw new Error("Cannot retain a released resource lease.");
        return this.acquire(source, variant, () => entry.value);
      },
      release: () => {
        if (released) return;
        released = true;
        entry.references -= 1;
        if (entry.references) return;
        entry.value.dispose();
        variants.delete(variant);
        if (!variants.size) this.entries.delete(source);
      },
    };
  }

  get size() {
    let size = 0;
    this.entries.forEach((variants) => { size += variants.size; });
    return size;
  }
}
