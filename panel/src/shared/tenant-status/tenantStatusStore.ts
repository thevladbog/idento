type Listener = () => void;

let suspended = false;
const listeners = new Set<Listener>();

export const tenantStatusStore = {
  isSuspended(): boolean {
    return suspended;
  },
  setSuspended(value: boolean): void {
    if (value === suspended) return;
    suspended = value;
    for (const listener of listeners) listener();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
