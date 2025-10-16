/// <reference lib="webworker" />

// Simple worker that does a quick check (status + latency)
// It does NOT expose headers or HTTP code (those are captured in detailedCheck on main thread)

addEventListener('message', async ({ data }) => {
  const { id, method, url } = data as { id: string; method: string; url: string };

  const start = performance.now();
  let status: 'UP'|'DEGRADED'|'DOWN' = 'DOWN';
  let latencyMs = 0;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, { method, signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);

    latencyMs = Math.round(performance.now() - start);

    if (!res.ok) {
      status = 'DOWN';
    } else {
      status = latencyMs > 1200 ? 'DEGRADED' : 'UP';
    }
  } catch {
    latencyMs = Math.round(performance.now() - start);
    status = 'DOWN';
  }

  postMessage({ id, status, latencyMs });
});
