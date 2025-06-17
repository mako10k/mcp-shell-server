import { SecurityRestrictions } from '../types/index.js';
import { SecurityError } from '../utils/errors.js';
import { isValidCommand, isValidPath, generateId, getCurrentTimestamp } from '../utils/helpers.js';

export class SecurityManager {
  private restrictions: SecurityRestrictions | null = null;

  constructor() {
    // デフォルトのセキュリティ制限を設定
    this.setDefaultRestrictions();
  }

  private setDefaultRestrictions(): void {
    this.restrictions = {
      restriction_id: generateId(),
      blocked_commands: [
        // システム操作
        'rm',
        'rmdir',
        'del',
        'format',
        'fdisk',
        'mkfs',
        'mount',
        'umount',
        // 権限操作
        'sudo',
        'su',
        'chmod',
        'chown',
        'chgrp',
        // システム制御
        'shutdown',
        'reboot',
        'halt',
        'poweroff',
        'systemctl',
        'service',
        // ネットワーク/ファイアウォール
        'iptables',
        'ufw',
        'firewall-cmd',
        'netsh',
        // パッケージ管理
        'apt',
        'yum',
        'dnf',
        'pacman',
        'brew',
        'npm',
        'pip',
        // コンパイラ/インタープリター（制限付き）
        'gcc',
        'g++',
        'clang',
        'javac',
      ],
      allowed_directories: ['/tmp', '/var/tmp', process.env['HOME'] || '/home', process.cwd()],
      max_execution_time: 300, // 5分
      max_memory_mb: 1024, // 1GB
      enable_network: true,
      active: true,
      configured_at: getCurrentTimestamp(),
    };
  }

  setRestrictions(restrictions: Partial<SecurityRestrictions>): SecurityRestrictions {
    const newRestrictions: SecurityRestrictions = {
      restriction_id: generateId(),
      max_execution_time:
        restrictions.max_execution_time || this.restrictions?.max_execution_time || 300,
      max_memory_mb: restrictions.max_memory_mb || this.restrictions?.max_memory_mb || 1024,
      enable_network: restrictions.enable_network ?? this.restrictions?.enable_network ?? true,
      active: true,
      configured_at: getCurrentTimestamp(),
    };

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

    if (
      !isValidCommand(
        command,
        this.restrictions.allowed_commands,
        this.restrictions.blocked_commands
      )
    ) {
      throw new SecurityError(`Command '${command}' is not allowed by security policy`, {
        command,
        allowedCommands: this.restrictions.allowed_commands,
        blockedCommands: this.restrictions.blocked_commands,
      });
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
      // ファイル操作
      /rm\s+-rf\s+\//, // rm -rf /
      />\s*\/dev\/sd[a-z]/, // > /dev/sda
      /dd\s+.*of=\/dev\//, // dd ... of=/dev/

      // ネットワーク
      /curl\s+.*\|\s*bash/, // curl | bash
      /wget\s+.*\|\s*sh/, // wget | sh

      // 権限昇格
      /sudo\s+/, // sudo
      /su\s+/, // su

      // システム情報収集
      /\/etc\/passwd/, // /etc/passwd
      /\/etc\/shadow/, // /etc/shadow

      // リバースシェル
      /nc\s+.*-e/, // netcat with -e
      /bash\s+-i/, // interactive bash
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
}
