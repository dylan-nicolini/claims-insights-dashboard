import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DashboardHealthService, EndpointRow, HealthStatus } from '../dashboard/dashboard-health.service';

type ApiRow = EndpointRow & {
  baseUrl: string;
  path: string;
  environment: string;
};

@Component({
  selector: 'app-api',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule, MatTableModule,
    MatFormFieldModule, MatSelectModule,
    MatIconModule, MatButtonModule, MatTooltipModule
  ],
  templateUrl: './api.component.html',
  styleUrls: ['./api.component.scss'],
})
export class ApiComponent implements OnInit {

  loading = signal(true);
  error   = signal<string | null>(null);

  // All rows loaded from assets + enriched with baseUrl/path/environment
  rows = signal<ApiRow[]>([]);

  // UI state
  environment = signal<string>('Production');
  lastCheckedAt = signal<Date | null>(null);

  // Derive environment list from assets; fallback to “Production”
  environments = computed(() => {
    const set = new Set<string>();
    for (const r of this.rows()) set.add(r.environment || 'Production');
    const list = Array.from(set);
    return list.length ? list : ['Production'];
  });

  // Table data for the selected environment
  filteredRows = computed(() => {
    const env = this.environment();
    return this.rows().filter(r => r.environment === env);
  });

  // Legend counts
  upCount        = computed(() => this.filteredRows().filter(r => r.status === 'UP').length);
  degradedCount  = computed(() => this.filteredRows().filter(r => r.status === 'DEGRADED').length);
  downCount      = computed(() => this.filteredRows().filter(r => r.status === 'DOWN').length);
  totalCount     = computed(() => this.filteredRows().length);

  constructor(private health: DashboardHealthService) {}

  async ngOnInit() {
    try {
      this.loading.set(true);
      // Load endpoints (assets/apis.json)
      const cfg = await this.health.loadAssets();

      // Build EndpointRow[] first
      const baseRows = this.health.buildRows(cfg);

      // Enrich with baseUrl, path, environment (if missing -> "Production")
      const enriched: ApiRow[] = baseRows.map(r => {
        const u = safeParseUrl(r.url);
        return {
          ...r,
          baseUrl: u.base,
          path: u.path,
          environment: (u.env || (asAny(r)['environment'] as string) || 'Production')
        };
      });

      // Default environment = first present
      const envs = Array.from(new Set(enriched.map(x => x.environment)));
      if (envs.length) this.environment.set(envs[0]);

      this.rows.set(enriched);

      // Initial sweep
      await this.sweep();
    } catch (e: any) {
      this.error.set(e?.message ?? 'Failed to load API configuration.');
    } finally {
      this.loading.set(false);
    }
  }

  async sweep() {
    const current = this.rows();
    for (const r of current) {
      const updated = await this.health.check(r);
      // keep baseUrl/path/environment from existing entry
      this.rows.update(list => list.map(x =>
        x.url === updated.url
          ? { ...x, status: updated.status, latencyMs: updated.latencyMs }
          : x
      ));
    }
    this.lastCheckedAt.set(new Date());
  }

  statusClass(s: HealthStatus) {
    return {
      'status': true,
      'ok': s === 'UP',
      'warn': s === 'DEGRADED',
      'down': s === 'DOWN'
    };
  }

  open(r: ApiRow) {
    window.open(r.url, '_blank', 'noopener');
  }
}

// Helpers
function safeParseUrl(full: string): { base: string; path: string; env?: string } {
  try {
    const u = new URL(full);
    const base = `${u.protocol}//${u.host}`;
    const path = u.pathname + (u.search || '');
    // Optional: env by subdomain convention (e.g., api-dev.example.com)
    const host = u.host.toLowerCase();
    const env = host.includes('dev')     ? 'Development'
             : host.includes('test')    ? 'Test'
             : host.includes('staging') ? 'Staging'
             : 'Production';
    return { base, path, env };
  } catch {
    // Fallback when URL constructor can’t parse
    const sep = full.indexOf('/', 8); // after protocol
    const base = sep > 0 ? full.slice(0, sep) : full;
    const path = sep > 0 ? full.slice(sep) : '/';
    return { base, path };
  }
}

// Type escape hatch for optional props from assets
function asAny<T>(v: T): any { return v as any; }
