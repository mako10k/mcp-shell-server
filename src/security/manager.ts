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
import { EnhancedSafetyEvaluator } from './enhanced-evaluator.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

export class SecurityManager {
  private restrictions: SecurityRestrictions | null = null;
  private enhancedConfig: EnhancedSecurityConfig;
  private basicSafetyRules: BasicSafetyRule[];
  private enhancedEvaluator: EnhancedSafetyEvaluator | null = null;

  constructor() {
    // Enhanced Security設定の初期化
    this.enhancedConfig = { ...DEFAULT_ENHANCED_SECURITY_CONFIG };
    this.basicSafetyRules = [...DEFAULT_BASIC_SAFETY_RULES];
    
    // 環境変数からEnhanced Security設定を読み取り
    this.loadEnhancedConfigFromEnv();
    
    // デフォルトのセキュリティ制限を設定
    this.setDefaultRestrictions();
  }

  private setDefaultRestrictions(): void {
    // 環境変数からデフォルト設定を取得
    const defaultMode = (process.env['MCP_SHELL_SECURITY_MODE'] as any) || 'permissive';
    const defaultExecutionTime = parseInt(process.env['MCP_SHELL_MAX_EXECUTION_TIME'] || '300');
    const defaultMemoryMb = parseInt(process.env['MCP_SHELL_MAX_MEMORY_MB'] || '1024');
    const defaultNetworkEnabled = process.env['MCP_SHELL_ENABLE_NETWORK'] !== 'false';

    // Enhanced Modeの自動設定
    if (defaultMode === 'enhanced' || defaultMode === 'enhanced-fast') {
      this.enhancedConfig.enhanced_mode_enabled = true;
      this.enhancedConfig.llm_evaluation_enabled = true;
      
      // enhanced-fastの場合は安全コマンドスキップを有効化
      this.enhancedConfig.enable_pattern_filtering = (defaultMode === 'enhanced-fast');
    }

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

  /**
   * Load enhanced security configuration from environment variables
   */
  private loadEnhancedConfigFromEnv(): void {
    // Enhanced mode (backward compatibility)
    if (process.env['MCP_SHELL_ENHANCED_MODE'] === 'true') {
      this.enhancedConfig.enhanced_mode_enabled = true;
    }
    
    // LLM evaluation (backward compatibility)
    if (process.env['MCP_SHELL_LLM_EVALUATION'] === 'true') {
      this.enhancedConfig.llm_evaluation_enabled = true;
    }
    
    // Safe command skip (new simplified naming)
    if (process.env['MCP_SHELL_SKIP_SAFE_COMMANDS'] === 'true') {
      this.enhancedConfig.enable_pattern_filtering = true;
    }
    
    // Pattern matching pre-filtering (backward compatibility)
    if (process.env['MCP_SHELL_ENABLE_PATTERN_FILTERING'] === 'true') {
      this.enhancedConfig.enable_pattern_filtering = true;
    }
    
    // Other enhanced security settings
    if (process.env['MCP_SHELL_ELICITATION'] === 'true') {
      this.enhancedConfig.elicitation_enabled = true;
    }
    
    if (process.env['MCP_SHELL_BASIC_SAFE_CLASSIFICATION'] === 'false') {
      this.enhancedConfig.basic_safe_classification = false;
    }
    
    // LLM provider settings
    if (process.env['MCP_SHELL_LLM_PROVIDER']) {
      this.enhancedConfig.llm_provider = process.env['MCP_SHELL_LLM_PROVIDER'] as 'openai' | 'anthropic' | 'custom';
    }
    
    if (process.env['MCP_SHELL_LLM_MODEL']) {
      this.enhancedConfig.llm_model = process.env['MCP_SHELL_LLM_MODEL'];
    }
    
    if (process.env['MCP_SHELL_LLM_API_KEY']) {
      this.enhancedConfig.llm_api_key = process.env['MCP_SHELL_LLM_API_KEY'];
    }
    
    if (process.env['MCP_SHELL_LLM_TIMEOUT']) {
      const timeout = parseInt(process.env['MCP_SHELL_LLM_TIMEOUT']);
      if (!isNaN(timeout) && timeout > 0 && timeout <= 60) {
        this.enhancedConfig.llm_timeout_seconds = timeout;
      }
    }
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

      case 'moderate':
        // moderateモード: 基本的なセキュリティチェック
        const moderateDangerousPatterns = this.detectDangerousPatterns(command);
        if (moderateDangerousPatterns.length > 0) {
          throw new SecurityError(`Command contains dangerous patterns: ${moderateDangerousPatterns.join(', ')}`, {
            command,
            dangerousPatterns: moderateDangerousPatterns,
          });
        }
        break;

      case 'enhanced':
      case 'enhanced-fast':
        // enhancedモード: Enhanced Safety Evaluatorが処理
        // validateCommand段階では基本的なパターンチェックのみ行い、
        // 詳細な評価はenhanaced evaluatorに委ねる
        const enhancedDangerousPatterns = this.detectCriticalDangerousPatterns(command);
        if (enhancedDangerousPatterns.length > 0) {
          throw new SecurityError(`Command contains critical dangerous patterns: ${enhancedDangerousPatterns.join(', ')}`, {
            command,
            dangerousPatterns: enhancedDangerousPatterns,
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

  /**
   * Detect only critical dangerous patterns (for enhanced mode)
   * Enhanced mode delegates most evaluation to LLM, but blocks extremely dangerous patterns
   */
  private detectCriticalDangerousPatterns(command: string): string[] {
    const criticalPatterns = [
      // 極めて危険な操作のみ
      /rm\s+.*-rf?\s+\//, // rm -rf /
      /dd\s+.*of=\/dev\//, // dd to device files
      /mkfs\s+\/dev\//, // format device
      /fdisk\s+\/dev\//, // partition device
      
      // ネットワーク経由のコード実行
      /curl\s+.*\|\s*(bash|sh|zsh|fish)/, // curl | bash
      /wget\s+.*\|\s*(bash|sh|zsh|fish)/, // wget | sh
      
      // システム破壊
      /kill\s+-9\s+1/, // kill init
      /killall\s+init/, // killall init
      /init\s+0/, // init 0
      
      // リバースシェル
      /bash\s+-i\s+>&/, // interactive bash redirect
      /\/dev\/tcp\//, // /dev/tcp/ redirection
    ];

    const detectedPatterns: string[] = [];

    for (const pattern of criticalPatterns) {
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
   * Update enhanced security configuration
   */
  setEnhancedConfig(config: Partial<EnhancedSecurityConfig>): void {
    this.enhancedConfig = { ...this.enhancedConfig, ...config };
  }

  /**
   * Get current enhanced security configuration
   */
  getEnhancedConfig(): EnhancedSecurityConfig {
    return { ...this.enhancedConfig };
  }

  /**
   * Update basic safety rules
   */
  setBasicSafetyRules(rules: BasicSafetyRule[]): void {
    this.basicSafetyRules = [...rules];
  }

  /**
   * Get current basic safety rules
   */
  getBasicSafetyRules(): BasicSafetyRule[] {
    return [...this.basicSafetyRules];
  }

  /**
   * Classify command safety using basic rules
   * Returns classification and safety level
   */
  classifyCommandBasicSafety(command: string): { 
    classification: CommandClassification, 
    safetyLevel: number,
    matchedRule?: BasicSafetyRule 
  } {
    if (!this.enhancedConfig.basic_safe_classification) {
      // Basic classification disabled, require LLM evaluation
      return { classification: 'llm_required', safetyLevel: 3 };
    }

    // Check against basic safety rules
    for (const rule of this.basicSafetyRules) {
      try {
        const regex = new RegExp(rule.pattern, 'i');
        if (regex.test(command)) {
          // Rule matched
          const classification = rule.safety_level <= 2 ? 'basic_safe' : 'llm_required';
          return {
            classification,
            safetyLevel: rule.safety_level,
            matchedRule: rule
          };
        }
      } catch (error) {
        // Invalid regex pattern, skip this rule
        console.warn(`Invalid regex pattern in safety rule: ${rule.pattern}`);
        continue;
      }
    }

    // No rule matched, default to requiring LLM evaluation
    return { classification: 'llm_required', safetyLevel: 3 };
  }

  /**
   * Check if enhanced security mode is enabled
   */
  isEnhancedModeEnabled(): boolean {
    return this.enhancedConfig.enhanced_mode_enabled;
  }

  /**
   * Check if LLM evaluation is enabled
   */
  isLLMEvaluationEnabled(): boolean {
    return this.enhancedConfig.llm_evaluation_enabled;
  }

  /**
   * Check if command history enhancement is enabled
   */
  isCommandHistoryEnhanced(): boolean {
    return this.enhancedConfig.command_history_enhanced;
  }
  
  /**
   * Classify command safety using basic rules
   * Returns classification result ('basic_safe' or 'llm_required')
   */
  classifyCommandSafety(command: string): CommandClassification {
    if (!this.enhancedConfig.basic_safe_classification) {
      // Basic classification disabled, require LLM evaluation
      return 'llm_required';
    }

    const trimmedCommand = command.trim();
    
    // Empty command is basic_safe
    if (!trimmedCommand) {
      return 'basic_safe';
    }

    // Check dangerous patterns (highest priority)
    const dangerousPatterns = this.detectDangerousPatterns(trimmedCommand);
    if (dangerousPatterns.length > 0) {
      return 'llm_required';
    }

    // Check basic safety rules
    for (const rule of this.basicSafetyRules) {
      try {
        const regex = new RegExp(rule.pattern);
        if (regex.test(trimmedCommand)) {
          // Level 1-3 is basic_safe, level 4-5 is llm_required
          return rule.safety_level <= 3 ? 'basic_safe' : 'llm_required';
        }
      } catch (e) {
        // Skip invalid regex patterns
        continue;
      }
    }

    // No rule matched, require LLM evaluation
    return 'llm_required';
  }

  /**
   * Detailed command safety analysis with reasoning
   */
  analyzeCommandSafety(command: string): {
    classification: CommandClassification;
    reasoning: string;
    safety_level?: number;
    matched_rule?: string;
    dangerous_patterns?: string[];
  } {
    const trimmedCommand = command.trim();
    
    if (!this.enhancedConfig.basic_safe_classification) {
      return {
        classification: 'llm_required',
        reasoning: 'Basic safety classification is disabled'
      };
    }

    if (!trimmedCommand) {
      return {
        classification: 'basic_safe',
        reasoning: 'Empty command',
        safety_level: 1
      };
    }

    // Check dangerous patterns (highest priority)
    const dangerousPatterns = this.detectDangerousPatterns(trimmedCommand);
    if (dangerousPatterns.length > 0) {
      return {
        classification: 'llm_required',
        reasoning: 'Contains dangerous patterns',
        safety_level: 5,
        dangerous_patterns: dangerousPatterns
      };
    }

    // Check basic safety rules
    for (const rule of this.basicSafetyRules) {
      try {
        const regex = new RegExp(rule.pattern);
        if (regex.test(trimmedCommand)) {
          return {
            classification: rule.safety_level <= 3 ? 'basic_safe' : 'llm_required',
            reasoning: rule.reasoning,
            safety_level: rule.safety_level,
            matched_rule: rule.pattern
          };
        }
      } catch (e) {
        // Skip invalid regex patterns
        continue;
      }
    }

    return {
      classification: 'llm_required',
      reasoning: 'No matching safety rule found - requires LLM evaluation',
      safety_level: 4
    };
  }

  /**
   * Initialize Enhanced Safety Evaluator
   */
  initializeEnhancedEvaluator(historyManager: any, server?: Server): void {
    if (this.enhancedConfig.enhanced_mode_enabled) {
      this.enhancedEvaluator = new EnhancedSafetyEvaluator(this, historyManager);
      
      // Set pattern filtering configuration
      this.enhancedEvaluator.setPatternFiltering(this.enhancedConfig.enable_pattern_filtering);
      
      // Enhanced mode requires LLM evaluation capability
      if (!server) {
        throw new Error('Enhanced security mode requires LLM server connection but server is not available. Enhanced mode cannot function without LLM evaluation capability.');
      }
      
      // Set up LLM sampling callback if server is provided
      this.enhancedEvaluator.setCreateMessageCallback(async (params) => {
        try {
          // Transform our interface to MCP server format
          const mcpParams = {
            messages: params.messages,
            maxTokens: params.maxTokens || 100,
            temperature: params.temperature,
            systemPrompt: params.systemPrompt,
            includeContext: params.includeContext || 'none' as const,
            stopSequences: params.stopSequences,
            metadata: params.metadata,
            modelPreferences: params.modelPreferences
          };
          
          const response = await server.createMessage(mcpParams);
          
          // Transform MCP response to our expected format
          const result: {
            content: { type: 'text'; text: string };
            model?: string;
            stopReason?: string;
          } = {
            content: {
              type: 'text' as const,
              text: response.content.type === 'text' ? response.content.text : 'Non-text response'
            }
          };
          
          if (response.model) {
            result.model = response.model;
          }
          if (response.stopReason) {
            result.stopReason = response.stopReason;
          }
          
          return result;
        } catch (error) {
          // Fallback response on error
          return {
            content: {
              type: 'text' as const,
              text: 'LLM_EVALUATION_ERROR'
            },
            model: undefined,
            stopReason: undefined
          };
        }
      });
    }
  }

  /**
   * Set LLM sampling callback for enhanced evaluator
   */
  setLLMSamplingCallback(callback: any): void {
    if (this.enhancedEvaluator) {
      this.enhancedEvaluator.setCreateMessageCallback(callback);
    }
  }

  /**
   * Perform comprehensive safety evaluation using enhanced evaluator
   */
  async evaluateCommandSafety(command: string, workingDirectory: string): Promise<any> {
    if (!this.enhancedEvaluator || !this.enhancedConfig.enhanced_mode_enabled) {
      // Fallback to basic classification
      return {
        evaluation_result: 'ALLOW',
        basic_classification: this.classifyCommandSafety(command),
        reasoning: 'Enhanced evaluation not enabled - using basic classification only',
        requires_confirmation: false
      };
    }

    try {
      return await this.enhancedEvaluator.evaluateCommand(command, workingDirectory);
    } catch (error) {
      // Fallback to basic classification on error
      console.warn('Enhanced evaluation failed, falling back to basic classification:', error);
      const basicClassification = this.classifyCommandSafety(command);
      return {
        evaluation_result: basicClassification === 'basic_safe' ? 'ALLOW' : 'CONDITIONAL_DENY',
        basic_classification: basicClassification,
        reasoning: 'Enhanced evaluation failed - using basic classification',
        requires_confirmation: basicClassification !== 'basic_safe'
      };
    }
  }
}
