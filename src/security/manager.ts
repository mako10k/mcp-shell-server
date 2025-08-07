import { SecurityRestrictions } from '../types/index.js';
import { 
  EnhancedSecurityConfig, 
  DEFAULT_ENHANCED_SECURITY_CONFIG,
  DEFAULT_BASIC_SAFETY_RULES,
  CommandClassification,
  BasicSafetyRule 
} from '../types/enhanced-security.js';
import { SecurityError } from '../utils/errors.js';
import { isValidPath, generateId, getCurrentTimestamp } from '../utils/helpers.js';

export class SecurityManager {
  private restrictions: SecurityRestrictions | null = null;
  private enhancedConfig: EnhancedSecurityConfig;
  private basicSafetyRules: BasicSafetyRule[];

  constructor() {
    // Enhanced Security設定の初期化
    this.enhancedConfig = { ...DEFAULT_ENHANCED_SECURITY_CONFIG };
    this.basicSafetyRules = [...DEFAULT_BASIC_SAFETY_RULES];
    
    // デフォルトのセキュリティ制限を設定
    this.setDefaultRestrictions();
  }

  private setDefaultRestrictions(): void {
    // 環境変数からデフォルト設定を取得
    const defaultMode = (process.env['MCP_SHELL_SECURITY_MODE'] as any) || 'permissive';
    const defaultExecutionTime = parseInt(process.env['MCP_SHELL_MAX_EXECUTION_TIME'] || '300');
    const defaultMemoryMb = parseInt(process.env['MCP_SHELL_MAX_MEMORY_MB'] || '1024');
    const defaultNetworkEnabled = process.env['MCP_SHELL_ENABLE_NETWORK'] !== 'false';

    this.restrictions = {
      restriction_id: generateId(),
      security_mode: defaultMode, 
      max_execution_time: defaultExecutionTime, // 5分
      max_memory_mb: defaultMemoryMb, // 1GB
      enable_network: defaultNetworkEnabled,
      active: true,
      configured_at: getCurrentTimestamp(),
    };
  }

  setRestrictions(restrictions: Partial<SecurityRestrictions>): SecurityRestrictions {
    const newRestrictions: SecurityRestrictions = {
      restriction_id: generateId(),
      security_mode: restrictions.security_mode || this.restrictions?.security_mode || 'permissive',
      max_execution_time:
        restrictions.max_execution_time || this.restrictions?.max_execution_time || 300,
      max_memory_mb: restrictions.max_memory_mb || this.restrictions?.max_memory_mb || 1024,
      enable_network: restrictions.enable_network ?? this.restrictions?.enable_network ?? true,
      active: true,
      configured_at: getCurrentTimestamp(),
    };

    // customモードの場合のみ、詳細設定を適用
    if (newRestrictions.security_mode === 'custom') {
      if (restrictions.allowed_commands) {
        newRestrictions.allowed_commands = restrictions.allowed_commands;
      } else if (this.restrictions?.allowed_commands) {
        newRestrictions.allowed_commands = this.restrictions.allowed_commands;
      }

      if (restrictions.blocked_commands) {
        newRestrictions.blocked_commands = restrictions.blocked_commands;
      } else if (this.restrictions?.blocked_commands) {
        newRestrictions.blocked_commands = this.restrictions.blocked_commands;
      }

      if (restrictions.allowed_directories) {
        newRestrictions.allowed_directories = restrictions.allowed_directories;
      } else if (this.restrictions?.allowed_directories) {
        newRestrictions.allowed_directories = this.restrictions.allowed_directories;
      }
    }

    this.restrictions = newRestrictions;
    return newRestrictions;
  }

  getRestrictions(): SecurityRestrictions | null {
    return this.restrictions;
  }

  validateCommand(command: string): void {
    if (!this.restrictions?.active) {
      return;
    }

    switch (this.restrictions.security_mode) {
      case 'permissive':
        // permissiveモード: 基本的に何でも許可（危険なパターンのみチェック）
        const dangerousPatterns = this.detectDangerousPatterns(command);
        if (dangerousPatterns.length > 0) {
          throw new SecurityError(`Command contains dangerous patterns: ${dangerousPatterns.join(', ')}`, {
            command,
            dangerousPatterns,
          });
        }
        break;

      case 'restrictive':
        // restrictiveモード: 読み取り専用・情報取得コマンドのみ許可
        const restrictiveAllowedCommands = [
          // ファイル・ディレクトリ操作（読み取り専用）
          'ls', 'cat', 'less', 'more', 'head', 'tail', 'file', 'stat', 'find', 'locate',
          // テキスト処理
          'grep', 'awk', 'sed', 'sort', 'uniq', 'wc', 'cut', 'tr', 'column',
          // システム情報
          'pwd', 'whoami', 'id', 'date', 'uptime', 'uname', 'hostname', 
          'ps', 'top', 'df', 'du', 'free', 'lscpu', 'lsblk', 'lsusb', 'lspci',
          // ネットワーク（読み取り専用）
          'ping', 'nslookup', 'dig', 'host', 'netstat', 'ss', 'lsof',
          // 基本コマンド
          'echo', 'printf', 'which', 'type', 'command', 'history', 'env', 'printenv',
          // アーカイブ（読み取り専用）
          'tar', 'zip', 'unzip', 'gzip', 'gunzip', 'zcat',
        ];
        if (!this.isCommandAllowed(command, restrictiveAllowedCommands, [])) {
          throw new SecurityError(`Command '${command}' is not allowed in restrictive mode`, {
            command,
            allowedCommands: restrictiveAllowedCommands,
          });
        }
        break;

      case 'custom':
        // customモード: 詳細設定を使用
        if (!this.isCommandAllowed(command, this.restrictions.allowed_commands, this.restrictions.blocked_commands)) {
          throw new SecurityError(`Command '${command}' is not allowed by security policy`, {
            command,
            allowedCommands: this.restrictions.allowed_commands,
            blockedCommands: this.restrictions.blocked_commands,
          });
        }
        break;
    }
  }

  validatePath(path: string): void {
    if (!this.restrictions?.active) {
      return;
    }

    if (!isValidPath(path, this.restrictions.allowed_directories)) {
      throw new SecurityError(`Path '${path}' is not accessible`, {
        path,
        allowedDirectories: this.restrictions.allowed_directories,
      });
    }
  }

  validateExecutionTime(timeoutSeconds: number): void {
    if (!this.restrictions?.active) {
      return;
    }

    if (
      this.restrictions.max_execution_time &&
      timeoutSeconds > this.restrictions.max_execution_time
    ) {
      throw new SecurityError(
        `Execution time ${timeoutSeconds}s exceeds maximum allowed ${this.restrictions.max_execution_time}s`,
        {
          requestedTime: timeoutSeconds,
          maxAllowedTime: this.restrictions.max_execution_time,
        }
      );
    }
  }

  validateMemoryUsage(memoryMb: number): void {
    if (!this.restrictions?.active) {
      return;
    }

    if (this.restrictions.max_memory_mb && memoryMb > this.restrictions.max_memory_mb) {
      throw new SecurityError(
        `Memory usage ${memoryMb}MB exceeds maximum allowed ${this.restrictions.max_memory_mb}MB`,
        {
          requestedMemory: memoryMb,
          maxAllowedMemory: this.restrictions.max_memory_mb,
        }
      );
    }
  }

  validateNetworkAccess(): void {
    if (!this.restrictions?.active) {
      return;
    }

    if (!this.restrictions.enable_network) {
      throw new SecurityError('Network access is disabled by security policy');
    }
  }

  // 危険なパターンの検出
  detectDangerousPatterns(command: string): string[] {
    const dangerousPatterns = [
      // 破壊的なファイル操作
      /rm\s+-rf\s+\//, // rm -rf /
      /rm\s+-rf\s+\*/, // rm -rf *
      />\s*\/dev\/sd[a-z]/, // > /dev/sda
      /dd\s+.*of=\/dev\//, // dd ... of=/dev/
      /mkfs/, // ファイルシステム作成
      /fdisk/, // パーティション操作

      // ネットワーク経由のコード実行
      /curl\s+.*\|\s*(bash|sh|zsh|fish)/, // curl | bash
      /wget\s+.*\|\s*(bash|sh|zsh|fish)/, // wget | sh
      /fetch\s+.*\|\s*(bash|sh|zsh|fish)/, // fetch | sh

      // 権限昇格
      /sudo\s+/, // sudo
      /su\s+(-\s+)?[a-z]/, // su - user
      /doas\s+/, // doas (OpenBSD sudo)

      // システム設定ファイルへの書き込み
      />\s*\/etc\//, // > /etc/
      />>\s*\/etc\//, // >> /etc/
      /tee\s+.*\/etc\//, // tee /etc/

      // 機密情報アクセス
      /\/etc\/passwd/, // /etc/passwd
      /\/etc\/shadow/, // /etc/shadow
      /\/etc\/group/, // /etc/group
      /\/proc\/.*\/mem/, // /proc/*/mem

      // リバースシェル・ネットワーク攻撃
      /nc\s+.*-e/, // netcat with -e
      /bash\s+-i\s+>&/, // interactive bash redirect
      /\/dev\/tcp\//, // /dev/tcp/ redirection
      /telnet\s+.*\|\s*\/bin\//, // telnet | /bin/

      // システム改変
      /chroot/, // chroot
      /mount\s+/, // mount
      /umount/, // umount
      /sysctl\s+-w/, // sysctl write

      // プロセス・システム制御
      /kill\s+-9\s+1/, // kill init
      /killall\s+init/, // killall init
      /reboot/, // reboot
      /shutdown/, // shutdown
      /halt/, // halt
      /init\s+0/, // init 0
    ];

    const detectedPatterns: string[] = [];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        detectedPatterns.push(pattern.source);
      }
    }

    return detectedPatterns;
  }

  auditCommand(command: string, workingDirectory?: string): void {
    const dangerousPatterns = this.detectDangerousPatterns(command);

    if (dangerousPatterns.length > 0) {
      throw new SecurityError(`Dangerous patterns detected in command`, {
        command,
        detectedPatterns: dangerousPatterns,
        workingDirectory,
      });
    }

    // 追加のセキュリティチェック
    this.validateCommand(command);

    if (workingDirectory) {
      this.validatePath(workingDirectory);
    }
  }

  private isCommandAllowed(command: string, allowedCommands?: string[], blockedCommands?: string[]): boolean {
    // コマンドから最初の単語（実際のコマンド名）を抽出
    const cmdName = command.trim().split(/\s+/)[0];
    
    // cmdNameが空の場合はブロック
    if (!cmdName) {
      return false;
    }
    
    // ブロックされたコマンドをチェック
    if (blockedCommands && blockedCommands.length > 0) {
      if (blockedCommands.some(blocked => cmdName === blocked || cmdName.startsWith(blocked))) {
        return false;
      }
    }
    
    // 許可されたコマンドをチェック
    if (allowedCommands && allowedCommands.length > 0) {
      return allowedCommands.some(allowed => cmdName === allowed || cmdName.startsWith(allowed));
    }
    
    // allowedCommandsが指定されていない場合は許可（blockedCommandsのチェックのみ）
    return true;
  }

  // Enhanced Security Configuration Methods
  
  /**
   * Enhanced Security設定を更新
   */
  setEnhancedConfig(config: Partial<EnhancedSecurityConfig>): EnhancedSecurityConfig {
    this.enhancedConfig = { ...this.enhancedConfig, ...config };
    return this.enhancedConfig;
  }

  /**
   * Enhanced Security設定を取得
   */
  getEnhancedConfig(): EnhancedSecurityConfig {
    return { ...this.enhancedConfig };
  }

  /**
   * 基本安全ルールを更新
   */
  setBasicSafetyRules(rules: BasicSafetyRule[]): void {
    this.basicSafetyRules = [...rules];
  }

  /**
   * 基本安全ルールを取得
   */
  getBasicSafetyRules(): BasicSafetyRule[] {
    return [...this.basicSafetyRules];
  }

  /**
   * コマンドの基本安全分類を実行
   * @param command 分析するコマンド
   * @returns 分類結果 ('basic_safe' または 'llm_required')
   */
  classifyCommandSafety(command: string): CommandClassification {
    if (!this.enhancedConfig.basic_safe_classification) {
      // 基本分類が無効の場合、すべてLLM評価が必要
      return 'llm_required';
    }

    const trimmedCommand = command.trim();
    
    // 基本安全ルールをチェック
    for (const rule of this.basicSafetyRules) {
      try {
        const regex = new RegExp(rule.pattern);
        if (regex.test(trimmedCommand)) {
          // レベル1-3は basic_safe、レベル4-5は llm_required
          return rule.safety_level <= 3 ? 'basic_safe' : 'llm_required';
        }
      } catch (e) {
        // 正規表現エラーの場合はスキップ
        continue;
      }
    }

    // どのルールにもマッチしない場合は LLM評価が必要
    return 'llm_required';
  }

  /**
   * Enhanced Security機能が有効かどうか
   */
  isEnhancedModeEnabled(): boolean {
    return this.enhancedConfig.enhanced_mode_enabled;
  }

  /**
   * LLM評価が有効かどうか
   */
  isLLMEvaluationEnabled(): boolean {
    return this.enhancedConfig.llm_evaluation_enabled;
  }
}
