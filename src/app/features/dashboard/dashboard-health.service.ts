import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

/* ── Types ─────────────────────────────────────────────────────── */

export type HealthStatus = 'UP' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';

export interface EnvConfig {
  /** e.g., "https://services-claims-qa.selective.com/claims/apis" (no trailing slash required) */
  base: string;
  // You can extend later with headers, timeouts, etc.
}

export interface AssetsConfig {
  /** Optional map of environment name → base URL */
  environments?: Record<string, EnvConfig>;
  /** Endpoint list; supports both legacy (absolute url) and new (env+path) styles */
  endpoints: EndpointConfig[];
}

export interface EndpointConfig {
  name: string;
  method: 'GET'|'POST'|'PUT'|'DELETE'|'PATCH'|'HEAD';
  /** Legacy/override: if absolute, this takes precedence and is used as-is */
  url?: string;
  /** New compact style: environment + path are combined with environments[env].base */
  environment?: string;
  path?: string;
}

export interface EndpointRow {
  name: string;
  method: string;
  url: string;            // resolved absolute URL used for checks
  status: HealthStatus;
  latencyMs?: number;
}

/** Rich result for dialog/history */
export interface DetailedCheck {
  url: string;
  method: string;
  status: HealthStatus;
  latencyMs: number;
  httpCode: number;                 // -1 if unknown
  headers: Record<string, string>;  // small readable subset
  at: string;                       // ISO timestamp
}

/* ── Service ───────────────────────────────────────────────────── */

@Injectable({ providedIn: 'root' })
export class DashboardHealthService {
  private worker: Worker | null = null;

  /** Keep last 5 checks per URL (in-memory) */
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

  /**
   * Build resolved rows from config:
   * - Accepts both new (env + path) and legacy (full url) shapes
   * - Row-level absolute `url` overrides env base
   */
  buildRows(cfg: AssetsConfig): EndpointRow[] {
    const envs = cfg.environments ?? {};
    const rows: EndpointRow[] = [];

    for (const e of cfg.endpoints ?? []) {
      const resolved = this.resolveEndpointUrl(e, envs);
      if (!resolved) {
        console.warn('[health] invalid endpoint config skipped:', e);
        continue;
      }
      rows.push({
        name: e.name,
        method: e.method,
        url: resolved,
        status: 'UNKNOWN'
      });
    }
    return rows;
  }

  /** Fast status check used by dashboard/API grid */
  check(row: EndpointRow): Promise<EndpointRow> {
    if (!this.worker) return this.checkInMainThread(row);
    return this.checkWithWorker(row, this.worker);
  }

  /** Detailed check (for dialog): captures HTTP code + a few headers */
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

      const wanted = ['content-type', 'date', 'server', 'cache-control'];
      res.headers.forEach((v, k) => {
        if (wanted.includes(k.toLowerCase())) headers[k] = v;
      });

      const ms = Math.round(performance.now() - start);

      if (!res.ok) status = 'DOWN';
      else status = ms > 1200 ? 'DEGRADED' : 'UP';

      const entry: DetailedCheck = { url, method, status, latencyMs: ms, httpCode, headers, at: new Date().toISOString() };
      this.pushHistory(url, entry);
      return entry;
    } catch {
      const ms = Math.round(performance.now() - start);
      const entry: DetailedCheck = { url, method, status: 'DOWN', latencyMs: ms, httpCode, headers: {}, at: new Date().toISOString() };
      this.pushHistory(url, entry);
      return entry;
    }
  }

  /** Return last 5 checks (most recent first) */
  getHistory(url: string): DetailedCheck[] {
    return this.history.get(url) ?? [];
  }

  /* ── Internals ───────────────────────────────────────────────── */

  private resolveEndpointUrl(e: EndpointConfig, envs: Record<string, EnvConfig>): string | null {
    // 1) Absolute URL override (or legacy style)
    if (e.url && isAbsoluteUrl(e.url)) {
      return e.url;
    }

    // 2) New compact: environment + path
    if (e.environment && e.path) {
      const env = envs[e.environment];
      if (!env?.base) return null;
      return joinUrl(env.base, e.path);
    }

    // 3) If url exists but is relative (rare), attempt env join if possible
    if (e.url && !isAbsoluteUrl(e.url) && e.environment) {
      const env = envs[e.environment];
      if (!env?.base) return null;
      return joinUrl(env.base, e.url);
    }

    // Not enough info to resolve
    return null;
  }

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

/* ── URL helpers ───────────────────────────────────────────────── */

function isAbsoluteUrl(u: string): boolean {
  return /^https?:\/\//i.test(u);
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '');                 // trim trailing slashes
  const p = path.startsWith('/') ? path : '/' + path; // ensure leading slash
  return b + p;
}
