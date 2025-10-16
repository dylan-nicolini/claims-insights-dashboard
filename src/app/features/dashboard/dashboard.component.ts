import { Component, computed, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { DashboardHealthService, EndpointRow } from './dashboard-health.service';

type HealthStatus = 'UP'|'DEGRADED'|'DOWN'|'UNKNOWN';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule, MatTableModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit {
  loading = signal(true);
  error = signal<string | null>(null);

  rows = signal<EndpointRow[]>([]);
  q = signal('');

  filtered = computed(() => {
    const s = this.q().trim().toLowerCase();
    if (!s) return this.rows();
    return this.rows().filter(r =>
      (r.name+' '+r.method+' '+r.url).toLowerCase().includes(s)
    );
  });

  constructor(private health: DashboardHealthService) {}

  async ngOnInit() {
    try {
      this.loading.set(true);
      const cfg = await this.health.loadAssets();
      this.rows.set(this.health.buildRows(cfg));
      await this.sweep();
      this.loading.set(false);
    } catch (e: any) {
      this.loading.set(false);
      this.error.set(e?.message ?? 'Failed to load configuration');
    }
  }

  onSearchInput(evt: Event) {
    const value = (evt.target as HTMLInputElement)?.value ?? '';
    this.q.set(value);
  }

  statusClass(s: HealthStatus) {
    return { 'status ok': s==='UP', 'status warn': s==='DEGRADED', 'status down': s==='DOWN' };
  }

  async sweep() {
    for (const r of this.rows()) {
      const updated = await this.health.check(r);
      this.rows.update(list => list.map(x => x.url === updated.url ? updated : x));
    }
  }

  recheck(row: EndpointRow) {
    this.health.check(row).then(updated => {
      this.rows.update(list => list.map(x => x.url === updated.url ? updated : x));
    });
  }
}
