# Security Evaluation Criteria Improvement Plan

## Overview
Improve the security evaluation system to reduce overly strict assessments while maintaining essential safety protections through dynamic criteria adjustment.

## Current Issues
- **Overly Conservative Evaluation**: Common development workflow commands (npm scripts, build tools) trigger unnecessary confirmation requests
- **Rigid Assessment Criteria**: Fixed evaluation guidelines don't adapt to user workflow patterns
- **Assistant Confirmation Bias**: System defaults to `ai_assistant_confirm` for routine operations

## Phase 1: System Prompt Criteria Relaxation

### 1.1 Current Security Focus
```
Current: "Assess command safety based on: file access patterns, network operations, system modifications, privilege requirements"
```

### 1.2 New Security Focus
```
New: "Prevent reckless, careless, or commands that deviate from user intent"
- Reckless: Commands with destructive potential without clear purpose
- Careless: Commands that could cause unintended side effects
- Intent Deviation: Commands that don't align with established user workflow patterns
```

### 1.3 Evaluation Guidelines Update
- **Primary Goal**: Prevent genuine security risks, not routine development operations
- **Context Awareness**: Consider command history and established workflow patterns
- **Proportional Response**: Match evaluation strictness to actual risk level
- **Development-Friendly**: Allow common development tools without excessive confirmation

### 1.4 Tool Selection Rebalancing
- **allow()**: Default for routine development operations (builds, tests, file operations in project context)
- **ai_assistant_confirm()**: Only when genuinely missing critical information
- **user_confirm()**: For commands with legitimate risk but valid use cases
- **deny()**: For clearly destructive or malicious commands

## Phase 2: Dynamic Criteria Adjustment System

### 2.1 adjust_criteria Tool Implementation
```typescript
interface AdjustCriteriaParams {
  criteria_text: string;           // New criteria content
  append_mode?: boolean;           // true: append, false: overwrite
  backup_existing?: boolean;       // Backup current criteria before change
}
```

### 2.2 Criteria File Management
- **Default Path**: `/tmp/mcp-shell-server/validation_criteria.txt`
- **Environment Override**: `MCP_VALIDATION_CRITERIA_PATH`
- **Auto-creation**: Create directory structure if not exists
- **Backup System**: Automatic timestamped backups when modified

### 2.3 System Prompt Integration
```
## Adjusted Security Criteria
${adjustedCriteria || 'Using default security criteria focused on preventing reckless, careless, or intent-deviating commands'}

**Dynamic Adjustment**: Security criteria can be refined using the adjust_criteria tool to better align with user workflow patterns and intent.
```

### 2.4 Runtime Behavior
- Load criteria file at evaluator initialization
- Include criteria content in system prompt generation
- Re-read criteria file if modification detected
- Fallback to default criteria if file unavailable

## Phase 3: Implementation Steps

### Step 1: System Prompt Modification
1. Update security guidelines in `security-llm-prompt-generator.ts`
2. Replace conservative evaluation criteria
3. Add development workflow recognition
4. Test with common development commands

### Step 2: Criteria File Infrastructure
1. Add environment variable support for criteria path
2. Implement file reading/writing utilities
3. Add criteria loading to prompt generator
4. Create default criteria content

### Step 3: adjust_criteria Tool Development
1. Add tool schema definition
2. Implement criteria validation and saving
3. Add backup functionality
4. Integrate with shell tools interface

### Step 4: Testing and Validation
1. Test criteria loading and application
2. Verify tool functionality
3. Validate backup and recovery
4. Test environment variable override

## Expected Outcomes
- **Reduced False Positives**: Fewer unnecessary confirmations for safe development operations
- **Maintained Security**: Critical protections remain for genuinely risky commands
- **User Adaptability**: Ability to fine-tune evaluation criteria based on specific workflow needs
- **Transparent Control**: Clear visibility into evaluation criteria and ability to modify them

## Risk Mitigation
- **Criteria Validation**: Ensure criteria modifications don't disable essential protections
- **Backup System**: Automatic recovery from problematic criteria changes
- **Default Fallback**: System continues operation even if criteria file is corrupted
- **Audit Trail**: Track criteria modifications for security review

This approach balances security effectiveness with development workflow efficiency while providing transparency and user control over the evaluation process.

## Implementation Priority
1. **Phase 1** (Immediate): System prompt criteria relaxation
2. **Phase 2** (Next): Dynamic criteria adjustment infrastructure
3. **Phase 3** (Final): Tool implementation and testing

## Files to Modify
- `src/security/security-llm-prompt-generator.ts` - Update system prompt criteria
- `src/types/schemas.ts` - Add adjust_criteria tool schema
- `src/tools/shell-tools.ts` - Add adjust_criteria tool implementation
- `src/security/enhanced-evaluator.ts` - Add criteria file loading
