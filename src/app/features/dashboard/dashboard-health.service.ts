import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

/* ── Types ─────────────────────────────────────────────────────── */

export type HealthStatus = 'UP' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';

export interface EnvConfig {
  /** e.g., "/qa-api/claims/api" OR "https://services-claims-qa.selective.com/claims/api" */
  base: string;
}

export interface AssetsConfig {
  environments?: Record<string, EnvConfig>;
  endpoints: EndpointConfig[];
}

/** NEW: supports multiple shapes */
export interface EndpointConfig {
  /** Display name (can be overridden per-env in targets[]) */
  name: string;
  /** Default method (can be overridden per-env in targets[]) */
  method: 'GET'|'POST'|'PUT'|'DELETE'|'PATCH'|'HEAD';

  /** Legacy/single-env */
  environment?: string;   // single env
  path?: string;          // joined with env base
  url?: string;           // absolute or relative to env base (legacy override)

  /** Multi-env (shared path across envs) */
  environments?: string[];  // multiple env names

  /** Per-env overrides (most flexible) */
  targets?: Array<{
    environment: string;
    path?: string;        // overrides parent path
    url?: string;         // absolute or relative to env base
    name?: string;        // override display name for this env
    method?: EndpointConfig['method']; // override method
  }>;
}

export interface EndpointRow {
  name: string;
  method: string;
  url: string;            // resolved absolute (or proxied) URL
  environment: string;    // env label for UI
  status: HealthStatus;
  latencyMs?: number;
}

export interface DetailedCheck {
  url: string;
  method: string;
  status: HealthStatus;
  latencyMs: number;
  httpCode: number;
  headers: Record<string, string>;
  at: string;
}

/* ── Service ───────────────────────────────────────────────────── */

@Injectable({ providedIn: 'root' })
export class DashboardHealthService {
  private worker: Worker | null = null;
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

  async loadAssets(): Promise<AssetsConfig> {
    return this.http.get<AssetsConfig>('assets/apis.json').toPromise() as Promise<AssetsConfig>;
  }

  /**
   * Build table rows from config.
   * Supports:
   *  - legacy single env: environment+path OR absolute url
   *  - multi env: environments[] + path
   *  - per-env overrides: targets[]
   */
  buildRows(cfg: AssetsConfig): EndpointRow[] {
    const envs = cfg.environments ?? {};
    const rows: EndpointRow[] = [];
    const seen = new Set<string>(); // dedupe by method|url

    for (const e of cfg.endpoints ?? []) {
      // 1) Per-env targets (highest flexibility)
      if (Array.isArray(e.targets) && e.targets.length) {
        for (const t of e.targets) {
          const name = t.name ?? e.name;
          const method = t.method ?? e.method;
          const resolved = resolveUrl({ url: t.url, path: t.path ?? e.path, environment: t.environment }, envs, name);
          if (!resolved) continue;
          const key = `${method}|${resolved}`;
          if (seen.has(key)) continue; seen.add(key);
          rows.push({
            name,
            method,
            url: resolved,
            environment: t.environment,
            status: 'UNKNOWN'
          });
        }
        continue;
      }

      // 2) Multi-env shared path
      if (Array.isArray(e.environments) && e.environments.length) {
        for (const envName of e.environments) {
          const resolved = resolveUrl({ url: e.url, path: e.path, environment: envName }, envs, e.name);
          if (!resolved) continue;
          const key = `${e.method}|${resolved}`;
          if (seen.has(key)) continue; seen.add(key);
          rows.push({
            name: e.name,
            method: e.method,
            url: resolved,
            environment: envName,
            status: 'UNKNOWN'
          });
        }
        continue;
      }

      // 3) Legacy/single env or absolute URL
      const envName = e.environment ?? '';
      const resolved = resolveUrl({ url: e.url, path: e.path, environment: envName }, envs, e.name);
      if (!resolved) continue;
      const key = `${e.method}|${resolved}`;
      if (seen.has(key)) continue; seen.add(key);
      rows.push({
        name: e.name,
        method: e.method,
        url: resolved,
        environment: envName || inferEnvironment(resolved, envs),
        status: 'UNKNOWN'
      });
    }

    return rows;
  }

  check(row: EndpointRow): Promise<EndpointRow> {
    if (!this.worker) return this.checkInMainThread(row);
    return this.checkWithWorker(row, this.worker);
  }

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
      res.headers.forEach((v, k) => { if (wanted.includes(k.toLowerCase())) headers[k] = v; });

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

  getHistory(url: string): DetailedCheck[] {
    return this.history.get(url) ?? [];
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

function isAbsoluteUrl(u?: string): u is string {
  return !!u && /^https?:\/\//i.test(u);
}

function normalizeBase(b: string): string {
  return b.replace(/\/+$/, '');
}

function joinUrl(base: string, path?: string): string {
  const b = normalizeBase(base);
  const p = !path ? '' : (path.startsWith('/') ? path : '/' + path);
  return b + p;
}

function stripBasePrefix(base: string, p?: string): string | undefined {
  if (typeof p !== 'string' || p.length === 0) return p;

  // Work on a guaranteed string
  const s = p;

  // Absolute URLs passed via `path` should be treated as full URLs
  if (/^https?:\/\//i.test(s)) return s;

  // Normalize base
  const normBase = normalizeBase(base);

  // Try URL parsing first (works for absolute bases)
  try {
    const b = new URL(normBase);
    // Ensure base pathname ends with a single slash for comparison
    const basePath = b.pathname.endsWith('/') ? b.pathname : b.pathname + '/';
    const rel = s.startsWith('/') ? s : '/' + s;
    return rel.startsWith(basePath) ? rel.slice(basePath.length - 1) : rel;
  } catch {
    // Fallback when base is a relative proxy path like "/qa-api/claims/api"
    const basePath = normBase; // already trimmed of trailing slash
    const rel = s.startsWith('/') ? s : '/' + s;
    return rel.startsWith(basePath) ? rel.slice(basePath.length) || '/' : rel;
  }
}


function resolveUrl(
  src: { url?: string; path?: string; environment?: string },
  envs: Record<string, EnvConfig>,
  nameForWarn: string
): string | null {
  // absolute URL wins (legacy override)
  if (isAbsoluteUrl(src.url)) return src.url;

  // absolute path mistakenly placed in `path` → treat as url
  if (isAbsoluteUrl(src.path)) return src.path!;

  // env + (url relative) or path
  if (src.environment) {
    const env = envs[src.environment];
    if (!env?.base) {
      console.warn(`[health] row "${nameForWarn}": environment "${src.environment}" has no base.`);
      return null;
    }
    const rel = src.url ? stripBasePrefix(env.base, src.url) : stripBasePrefix(env.base, src.path);
    return joinUrl(env.base, rel);
  }

  // only relative url or path with no environment → cannot resolve
  if (src.url || src.path) {
    console.warn(`[health] row "${nameForWarn}": missing environment to resolve relative URL/path.`);
  }
  return null;
}

function inferEnvironment(url: string, envs: Record<string, EnvConfig>): string {
  try {
    // Try exact base match first
    const href = url;
    for (const [name, env] of Object.entries(envs)) {
      const base = normalizeBase(env.base);
      if (href.startsWith(base)) return name;
    }
    // Heuristics from hostname for absolute URLs
    if (isAbsoluteUrl(url)) {
      const host = new URL(url).hostname.toLowerCase();
      if (host.includes('dev')) return 'Development';
      if (host.includes('qa') || host.includes('test')) return 'Test';
      if (host.includes('stg') || host.includes('stage') || host.includes('staging')) return 'Staging';
      if (host.includes('prod')) return 'Production';
    }
    return 'Unknown';
  } catch {
    return 'Unknown';
  }
}
