// Web Worker: fetch each endpoint and measure latency.
// NOTE: This runs in a worker context (no DOM).

type WorkerRequest = { id: string; method: string; url: string };
type HealthStatus = 'UP'|'DEGRADED'|'DOWN'|'UNKNOWN';

self.addEventListener('message', async (ev: MessageEvent<WorkerRequest>) => {
  const { id, method, url } = ev.data;
  const start = performance.now();
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15000); // 15s hard timeout
    const res = await fetch(url, { method, signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timeout);
    const ms = Math.round(performance.now() - start);

    let status: HealthStatus = 'UP';
    if (!res.ok) status = 'DOWN';
    else if (ms > 1200) status = 'DEGRADED';

    (self as any).postMessage({ id, status, latencyMs: ms });
  } catch {
    const ms = Math.round(performance.now() - start);
    (self as any).postMessage({ id, status: 'DOWN', latencyMs: ms });
  }
});
