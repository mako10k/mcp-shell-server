import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import { ShellExecuteParamsSchema } from '../../packages/shell-server/src/types/schemas.js';

describe('Explanation Parameter Validation', () => {
  it('should reject explanation parameter with clear error message', () => {
    const invalidParams = {
      command: 'ls -la',
      explanation: 'List directory contents', // This should be rejected
    };

    expect(() => ShellExecuteParamsSchema.parse(invalidParams)).toThrow(ZodError);

    try {
      ShellExecuteParamsSchema.parse(invalidParams);
    } catch (error) {
      if (error instanceof ZodError) {
        // Check that the error contains information about unrecognized keys
        const errorMessages = error.errors.map((err) => err.message);
        expect(
          errorMessages.some(
            (msg) => msg.includes('Unrecognized key') || msg.includes('explanation')
          )
        ).toBe(true);
      }
    }
  });

  it('should reject isBackground parameter (VS Code internal tool parameter)', () => {
    const invalidParams = {
      command: 'npm install',
      isBackground: true, // This should be rejected
    };

    expect(() => ShellExecuteParamsSchema.parse(invalidParams)).toThrow(ZodError);
  });

  it('should accept valid parameters without explanation', () => {
    const validParams = {
      command: 'ls -la',
      execution_mode: 'foreground' as const,
      working_directory: '/tmp',
    };

    expect(() => ShellExecuteParamsSchema.parse(validParams)).not.toThrow();

    const parsed = ShellExecuteParamsSchema.parse(validParams);
    expect(parsed.command).toBe('ls -la');
    expect(parsed.execution_mode).toBe('foreground');
    expect(parsed.working_directory).toBe('/tmp');
  });

  it('should have clear description warning about VS Code parameters', () => {
    // Test that the schema description contains warnings about VS Code parameters
    const unwrap = (schema: unknown): unknown => {
      let current = schema as { _def?: { schema?: unknown; innerType?: () => unknown } };
      while (current?._def?.schema || current?._def?.innerType) {
        if (current._def?.schema) {
          current = current._def.schema as typeof current;
          continue;
        }
        if (current._def?.innerType) {
          current = current._def.innerType() as typeof current;
          continue;
        }
        break;
      }
      return current;
    };

    const innerSchema = unwrap(ShellExecuteParamsSchema) as {
      _def?: { shape?: () => Record<string, { description?: string }> };
      shape?: Record<string, { description?: string }>;
    };
    const shape = typeof innerSchema._def?.shape === 'function'
      ? innerSchema._def.shape()
      : innerSchema.shape;
    const commandSchema = shape?.command;
    if (!commandSchema) {
      throw new Error('Command schema not found on ShellExecuteParamsSchema');
    }
    const description = commandSchema.description;

    expect(description).toContain('MCP Shell Server');
    expect(description).toContain('explanation');
    expect(description).toContain('run_in_terminal');
  });

  it('should reject multiple VS Code internal parameters at once', () => {
    const invalidParams = {
      command: 'echo "test"',
      explanation: 'Run echo command',
      isBackground: false,
    };

    expect(() => ShellExecuteParamsSchema.parse(invalidParams)).toThrow(ZodError);
  });
});
