import { MonitorInfo, SystemStats } from '../types/index.js';
import { generateId, getCurrentTimestamp, getSystemInfo } from '../utils/helpers.js';
import { ResourceNotFoundError } from '../utils/errors.js';

interface ProcessMetrics {
  cpu_usage_percent?: number;
  memory_usage_mb?: number;
  io_read_bytes?: number;
  io_write_bytes?: number;
  network_rx_bytes?: number;
  network_tx_bytes?: number;
}

export class MonitoringManager {
  private monitors = new Map<string, MonitorInfo>();
  private intervals = new Map<string, NodeJS.Timeout>();
  private processMetrics = new Map<number, ProcessMetrics[]>();
  private readonly maxMetricsHistory = 1000;

  constructor() {
    // システム統計の定期収集を開始
    this.startSystemMonitoring();
  }

  startProcessMonitor(
    processId: number,
    intervalMs = 1000,
    includeMetrics?: string[]
  ): MonitorInfo {
    const monitorId = generateId();
    const now = getCurrentTimestamp();

    const monitorInfo: MonitorInfo = {
      monitor_id: monitorId,
      process_id: processId,
      status: 'active',
      started_at: now,
      last_update: now,
      metrics: {},
    };

    this.monitors.set(monitorId, monitorInfo);

    // メトリクス収集の開始
    const interval = setInterval(() => {
      this.collectProcessMetrics(monitorId, processId, includeMetrics);
    }, intervalMs);

    this.intervals.set(monitorId, interval);

    return { ...monitorInfo };
  }

  private async collectProcessMetrics(
    monitorId: string,
    processId: number,
    includeMetrics?: string[]
  ): Promise<void> {
    const monitor = this.monitors.get(monitorId);
    if (!monitor) return;

    try {
      const metrics: ProcessMetrics = {};

      // CPU使用率の測定
      if (!includeMetrics || includeMetrics.includes('cpu')) {
        metrics.cpu_usage_percent = await this.getCpuUsage(processId);
      }

      // メモリ使用量の測定
      if (!includeMetrics || includeMetrics.includes('memory')) {
        metrics.memory_usage_mb = await this.getMemoryUsage(processId);
      }

      // I/O統計の測定
      if (!includeMetrics || includeMetrics.includes('io')) {
        const ioStats = await this.getIoStats(processId);
        metrics.io_read_bytes = ioStats.read_bytes;
        metrics.io_write_bytes = ioStats.write_bytes;
      }

      // ネットワーク統計の測定
      if (!includeMetrics || includeMetrics.includes('network')) {
        const networkStats = await this.getNetworkStats(processId);
        metrics.network_rx_bytes = networkStats.rx_bytes;
        metrics.network_tx_bytes = networkStats.tx_bytes;
      }

      // メトリクスの保存
      this.storeProcessMetrics(processId, metrics);

      // 監視情報の更新
      monitor.metrics = metrics;
      monitor.last_update = getCurrentTimestamp();
      this.monitors.set(monitorId, monitor);
    } catch (error) {
      // エラーログを内部ログに記録（標準出力を避ける）
      // console.error(`Failed to collect metrics for process ${processId}:`, error);

      // エラーの場合は監視を停止
      this.stopProcessMonitor(monitorId);
    }
  }

  private async getCpuUsage(processId: number): Promise<number> {
    try {
      // プラットフォーム固有のCPU使用率取得
      if (process.platform === 'linux') {
        return await this.getLinuxCpuUsage(processId);
      } else if (process.platform === 'darwin') {
        return await this.getMacOsCpuUsage(processId);
      } else {
        return 0; // Windows等では簡易実装
      }
    } catch {
      return 0;
    }
  }

  private async getLinuxCpuUsage(processId: number): Promise<number> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const { stdout } = await execAsync(`ps -p ${processId} -o %cpu --no-headers`);
      return parseFloat(stdout.trim()) || 0;
    } catch {
      return 0;
    }
  }

  private async getMacOsCpuUsage(processId: number): Promise<number> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const { stdout } = await execAsync(`ps -p ${processId} -o %cpu`);
      const lines = stdout.trim().split('\n');
      if (lines.length > 1 && lines[1]) {
        return parseFloat(lines[1].trim()) || 0;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  private async getMemoryUsage(processId: number): Promise<number> {
    try {
      if (process.platform === 'linux') {
        return await this.getLinuxMemoryUsage(processId);
      } else if (process.platform === 'darwin') {
        return await this.getMacOsMemoryUsage(processId);
      } else {
        return 0;
      }
    } catch {
      return 0;
    }
  }

  private async getLinuxMemoryUsage(processId: number): Promise<number> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const { stdout } = await execAsync(`ps -p ${processId} -o rss --no-headers`);
      const rssKb = parseInt(stdout.trim()) || 0;
      return rssKb / 1024; // MB に変換
    } catch {
      return 0;
    }
  }

  private async getMacOsMemoryUsage(processId: number): Promise<number> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const { stdout } = await execAsync(`ps -p ${processId} -o rss`);
      const lines = stdout.trim().split('\n');
      if (lines.length > 1 && lines[1]) {
        const rssKb = parseInt(lines[1].trim()) || 0;
        return rssKb / 1024; // MB に変換
      }
      return 0;
    } catch {
      return 0;
    }
  }

  private async getIoStats(
    processId: number
  ): Promise<{ read_bytes: number; write_bytes: number }> {
    try {
      if (process.platform === 'linux') {
        const fs = await import('fs/promises');
        const ioData = await fs.readFile(`/proc/${processId}/io`, 'utf-8');

        let readBytes = 0;
        let writeBytes = 0;

        for (const line of ioData.split('\n')) {
          if (line.startsWith('read_bytes:')) {
            readBytes = parseInt(line.split(':')[1]?.trim() || '0');
          } else if (line.startsWith('write_bytes:')) {
            writeBytes = parseInt(line.split(':')[1]?.trim() || '0');
          }
        }

        return { read_bytes: readBytes, write_bytes: writeBytes };
      }
    } catch {
      // エラーの場合はデフォルト値
    }

    return { read_bytes: 0, write_bytes: 0 };
  }

  private async getNetworkStats(
    _processId: number
  ): Promise<{ rx_bytes: number; tx_bytes: number }> {
    // ネットワーク統計の取得は複雑なので、今回は簡易実装
    return { rx_bytes: 0, tx_bytes: 0 };
  }

  private storeProcessMetrics(processId: number, metrics: ProcessMetrics): void {
    if (!this.processMetrics.has(processId)) {
      this.processMetrics.set(processId, []);
    }

    const metricsHistory = this.processMetrics.get(processId)!;
    metricsHistory.push(metrics);

    // 履歴サイズの制限
    if (metricsHistory.length > this.maxMetricsHistory) {
      metricsHistory.shift();
    }
  }

  stopProcessMonitor(monitorId: string): boolean {
    const monitor = this.monitors.get(monitorId);
    if (!monitor) {
      throw new ResourceNotFoundError('monitor', monitorId);
    }

    // インターバルを停止
    const interval = this.intervals.get(monitorId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(monitorId);
    }

    // 監視状態を更新
    monitor.status = 'stopped';
    monitor.last_update = getCurrentTimestamp();
    this.monitors.set(monitorId, monitor);

    return true;
  }

  getMonitor(monitorId: string): MonitorInfo {
    const monitor = this.monitors.get(monitorId);
    if (!monitor) {
      throw new ResourceNotFoundError('monitor', monitorId);
    }
    return { ...monitor };
  }

  listMonitors(): MonitorInfo[] {
    return Array.from(this.monitors.values()).map((monitor) => ({ ...monitor }));
  }

  getSystemStats(_timeRangeMinutes = 60): SystemStats {
    const systemInfo = getSystemInfo();
    // const processInfo = getProcessInfo(); // 現在未使用

    const stats: SystemStats = {
      active_processes: this.getActiveProcessCount(),
      active_terminals: 0, // TerminalManagerから取得する必要がある
      total_files: 0, // FileManagerから取得する必要がある
      system_load: {
        load1: systemInfo.loadavg[0] || 0,
        load5: systemInfo.loadavg[1] || 0,
        load15: systemInfo.loadavg[2] || 0,
      },
      memory_usage: {
        total_mb: Math.round(systemInfo.totalmem / 1024 / 1024),
        used_mb: Math.round((systemInfo.totalmem - systemInfo.freemem) / 1024 / 1024),
        free_mb: Math.round(systemInfo.freemem / 1024 / 1024),
        available_mb: Math.round(systemInfo.freemem / 1024 / 1024), // 簡易実装
      },
      uptime_seconds: Math.round(systemInfo.uptime),
      collected_at: getCurrentTimestamp(),
    };

    return stats;
  }

  private getActiveProcessCount(): number {
    return Array.from(this.monitors.values()).filter((monitor) => monitor.status === 'active')
      .length;
  }

  private startSystemMonitoring(): void {
    // 5分ごとにシステム統計を収集
    setInterval(
      () => {
        try {
          // 将来的にはシステム統計をログファイルに保存
          const stats = this.getSystemStats();
          this.logSystemStats(stats);
        } catch (error) {
          // エラーログを内部ログに記録（標準出力を避ける）
          // console.error('Failed to collect system stats:', error);
        }
      },
      5 * 60 * 1000
    );
  }

  private logSystemStats(_stats: SystemStats): void {
    // 将来的にはログファイルに出力（標準出力を避ける）
    // console.log(`[${stats.collected_at}] System Stats:`, {
    //   processes: stats.active_processes,
    //   load: stats.system_load.load1,
    //   memory_used_mb: stats.memory_usage.used_mb,
    // });
  }

  cleanup(): void {
    // 全ての監視を停止
    for (const monitorId of this.monitors.keys()) {
      try {
        this.stopProcessMonitor(monitorId);
      } catch (error) {
        // エラーログを内部ログに記録（標準出力を避ける）
        // console.error(`Failed to stop monitor ${monitorId}:`, error);
      }
    }

    this.monitors.clear();
    this.intervals.clear();
    this.processMetrics.clear();
  }
}
