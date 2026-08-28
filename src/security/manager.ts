import { SecurityModeSchema } from '../types/index.js';
import type { SecurityRestrictions, SecurityMode } from '../types/index.js';
import {
  EnhancedSecurityConfig,
  DEFAULT_ENHANCED_SECURITY_CONFIG,
  DEFAULT_BASIC_SAFETY_RULES,
  CommandClassification,
  BasicSafetyRule,
} from '../types/enhanced-security.js';
import { SecurityBoundaryError, SecurityError } from '../utils/errors.js';
import { isValidPath, generateId, getCurrentTimestamp } from '../utils/helpers.js';
import type { ExecutionBoundary, ExecutionRoute } from './execution-boundary.js';
import { EnhancedSafetyEvaluator } from './enhanced-evaluator.js';
import { createMessageCallbackFromMCPServer, type CreateMessageCallback } from './chat-completion-adapter.js';
import type { ElicitationHandler } from './evaluator-types.js';
import { CommandHistoryManager } from '../core/enhanced-history-manager.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

// Import SafetyEvaluationResult from types
import type { SafetyEvaluationResult } from '../types/index.js';

export class SecurityManager {
  private restrictions: SecurityRestrictions | null = null;
  private enhancedConfig: EnhancedSecurityConfig;
  private basicSafetyRules: BasicSafetyRule[];
  private enhancedEvaluator?: EnhancedSafetyEvaluator;
  private historyManager?: CommandHistoryManager;

  constructor(config?: EnhancedSecurityConfig) {
    this.enhancedConfig = config ? { ...config } : { ...DEFAULT_ENHANCED_SECURITY_CONFIG };
    this.basicSafetyRules = [...DEFAULT_BASIC_SAFETY_RULES];

    // Load Enhanced Security configuration from environment variables
    this.loadEnhancedConfigFromEnv();

    // Set default security restrictions
    this.setDefaultRestrictions();
  }

  private setDefaultRestrictions(): void {
    // Get default settings from environment variables
    const defaultMode = this.parseSecurityMode(
      process.env['MCP_SHELL_SECURITY_MODE'] ?? 'permissive'
    );
    const defaultExecutionTime = parseInt(process.env['MCP_SHELL_MAX_EXECUTION_TIME'] || '300');
    const defaultMemoryMb = parseInt(process.env['MCP_SHELL_MAX_MEMORY_MB'] || '1024');
    const defaultNetworkEnabled = process.env['MCP_SHELL_ENABLE_NETWORK'] !== 'false';

    // Automatic configuration for Enhanced Mode
    if (defaultMode === 'enhanced' || defaultMode === 'enhanced-fast') {
      this.enhancedConfig.enhanced_mode_enabled = true;
      this.enhancedConfig.llm_evaluation_enabled = true;

      // For enhanced-fast, enable safe command skipping
      this.enhancedConfig.enable_pattern_filtering = defaultMode === 'enhanced-fast';
    }

    this.restrictions = {
      restriction_id: generateId(),
      security_mode: defaultMode,
      max_execution_time: defaultExecutionTime, // 5 minutes
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
    } else if (process.env['MCP_SHELL_ENHANCED_MODE'] === 'false') {
      this.enhancedConfig.enhanced_mode_enabled = false;
    }

    // LLM evaluation (backward compatibility)
    if (process.env['MCP_SHELL_LLM_EVALUATION'] === 'true') {
      this.enhancedConfig.llm_evaluation_enabled = true;
    } else if (process.env['MCP_SHELL_LLM_EVALUATION'] === 'false') {
      this.enhancedConfig.llm_evaluation_enabled = false;
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
      this.enhancedConfig.llm_provider = process.env['MCP_SHELL_LLM_PROVIDER'] as
        | 'openai'
        | 'anthropic'
        | 'custom';
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
    const securityMode = this.parseSecurityMode(
      restrictions.security_mode ?? this.restrictions?.security_mode ?? 'permissive'
    );
    const newRestrictions: SecurityRestrictions = {
      restriction_id: generateId(),
      security_mode: securityMode,
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

  private parseSecurityMode(mode: unknown): SecurityMode {
    const parsedMode = SecurityModeSchema.safeParse(mode);
    if (!parsedMode.success) {
      throw new SecurityBoundaryError(
        'SECURITY_CONFIGURATION_INVALID',
        'MCP_SHELL_SECURITY_MODE must select a supported security mode.',
        { configuredMode: mode }
      );
    }
    return parsedMode.data;
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
  // permissive mode: legacy dangerous pattern blocking removed.
  // Intentionally no blocking here; rely on evaluator & downstream validation.
        break;

      case 'moderate':
  // moderate mode: legacy dangerous pattern blocking removed.
  // (Could add lightweight heuristics here in future if needed.)
        break;

      case 'enhanced':
      case 'enhanced-fast':
        // enhanced mode: Enhanced Safety Evaluator performs all validation
        // No pattern checks at validateCommand stage
        // All validation is delegated to Enhanced Safety Evaluator
        // Legacy pattern matching detection is completely skipped
        break;

      case 'restrictive':
        // Full shell syntax is permitted only inside the restrictive Bubblewrap profile.
        break;

      case 'custom':
        throw new SecurityBoundaryError(
          'CUSTOM_MODE_MIGRATION_REQUIRED',
          'Legacy custom command policies cannot execute. Migrate to an approved sandbox profile.',
          { command }
        );
    }
  }

  resolveExecutionBoundary(route: ExecutionRoute): ExecutionBoundary {
    if (!this.restrictions?.active) {
      return { kind: 'host' };
    }

    if (this.restrictions.security_mode === 'custom') {
      throw new SecurityBoundaryError(
        'CUSTOM_MODE_MIGRATION_REQUIRED',
        'Legacy custom command policies cannot execute. Migrate to an approved sandbox profile.'
      );
    }

    if (this.restrictions.security_mode !== 'restrictive') {
      return { kind: 'host' };
    }

    if (route.remote) {
      throw new SecurityBoundaryError(
        'SANDBOX_REMOTE_UNAVAILABLE',
        'Remote execution is unavailable for restrictive sandbox requests.'
      );
    }
    if (route.createTerminal) {
      throw new SecurityBoundaryError(
        'SANDBOX_TERMINAL_UNAVAILABLE',
        'Interactive terminal execution is unavailable for restrictive sandbox requests.'
      );
    }
    if (route.executionMode === 'detached') {
      throw new SecurityBoundaryError(
        'SANDBOX_DETACHED_UNAVAILABLE',
        'Detached execution is unavailable for restrictive sandbox requests.'
      );
    }
    if (route.hasEnvironmentOverrides) {
      throw new SecurityBoundaryError(
        'SANDBOX_ENV_UNSUPPORTED',
        'Environment overrides are unavailable for restrictive sandbox requests.'
      );
    }

    return { kind: 'sandbox', profile: 'restrictive-v1' };
  }

  assertTerminalMutationAllowed(): void {
    this.resolveExecutionBoundary({
      remote: false,
      executionMode: 'foreground',
      createTerminal: true,
      hasEnvironmentOverrides: false,
    });
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

  // Legacy detectDangerousPatterns removed (Phase-out); rely on LLM & basic safety rules.

  auditCommand(command: string, workingDirectory?: string): void {
    // Enhanced Security Modeの場合は従来の危険パターン検出をスキップ
    // Enhanced Safety Evaluator performs all validation
    if (
      this.restrictions?.security_mode === 'enhanced' ||
      this.restrictions?.security_mode === 'enhanced-fast'
    ) {
      // Rely only on Enhanced Safety Evaluator
      this.validateCommand(command);

      if (workingDirectory) {
        this.validatePath(workingDirectory);
      }
      return;
    }

  // Legacy dangerous pattern blocking removed. Proceed to command/path validation.

    // Additional security checks
    this.validateCommand(command);

    if (workingDirectory) {
      this.validatePath(workingDirectory);
    }
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
   * Check if enhanced security mode is enabled
   */
  isEnhancedModeEnabled(): boolean {
    const enabled = this.enhancedConfig.enhanced_mode_enabled;
    console.error('isEnhancedModeEnabled() called:', enabled);
    return enabled;
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
        reasoning: 'Basic safety classification is disabled',
      };
    }

    if (!trimmedCommand) {
      return {
        classification: 'basic_safe',
        reasoning: 'Empty command',
        safety_level: 1,
      };
    }

  // (Legacy dangerous pattern shortcut removed – allow classification to fall through to rules/LLM.)

    // Check basic safety rules
    for (const rule of this.basicSafetyRules) {
      try {
        const regex = new RegExp(rule.pattern);
        if (regex.test(trimmedCommand)) {
          return {
            classification: rule.safety_level <= 3 ? 'basic_safe' : 'llm_required',
            reasoning: rule.reasoning,
            safety_level: rule.safety_level,
            matched_rule: rule.pattern,
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
      safety_level: 4,
    };
  }

  /**
   * Initialize Enhanced Safety Evaluator
   */
  initializeEnhancedEvaluator(
    historyManager: CommandHistoryManager,
    server?: Server,
    createMessage?: CreateMessageCallback,
    elicitationHandler?: ElicitationHandler
  ): void {
    if (!this.enhancedConfig.enhanced_mode_enabled) {
      return;
    }

    this.historyManager = historyManager;

    if (!createMessage) {
      if (!server) {
        throw new Error(
          'Enhanced security mode requires an LLM provider but no server or LanguageModel adapter was provided.'
        );
      }
      createMessage = createMessageCallbackFromMCPServer(server);
    }

    if (!server && !elicitationHandler) {
      this.setEnhancedConfig({ elicitation_enabled: false });
    }

    this.enhancedEvaluator = new EnhancedSafetyEvaluator(
      this,
      historyManager,
      createMessage,
      server,
      elicitationHandler
    );

    if (server) {
      this.enhancedEvaluator.setMCPServer(server);
    }
  }

  /**
   * Perform comprehensive safety evaluation using enhanced evaluator
   */
  async evaluateCommandSafetyByEnhancedEvaluator(
    command: string,
    workingDirectory: string,
    comment?: string,
    forceUserConfirm?: boolean
  ): Promise<SafetyEvaluationResult> {
    if (!this.enhancedConfig.enhanced_mode_enabled) {
      throw new Error('Enhanced mode is not enabled');
    }

    if (!this.enhancedEvaluator) {
      throw new Error('Enhanced evaluator not initialized');
    }
    
    // Get recent command history for context
    const history = this.historyManager ? this.historyManager.searchHistory({ limit: 10 }) : [];
    
    console.error(`[DEBUG] Enhanced Evaluator - Command: ${command}`);
    console.error(`[DEBUG] Enhanced Evaluator - History entries: ${history.length}`);
    console.error(`[DEBUG] Enhanced Evaluator - History commands: ${history.map((h: { command: string }) => h.command).join(', ')}`);
    
    return await this.enhancedEvaluator.evaluateCommandSafety(command, workingDirectory, history, comment, forceUserConfirm);
  }
}
