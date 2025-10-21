import { Component, OnInit, computed, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';

import { DashboardHealthService, EndpointRow, HealthStatus } from '../dashboard/dashboard-health.service';
import { ApiDetailsDialogComponent } from './api-details.dialog';

type ViewRow = EndpointRow & { baseUrl: string; path: string };

@Component({
  selector: 'app-api',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatProgressBarModule,
    MatDialogModule
  ],
  templateUrl: './api.component.html',
  styleUrls: ['./api.component.scss']
})
export class ApiComponent implements OnInit {
  private svc = inject(DashboardHealthService);
  private dialog = inject(MatDialog);

  // data + ui state
  private _rows = signal<EndpointRow[]>([]);
  loadingCfg = signal<boolean>(true);
  error = signal<string | null>(null);

  // search
  private _query = signal<string>('');

  // progress (bulk refresh)
  inProgress = signal<boolean>(false);
  private _done = signal<number>(0);
  private _total = signal<number>(0);

  lastCheckedAt = signal<Date | null>(null);

  // expose search value to template (uses query())
  query() { return this._query(); }

  // build view rows (adds baseUrl/path & applies search filter)
  filteredRows = computed<ViewRow[]>(() => {
    const q = this._query().toLowerCase().trim();
    const rows = this._rows();

    const mapped: ViewRow[] = rows.map(r => {
      const { baseUrl, path } = splitUrl(r.url);
      return { ...r, baseUrl, path };
    });

    if (!q) return mapped;

    return mapped.filter(r =>
      (r.name?.toLowerCase().includes(q)) ||
      (r.environment?.toLowerCase().includes(q)) ||
      (r.url?.toLowerCase().includes(q)) ||
      (r.method?.toLowerCase().includes(q))
    );
  });

  // summary tiles
  upCount = computed(() => this._rows().filter(r => r.status === 'UP').length);
  degradedCount = computed(() => this._rows().filter(r => r.status === 'DEGRADED').length);
  downCount = computed(() => this._rows().filter(r => r.status === 'DOWN').length);
  totalCount = computed(() => this._rows().length);

  progressPct() {
    const done = this._done();
    const total = this._total();
    return total > 0 ? Math.round((done / total) * 100) : 0;
  }

  ngOnInit(): void {
    this.svc.loadAssets()
      .then(cfg => {
        const rows = this.svc.buildRows(cfg);
        this._rows.set(rows);

        // Kick off initial health checks in parallel
        this.bulkRefresh(rows);
      })
      .catch(err => {
        this.error.set(err?.message ?? 'Failed to load assets/apis.json');
      })
      .finally(() => this.loadingCfg.set(false));
  }

  onQuery(value: string) {
    this._query.set((value || '').toLowerCase().trim());
  }

  // open details dialog
  openDetails(row: EndpointRow) {
    this.dialog.open(ApiDetailsDialogComponent, {
      data: {
        name: row.name,
        method: row.method,
        url: row.url,
        environment: row.environment,
        status: row.status,
        latencyMs: row.latencyMs
      },
      panelClass: 'api-details-panel',
      autoFocus: false,
      width: '720px',
      maxWidth: '95vw'
    });
  }

  // open endpoint in new tab
  open(row: EndpointRow) {
    window.open(row.url, '_blank', 'noopener,noreferrer');
  }

  // retry a single row
  async retryRow(row: EndpointRow) {
    try {
      const updated = await this.svc.check(row);
      const next = this._rows().map(r => (r.url === updated.url && r.method === updated.method) ? updated : r);
      this._rows.set(next);
      this.lastCheckedAt.set(new Date());
    } catch {
      // ignore
    }
  }

  // refresh all rows and show progress
  async refreshAll() {
    await this.bulkRefresh(this._rows());
  }

  private async bulkRefresh(rows: EndpointRow[]) {
    this.inProgress.set(true);
    this._done.set(0);
    this._total.set(rows.length);

    await Promise.all(rows.map(async r => {
      try {
        const updated = await this.svc.check(r);
        const next = this._rows().map(x => (x.url === updated.url && x.method === updated.method) ? updated : x);
        this._rows.set(next);
      } finally {
        this._done.update(n => n + 1);
      }
    }));

    this.lastCheckedAt.set(new Date());
    this.inProgress.set(false);
  }

  // status pill class (matches your older style)
  statusClass(s: HealthStatus) {
    return {
      ok: s === 'UP',
      warn: s === 'DEGRADED',
      down: s === 'DOWN'
    };
  }
}

/** Split an absolute or proxied URL into baseUrl + path for display */
function splitUrl(full: string): { baseUrl: string; path: string } {
  try {
    // Handles absolute URLs like "https://host/path?x=y"
    const u = new URL(full, window.location.origin);
    return { baseUrl: `${u.origin}`, path: `${u.pathname}${u.search || ''}` };
  } catch {
    // For same-origin proxy paths like "/qa-api/claims/api/..." (no origin)
    if (full.startsWith('/')) {
      const idx = full.indexOf('/', 1);
      if (idx > 0) {
        // prefix as "base", remainder as path
        const prefix = full.substring(0, idx);
        const rest = full.substring(idx);
        return { baseUrl: prefix, path: rest };
      }
      return { baseUrl: '/', path: full };
    }
    // Fallback: entire string as path
    return { baseUrl: '', path: full };
  }
}
