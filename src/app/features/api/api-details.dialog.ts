import { Component, Inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DashboardHealthService, HealthStatus, DetailedCheck } from '../dashboard/dashboard-health.service';

export interface ApiDetailsData {
  name: string;
  method: string;
  url: string;
  baseUrl: string;
  path: string;
  environment: string;
  status: HealthStatus;
  latencyMs?: number;
}

@Component({
  selector: 'app-api-details-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatIconModule, MatButtonModule, MatDividerModule, MatTooltipModule],
  templateUrl: './api-details.dialog.html',
  styleUrls: ['./api-details.dialog.scss']
})
export class ApiDetailsDialogComponent {
  checking = signal(false);
  lastError = signal<string | null>(null);

  history = signal<DetailedCheck[]>([]);
  latest = computed(() => this.history()[0]);

  constructor(
    private ref: MatDialogRef<ApiDetailsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ApiDetailsData,
    private health: DashboardHealthService
  ) {
    // Seed the history with the current snapshot if available
    const seed: DetailedCheck | null = this.data.latencyMs != null
      ? {
          url: this.data.url,
          method: this.data.method,
          status: this.data.status,
          latencyMs: this.data.latencyMs!,
          httpCode: -1,
          headers: {},
          at: new Date().toISOString()
        }
      : null;

    const existing = this.health.getHistory(this.data.url);
    this.history.set(seed ? [seed, ...existing].slice(0, 5) : existing);
  }

  close() { this.ref.close(); }

  openUrl() { window.open(this.data.url, '_blank', 'noopener'); }

  copyUrl() { navigator.clipboard.writeText(this.data.url).catch(() => {}); }

  async recheckDetailed() {
    try {
      this.checking.set(true);
      this.lastError.set(null);
      const result = await this.health.detailedCheck(this.data.method, this.data.url);
      // Update live fields in dialog
      this.data.status = result.status;
      this.data.latencyMs = result.latencyMs;
      // Refresh local history (service already pushed the entry)
      this.history.set(this.health.getHistory(this.data.url));
    } catch (e: any) {
      this.lastError.set(e?.message ?? 'Check failed.');
    } finally {
      this.checking.set(false);
    }
  }

  statusClass(s: HealthStatus) {
    return { 'status': true, 'ok': s === 'UP', 'warn': s === 'DEGRADED', 'down': s === 'DOWN' };
  }

  headerEntries(obj: Record<string, string>) {
    return Object.entries(obj);
  }
}
