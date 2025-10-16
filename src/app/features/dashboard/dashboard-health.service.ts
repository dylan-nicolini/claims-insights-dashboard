import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export type HealthStatus = 'UP' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';

export interface EndpointConfig {
  name: string;
  method: 'GET'|'POST'|'PUT'|'DELETE'|'PATCH'|'HEAD';
  url: string;
  environment?: string;
}

export interface AssetsConfig {
  endpoints: EndpointConfig[];
}

export interface EndpointRow {
  name: string;
  method: string;
  url: string;
  status: HealthStatus;
  latencyMs?: number;
}

/** Rich result used in the details dialog and history */
export interface DetailedCheck {
  url: string;
  method: string;
  status: HealthStatus;
  latencyMs: number;
  /** HTTP status code when available (e.g., 200, 503). -1 if unavailable. */
  httpCode: number;
  /** A trimmed, readable subset of headers. */
  headers: Record<string, string>;
  /** ISO timestamp of the measurement */
  at: string;
}

@Injectable({ providedIn: 'root' })
export class DashboardHealthService {
  private worker: Worker | null = null;

  /** Keep last 5 checks per URL (ring buffer behavior) */
  private history = new Map<string, DetailedCheck[]>();

  constructor(private http: HttpClient) {
    try {
      if (typeof Worker !== 'undefined') {
        // @ts-ignore
        this.worker = new Worker(new URL('./dashboard-health.worker', import.meta.url), { type: 'module' });
      }
    } catch {
      this.worker = null;
    }
  }

  /** Load endpoints JSON from assets */
  async loadAssets(): Promise<AssetsConfig> {
    return this.http.get<AssetsConfig>('assets/apis.json').toPromise() as Promise<AssetsConfig>;
  }

  /** Build base rows for the table */
  buildRows(cfg: AssetsConfig): EndpointRow[] {
    return (cfg.endpoints ?? []).map(e => ({
      name: e.name,
      method: e.method,
      url: e.url,
      status: 'UNKNOWN'
    }));
  }

  /**
   * Fast status check used by the table sweep (uses worker if available).
   * Returns only status + latency.
   */
  check(row: EndpointRow): Promise<EndpointRow> {
    if (!this.worker) return this.checkInMainThread(row);
    return this.checkWithWorker(row, this.worker);
  }

  /**
   * Detailed check run from the dialog to capture httpCode + headers.
   * Always runs in the main thread (so we can access headers).
   */
  async detailedCheck(method: string, url: string, timeoutMs = 15000): Promise<DetailedCheck> {
    const start = performance.now();
    let httpCode = -1;
    let headers: Record<string, string> = {};
    let status: HealthStatus = 'DOWN';

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { method, signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timer);

      httpCode = res.status;

      // Collect a tiny, readable set of headers
      const wanted = ['content-type', 'date', 'server', 'cache-control'];
      res.headers.forEach((v, k) => {
        if (wanted.includes(k.toLowerCase())) headers[k] = v;
      });

      const ms = Math.round(performance.now() - start);

      if (!res.ok) {
        status = 'DOWN';
      } else {
        status = ms > 1200 ? 'DEGRADED' : 'UP';
      }

      const entry: DetailedCheck = {
        url, method, status, latencyMs: ms,
        httpCode, headers,
        at: new Date().toISOString()
      };
      this.pushHistory(url, entry);
      return entry;

    } catch {
      const ms = Math.round(performance.now() - start);
      const entry: DetailedCheck = {
        url, method, status: 'DOWN', latencyMs: ms,
        httpCode, headers: {},
        at: new Date().toISOString()
      };
      this.pushHistory(url, entry);
      return entry;
    }
  }

  /** Return most-recent-first history (up to 5) for a given URL */
  getHistory(url: string): DetailedCheck[] {
    return this.history.get(url) ?? [];
  }

  /* ── internals ───────────────────────────────────────────────────────── */

  private pushHistory(url: string, entry: DetailedCheck) {
    const list = this.history.get(url) ?? [];
    list.unshift(entry);
    if (list.length > 5) list.length = 5;
    this.history.set(url, list);
  }

  private checkWithWorker(row: EndpointRow, worker: Worker): Promise<EndpointRow> {
    return new Promise<EndpointRow>((resolve) => {
      const id = `${row.method}:${row.url}:${Date.now()}:${Math.random()}`;
      const onMsg = (ev: MessageEvent) => {
        const data = ev.data as any;
        if (!data || data.id !== id) return;
        worker.removeEventListener('message', onMsg);
        resolve({ ...row, status: data.status as HealthStatus, latencyMs: data.latencyMs });
      };
      worker.addEventListener('message', onMsg);
      worker.postMessage({ id, method: row.method, url: row.url });
    });
  }

  private async checkInMainThread(row: EndpointRow): Promise<EndpointRow> {
    const start = performance.now();
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(row.url, { method: row.method, signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timeout);
      const ms = Math.round(performance.now() - start);

      let status: HealthStatus = 'UP';
      if (!res.ok) status = 'DOWN';
      else if (ms > 1200) status = 'DEGRADED';

      return { ...row, status, latencyMs: ms };
    } catch {
      const ms = Math.round(performance.now() - start);
      return { ...row, status: 'DOWN', latencyMs: ms };
    }
  }
}
