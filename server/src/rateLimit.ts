interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimiter {
  /** Segundos hasta que la clave vuelva a tener cupo, o 0 si todavía puede seguir. */
  retryAfter(key: string): number;
  record(key: string): void;
  reset(key: string): void;
}

/** Ventana fija en memoria. Las claves vencidas se limpian solas para que el mapa no crezca sin límite. */
export function createRateLimiter(max: number, windowMs: number, now: () => number = Date.now): RateLimiter {
  const buckets = new Map<string, Bucket>();
  let nextPrune = 0;

  const prune = (time: number) => {
    if (time < nextPrune) return;
    nextPrune = time + windowMs;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= time) buckets.delete(key);
    }
  };

  const current = (key: string, time: number) => {
    const bucket = buckets.get(key);
    return bucket && bucket.resetAt > time ? bucket : undefined;
  };

  return {
    retryAfter(key) {
      const time = now();
      const bucket = current(key, time);
      if (!bucket || bucket.count < max) return 0;
      return Math.max(1, Math.ceil((bucket.resetAt - time) / 1000));
    },
    record(key) {
      const time = now();
      prune(time);
      const bucket = current(key, time) ?? { count: 0, resetAt: time + windowMs };
      bucket.count += 1;
      buckets.set(key, bucket);
    },
    reset(key) {
      buckets.delete(key);
    },
  };
}
