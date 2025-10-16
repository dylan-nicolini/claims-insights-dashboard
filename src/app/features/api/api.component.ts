import { Component, OnInit, computed, signal, effect, inject, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatChipsModule } from '@angular/material/chips';
import { DashboardHealthService, EndpointRow, HealthStatus } from '../dashboard/dashboard-health.service';

type ApiRow = EndpointRow & { baseUrl: string; path: string; environment: string };

@Component({
  selector: 'app-api',
  standalone: true,
  encapsulation: ViewEncapsulation.None, // ensure our SCSS overrides MDC when needed
  imports: [
    CommonModule,
    MatCardModule, MatTableModule,
    MatFormFieldModule, MatInputModule,
    MatIconModule, MatButtonModule, MatTooltipModule,
    MatProgressBarModule, MatChipsModule
  ],
  templateUrl: './api.component.html',
  styleUrls: ['./api.component.scss'],
})
export class ApiComponent implements OnInit {
  private health = inject(DashboardHealthService);

  // page/config
  loadingCfg = signal(true);
  error = signal<string | null>(null);

  // data
  rows = signal<ApiRow[]>([]);
  lastCheckedAt = signal<Date | null>(null);

  // search
  query = signal<string>('');

  // progress
  totalToCheck = signal(0);
  checkedSoFar = signal(0);
  inProgress = computed(() => this.totalToCheck() > 0 && this.checkedSoFar() < this.totalToCheck());
  progressPct = computed(() => this.totalToCheck() ? Math.round(this.checkedSoFar() / this.totalToCheck() * 100) : 0);

  // derived
  filteredRows = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.rows();
    return this.rows().filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.baseUrl.toLowerCase().includes(q) ||
      r.path.toLowerCase().includes(q) ||
      r.method.toLowerCase().includes(q)
    );
  });

  // summary tiles
  upCount       = computed(() => this.filteredRows().filter(r => r.status === 'UP').length);
  degradedCount = computed(() => this.filteredRows().filter(r => r.status === 'DEGRADED').length);
  downCount     = computed(() => this.filteredRows().filter(r => r.status === 'DOWN').length);
  totalCount    = computed(() => this.filteredRows().length);

  async ngOnInit() {
    try {
      this.loadingCfg.set(true);

      // 1) Load config and build rows (FAST). Render immediately.
      const cfg = await this.health.loadAssets();
      const base = this.health.buildRows(cfg);
      const enriched: ApiRow[] = base.map(r => {
        const u = parseUrl(r.url);
        return { ...r, baseUrl: u.base, path: u.path, environment: u.env ?? 'Production' };
      });

      this.rows.set(enriched);
      this.loadingCfg.set(false);     // <-- let Angular paint the table NOW

      // 2) Start health checks in the background (do NOT await)
      this.runHealthSweep(enriched);  // <-- fire-and-forget

    } catch (e: any) {
      this.error.set(e?.message ?? 'Failed to load API configuration.');
      this.loadingCfg.set(false);
    }
  }

  async runHealthSweep(all: ApiRow[], concurrency = 6) {
    this.totalToCheck.set(all.length);
    this.checkedSoFar.set(0);

    await parallelMap(all, concurrency, async (row) => {
      const updated = await this.health.check(row);
      this.rows.update(list =>
        list.map(x => x.url === updated.url ? { ...x, status: updated.status, latencyMs: updated.latencyMs } : x)
      );
      this.checkedSoFar.update(n => n + 1);
    });

    this.lastCheckedAt.set(new Date());
  }

  // UI handlers
  onQuery(v: string) { this.query.set(v); }
  refreshAll() { void this.runHealthSweep(this.rows()); }
  retryRow(r: ApiRow) { void this.runHealthSweep([r], 1); }
  open(r: ApiRow) { window.open(r.url, '_blank', 'noopener'); }
}

/* helpers */
function parseUrl(full: string): { base: string; path: string; env?: string } {
  try {
    const u = new URL(full);
    const base = `${u.protocol}//${u.host}`;
    const path = u.pathname + (u.search || '');
    const host = u.host.toLowerCase();
    let env: string | undefined;
    if (host.includes('dev')) env = 'Development';
    else if (host.includes('test')) env = 'Test';
    else if (host.includes('staging') || host.includes('stg')) env = 'Staging';
    return { base, path, env };
  } catch {
    const i = full.indexOf('/', 8);
    return { base: i > 0 ? full.slice(0, i) : full, path: i > 0 ? full.slice(i) : '/' };
  }
}

async function parallelMap<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  const q = [...items];
  const runners: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, q.length); i++) {
    runners.push((async function run() {
      while (q.length) {
        const next = q.shift()!;
        try { await worker(next); } catch {}
      }
    })());
  }
  await Promise.all(runners);
}

