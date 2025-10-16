import { Component, OnInit, ViewEncapsulation, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { DashboardHealthService, EndpointRow } from './dashboard-health.service';

type LatencySample = number;

@Component({
  selector: 'app-dashboard',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  imports: [CommonModule, MatCardModule, MatProgressBarModule, MatIconModule, MatButtonModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit {
  private health = inject(DashboardHealthService);

  // Loading
  loading = signal(true);
  error = signal<string | null>(null);

  // Data
  rows = signal<EndpointRow[]>([]);
  lastCheckedAt = signal<Date | null>(null);

  // Progress for sweep
  totalToCheck = signal(0);
  checkedSoFar = signal(0);
  inProgress   = computed(() => this.totalToCheck() > 0 && this.checkedSoFar() < this.totalToCheck());
  progressPct  = computed(() => this.totalToCheck() ? Math.round(this.checkedSoFar() / this.totalToCheck() * 100) : 0);

  // Metrics
  total   = computed(() => this.rows().length);
  up      = computed(() => this.rows().filter(r => r.status === 'UP').length);
  degraded= computed(() => this.rows().filter(r => r.status === 'DEGRADED').length);
  down    = computed(() => this.rows().filter(r => r.status === 'DOWN').length);

  successRate = computed(() => {
    const t = this.total();
    return t ? Math.round((this.up() / t) * 100) : 0;
  });

  // Latency metrics (ms)
  // ⬇️ made public so the template can read latencies().length
  latencies = signal<LatencySample[]>([]);

  avgLatency = computed(() => {
    const a = this.latencies();
    if (!a.length) return 0;
    return Math.round(a.reduce((s, x) => s + x, 0) / a.length);
    // Alternatively: Math.round(a.reduce((s,x)=>s+x)/a.length)
  });
  p95Latency = computed(() => {
    const a = this.latencies().slice().sort((x, y) => x - y);
    if (!a.length) return 0;
    const idx = Math.min(a.length - 1, Math.floor(0.95 * (a.length - 1)));
    return a[idx];
  });

  // Sparkline path for last sweep latencies
  sparkPath = computed(() => buildSparkPath(this.latencies(), 220, 40, 8));

  async ngOnInit() {
    try {
      this.loading.set(true);

      // 1) Load config and build rows (fast)
      const cfg = await this.health.loadAssets();
      const base = this.health.buildRows(cfg);
      this.rows.set(base);

      // 2) Kick off a health sweep (do not block first paint)
      this.runSweep(base);

    } catch (e: any) {
      this.error.set(e?.message ?? 'Failed to load configuration.');
    } finally {
      this.loading.set(false);
    }
  }

  refresh() { void this.runSweep(this.rows()); }

  private async runSweep(all: EndpointRow[], concurrency = 6) {
    this.totalToCheck.set(all.length);
    this.checkedSoFar.set(0);
    this.latencies.set([]);

    await parallelMap(all, concurrency, async (row) => {
      const updated = await this.health.check(row);
      this.rows.update(list => list.map(x => x.url === updated.url ? updated : x));
      if (updated.latencyMs != null) this.latencies.update(a => (a.push(updated.latencyMs!), a));
      this.checkedSoFar.update(n => n + 1);
    });

    this.lastCheckedAt.set(new Date());
  }
}

/* helpers */
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

/** Build an SVG path for a simple sparkline from an array of numbers. */
function buildSparkPath(values: number[], w: number, h: number, padX: number): string {
  if (!values.length) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const step = (w - padX * 2) / Math.max(1, values.length - 1);

  const points = values.map((v, i) => {
    const x = padX + i * step;
    const y = h - ((v - min) / span) * (h - 6) - 3;
    return [x, y];
  });

  let d = `M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i][0].toFixed(1)} ${points[i][1].toFixed(1)}`;
  }
  return d;
}
