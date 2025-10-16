import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export type HealthStatus = 'UP' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';

export interface EndpointConfig {
  name: string;
  method: 'GET'|'POST'|'PUT'|'DELETE'|'PATCH'|'HEAD';
  url: string;
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

@Injectable({ providedIn: 'root' })
export class DashboardHealthService {
  /** Worker if supported; null when not available (SSR, old browsers, etc.) */
  private worker: Worker | null = null;

  constructor(private http: HttpClient) {
    try {
      // Guard for environments without Worker (SSR/SSG or disabled)
      if (typeof Worker !== 'undefined') {
        // @ts-ignore URL constructor is supported by Angular builder
        this.worker = new Worker(new URL('./dashboard-health.worker', import.meta.url), { type: 'module' });
      }
    } catch {
      this.worker = null;
    }
  }

  async loadAssets(): Promise<AssetsConfig> {
    // expects src/assets/apis.json
    return this.http.get<AssetsConfig>('assets/apis.json').toPromise() as Promise<AssetsConfig>;
  }

  buildRows(cfg: AssetsConfig): EndpointRow[] {
    return (cfg.endpoints ?? []).map(e => ({
      name: e.name,
      method: e.method,
      url: e.url,
      status: 'UNKNOWN'
    }));
  }

  /** Public check that uses a worker when available, else falls back to main thread. */
  check(row: EndpointRow): Promise<EndpointRow> {
    if (!this.worker) {
      return this.checkInMainThread(row);
    }
    return this.checkWithWorker(row, this.worker);
  }

  /** Worker-backed health check (no undefined access). */
  private checkWithWorker(row: EndpointRow, worker: Worker): Promise<EndpointRow> {
    return new Promise<EndpointRow>((resolve) => {
      const id = `${row.method}:${row.url}:${Date.now()}:${Math.random()}`;
      const onMsg = (ev: MessageEvent) => {
        const data = ev.data as any;
        if (!data || data.id !== id) return;
        worker.removeEventListener('message', onMsg);
        resolve({
          ...row,
          status: data.status as HealthStatus,
          latencyMs: data.latencyMs
        });
      };
      worker.addEventListener('message', onMsg);
      worker.postMessage({ id, method: row.method, url: row.url });
    });
  }

  /** Fallback when Worker is not available (runs fetch on main thread). */
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
