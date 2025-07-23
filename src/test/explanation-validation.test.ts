import { describe, it, expect, beforeEach } from 'vitest';
import { ZodError } from 'zod';
import { ShellExecuteParamsSchema } from '../types/schemas.js';

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
        const errorMessages = error.errors.map(err => err.message);
        expect(errorMessages.some(msg => msg.includes('Unrecognized key') || msg.includes('explanation'))).toBe(true);
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
    const schemaDefinition = ShellExecuteParamsSchema._def;
    // Access the inner schema since it's wrapped in a refine
    const innerSchema = schemaDefinition.schema;
    const commandSchema = innerSchema.shape.command;
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
