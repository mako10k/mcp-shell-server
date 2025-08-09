/**
 * Issue #13: リアルタイムストリーミング機能
 * Phase 1: StreamPublisher + Subscriber パターン実装
 */

export interface StreamSubscriber {
  /** Subscriber ID */
  id: string;
  
  /** プロセス開始時に呼ばれる */
  onProcessStart?(executionId: string, command: string): void | Promise<void>;
  
  /** 新しい出力データが来た時に呼ばれる */
  onOutputData(executionId: string, data: string, isStderr: boolean): void | Promise<void>;
  
  /** プロセス終了時に呼ばれる */
  onProcessEnd?(executionId: string, exitCode: number | null): void | Promise<void>;
  
  /** エラー発生時に呼ばれる */
  onError?(executionId: string, error: Error): void | Promise<void>;
}

interface StreamPublisherOptions {
  /** リアルタイム通知を有効にするか */
  enableRealtimeStreaming?: boolean;
  
  /** バッファサイズ（バイト） */
  bufferSize?: number;
  
  /** 通知間隔（ミリ秒） */
  notificationInterval?: number;
}

/**
 * プロセス出力のPUB/SUBを管理するクラス
 */
export class StreamPublisher {
  private subscribers: Map<string, StreamSubscriber> = new Map();
  private executionSubscribers: Map<string, Set<string>> = new Map(); // execution -> subscriber IDs
  
  constructor(private options: StreamPublisherOptions = {}) {
    this.options = {
      enableRealtimeStreaming: false,
      bufferSize: 8192,
      notificationInterval: 100,
      ...options
    };
  }
  
  /**
   * Subscriberを登録
   */
  subscribe(subscriber: StreamSubscriber): void {
    this.subscribers.set(subscriber.id, subscriber);
  }
  
  /**
   * Subscriberを削除
   */
  unsubscribe(subscriberId: string): void {
    this.subscribers.delete(subscriberId);
    // 全ての実行からこのsubscriberを削除
    for (const [executionId, subscriberIds] of this.executionSubscribers.entries()) {
      subscriberIds.delete(subscriberId);
      if (subscriberIds.size === 0) {
        this.executionSubscribers.delete(executionId);
      }
    }
  }
  
  /**
   * 特定の実行にSubscriberを追加
   */
  subscribeToExecution(executionId: string, subscriberId: string): void {
    if (!this.subscribers.has(subscriberId)) {
      throw new Error(`Subscriber ${subscriberId} not found`);
    }
    
    if (!this.executionSubscribers.has(executionId)) {
      this.executionSubscribers.set(executionId, new Set());
    }
    
    const subscriberSet = this.executionSubscribers.get(executionId);
    if (subscriberSet) {
      subscriberSet.add(subscriberId);
    }
  }
  
  /**
   * プロセス開始を通知
   */
  async notifyProcessStart(executionId: string, command: string): Promise<void> {
    const subscriberIds = this.executionSubscribers.get(executionId);
    if (!subscriberIds) return;
    
    const notifications = Array.from(subscriberIds).map(async (subscriberId) => {
      const subscriber = this.subscribers.get(subscriberId);
      if (subscriber?.onProcessStart) {
        try {
          await subscriber.onProcessStart(executionId, command);
        } catch (error) {
          console.error(`StreamPublisher: Error notifying subscriber ${subscriberId}:`, error);
        }
      }
    });
    
    await Promise.allSettled(notifications);
  }
  
  /**
   * 出力データを通知
   */
  async notifyOutputData(executionId: string, data: string, isStderr: boolean = false): Promise<void> {
    const subscriberIds = this.executionSubscribers.get(executionId);
    if (!subscriberIds) return;
    
    const notifications = Array.from(subscriberIds).map(async (subscriberId) => {
      const subscriber = this.subscribers.get(subscriberId);
      if (subscriber) {
        try {
          await subscriber.onOutputData(executionId, data, isStderr);
        } catch (error) {
          console.error(`StreamPublisher: Error notifying subscriber ${subscriberId}:`, error);
        }
      }
    });
    
    await Promise.allSettled(notifications);
  }
  
  /**
   * プロセス終了を通知
   */
  async notifyProcessEnd(executionId: string, exitCode: number | null): Promise<void> {
    const subscriberIds = this.executionSubscribers.get(executionId);
    if (!subscriberIds) return;
    
    const notifications = Array.from(subscriberIds).map(async (subscriberId) => {
      const subscriber = this.subscribers.get(subscriberId);
      if (subscriber?.onProcessEnd) {
        try {
          await subscriber.onProcessEnd(executionId, exitCode);
        } catch (error) {
          console.error(`StreamPublisher: Error notifying subscriber ${subscriberId}:`, error);
        }
      }
    });
    
    await Promise.allSettled(notifications);
    
    // 実行完了後はsubscription情報をクリーンアップ
    this.executionSubscribers.delete(executionId);
  }
  
  /**
   * エラーを通知
   */
  async notifyError(executionId: string, error: Error): Promise<void> {
    const subscriberIds = this.executionSubscribers.get(executionId);
    if (!subscriberIds) return;
    
    const notifications = Array.from(subscriberIds).map(async (subscriberId) => {
      const subscriber = this.subscribers.get(subscriberId);
      if (subscriber?.onError) {
        try {
          await subscriber.onError(executionId, error);
        } catch (subscriberError) {
          console.error(`StreamPublisher: Error notifying subscriber ${subscriberId}:`, subscriberError);
        }
      }
    });
    
    await Promise.allSettled(notifications);
  }
  
  /**
   * リアルタイムストリーミングが有効かどうか
   */
  isRealtimeStreamingEnabled(): boolean {
    return this.options.enableRealtimeStreaming === true;
  }
  
  /**
   * 特定の実行にSubscriberが登録されているかチェック
   */
  hasSubscribers(executionId: string): boolean {
    const subscriberIds = this.executionSubscribers.get(executionId);
    return Boolean(subscriberIds && subscriberIds.size > 0);
  }
}
