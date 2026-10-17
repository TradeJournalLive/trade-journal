// Bounded process-local cache: coalesce duplicate reads; never cache failures.
export function createPremiumCache<T>(ttl: number, limit = 128) {
  const values = new Map<string, { value: T; until: number }>();
  const pending = new Map<string, Promise<T>>();
  return async (key: string, load: () => Promise<T>, now = Date.now()) => {
    const saved = values.get(key);
    if (saved && saved.until > now) return saved.value;
    const existing = pending.get(key); if (existing) return existing;
    const request = load().then(value => {
      values.delete(key); values.set(key, { value, until: Date.now() + ttl });
      while (values.size > limit) values.delete(values.keys().next().value!);
      return value;
    }).finally(() => pending.delete(key));
    pending.set(key, request); return request;
  };
}
