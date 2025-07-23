/**
 * Issue #13: リアルタイムストリーミング機能
 * リアルタイム出力配信のためのSubscriber
 */

import { StreamSubscriber } from './stream-publisher.js';
import { generateId, getCurrentTimestamp } from '../utils/helpers.js';

interface RealtimeStreamOptions {
  /** バッファサイズ（バイト）*/
  bufferSize?: number;
  
  /** 通知間隔（ミリ秒）*/
  notificationInterval?: number;
  
  /** 最大保持時間（秒）*/
  maxRetentionSeconds?: number;
  
  /** 最大バッファ数 */
  maxBuffers?: number;
}

interface StreamBuffer {
  timestamp: string;
  data: string;
  isStderr: boolean;
  sequenceNumber: number;
}

export interface StreamState {
  executionId: string;
  command: string;
  startTime: string;
  buffers: StreamBuffer[];
  isActive: boolean;
  lastUpdateTime: string;
  totalBytesReceived: number;
  sequenceCounter: number;
}

/**
 * リアルタイムストリーミング用のSubscriber
 * プロセス出力をメモリ内にバッファして、リアルタイム配信を可能にする
 */
export class RealtimeStreamSubscriber implements StreamSubscriber {
  public readonly id: string;
  private streams: Map<string, StreamState> = new Map();
  private options: Required<RealtimeStreamOptions>;
  private cleanupInterval: NodeJS.Timeout | null = null;
  
  constructor(options: RealtimeStreamOptions = {}) {
    this.id = `realtime-stream-${generateId()}`;
    this.options = {
      bufferSize: 8192,
      notificationInterval: 100,
      maxRetentionSeconds: 3600, // 1時間
      maxBuffers: 1000,
      ...options
    };
    
    // 定期的なクリーンアップを開始
    this.startCleanupTimer();
  }
  
  async onProcessStart(executionId: string, command: string): Promise<void> {
    const streamState: StreamState = {
      executionId,
      command,
      startTime: getCurrentTimestamp(),
      buffers: [],
      isActive: true,
      lastUpdateTime: getCurrentTimestamp(),
      totalBytesReceived: 0,
      sequenceCounter: 0
    };
    
    this.streams.set(executionId, streamState);
    console.error(`RealtimeStreamSubscriber: Started streaming for ${executionId}`);
  }
  
  async onOutputData(executionId: string, data: string, isStderr: boolean = false): Promise<void> {
    const streamState = this.streams.get(executionId);
    if (!streamState) {
      console.error(`RealtimeStreamSubscriber: No stream state found for ${executionId}`);
      return;
    }
    
    // バッファを作成
    const buffer: StreamBuffer = {
      timestamp: getCurrentTimestamp(),
      data,
      isStderr,
      sequenceNumber: streamState.sequenceCounter++
    };
    
    // バッファを追加（サイズ制限チェック）
    streamState.buffers.push(buffer);
    streamState.totalBytesReceived += data.length;
    streamState.lastUpdateTime = getCurrentTimestamp();
    
    // バッファ数の制限チェック
    if (streamState.buffers.length > this.options.maxBuffers) {
      // 古いバッファを削除
      const removed = streamState.buffers.splice(0, streamState.buffers.length - this.options.maxBuffers);
      console.error(`RealtimeStreamSubscriber: Removed ${removed.length} old buffers for ${executionId}`);
    }
  }
  
  async onProcessEnd(executionId: string, exitCode: number | null): Promise<void> {
    const streamState = this.streams.get(executionId);
    if (streamState) {
      streamState.isActive = false;
      streamState.lastUpdateTime = getCurrentTimestamp();
      console.error(`RealtimeStreamSubscriber: Process ${executionId} ended with code ${exitCode}`);
    }
  }
  
  async onError(executionId: string, error: Error): Promise<void> {
    const streamState = this.streams.get(executionId);
    if (streamState) {
      streamState.isActive = false;
      streamState.lastUpdateTime = getCurrentTimestamp();
      
      // エラー情報をバッファに追加
      const errorBuffer: StreamBuffer = {
        timestamp: getCurrentTimestamp(),
        data: `\n[ERROR] ${error.message}\n`,
        isStderr: true,
        sequenceNumber: streamState.sequenceCounter++
      };
      
      streamState.buffers.push(errorBuffer);
      console.error(`RealtimeStreamSubscriber: Error in process ${executionId}: ${error.message}`);
    }
  }
  
  /**
   * 指定された実行のストリーム状態を取得
   */
  getStreamState(executionId: string): StreamState | undefined {
    return this.streams.get(executionId);
  }
  
  /**
   * 指定された実行の最新バッファを取得
   */
  getLatestBuffers(executionId: string, count: number = 10): StreamBuffer[] {
    const streamState = this.streams.get(executionId);
    if (!streamState) {
      return [];
    }
    
    return streamState.buffers.slice(-count);
  }
  
  /**
   * 指定された実行の指定された位置からのバッファを取得
   */
  getBuffersFromSequence(executionId: string, fromSequence: number, maxCount: number = 100): StreamBuffer[] {
    const streamState = this.streams.get(executionId);
    if (!streamState) {
      return [];
    }
    
    const buffers = streamState.buffers.filter(buffer => buffer.sequenceNumber >= fromSequence);
    return buffers.slice(0, maxCount);
  }
  
  /**
   * アクティブなストリーム一覧を取得
   */
  getActiveStreams(): string[] {
    return Array.from(this.streams.entries())
      .filter(([_, state]) => state.isActive)
      .map(([executionId]) => executionId);
  }
  
  /**
   * 全ストリーム一覧を取得
   */
  getAllStreams(): string[] {
    return Array.from(this.streams.keys());
  }
  
  /**
   * 指定されたストリームを削除
   */
  removeStream(executionId: string): boolean {
    return this.streams.delete(executionId);
  }
  
  /**
   * 統計情報を取得
   */
  getStats(): {
    totalStreams: number;
    activeStreams: number;
    totalBuffers: number;
    totalBytesReceived: number;
  } {
    let totalBuffers = 0;
    let totalBytesReceived = 0;
    let activeStreams = 0;
    
    for (const state of this.streams.values()) {
      totalBuffers += state.buffers.length;
      totalBytesReceived += state.totalBytesReceived;
      if (state.isActive) {
        activeStreams++;
      }
    }
    
    return {
      totalStreams: this.streams.size,
      activeStreams,
      totalBuffers,
      totalBytesReceived
    };
  }
  
  /**
   * 定期的なクリーンアップタイマーを開始
   */
  private startCleanupTimer(): void {
    // 5分ごとにクリーンアップを実行
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }
  
  /**
   * 古いストリームをクリーンアップ
   */
  private cleanup(): void {
    const now = Date.now();
    const maxRetentionMs = this.options.maxRetentionSeconds * 1000;
    const toRemove: string[] = [];
    
    for (const [executionId, state] of this.streams.entries()) {
      const lastUpdateTime = new Date(state.lastUpdateTime).getTime();
      
      // 非アクティブで保持期間を超えている場合は削除対象
      if (!state.isActive && now - lastUpdateTime > maxRetentionMs) {
        toRemove.push(executionId);
      }
    }
    
    for (const executionId of toRemove) {
      this.streams.delete(executionId);
      console.error(`RealtimeStreamSubscriber: Cleaned up old stream ${executionId}`);
    }
    
    if (toRemove.length > 0) {
      console.error(`RealtimeStreamSubscriber: Cleanup completed, removed ${toRemove.length} streams`);
    }
  }
  
  /**
   * リソースをクリーンアップして終了
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    this.streams.clear();
    console.error(`RealtimeStreamSubscriber: Subscriber ${this.id} destroyed`);
  }
}
