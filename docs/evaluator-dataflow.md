# Enhanced Safety Evaluator Data Flow Visualization

## 1. Main Evaluation Flow

```mermaid
graph TD
    A[evaluateCommand] --> B{Pattern Filtering Enabled?}
    B -->|Yes| C[Basic Classification]
    B -->|No| D[Force llm_required]
    C --> E[Get Command History]
    D --> E
    E --> F[Contextual Evaluation]
    F --> G{LLM Callback Available?}
    G -->|No| H[combineEvaluations - No LLM]
    G -->|Yes| I[performLLMEvaluation]
    I --> J{needsUserIntent?}
    J -->|No| K[combineEvaluations - With LLM]
    J -->|Yes| L[collectExtendedContext]
    L --> M[elicitUserIntent]
    M --> N{elicitationResponse?}
    N -->|No| O[Set userConfirmation as failed]
    N -->|Yes| P{action == 'accept'?}
    P -->|No| Q[Force DENY + Set userConfirmation]
    P -->|Yes| R[Re-evaluate with userIntent]
    O --> S[combineEvaluations - With userConfirmation]
    Q --> S
    R --> S
    K --> T[combineEvaluations - No userConfirmation]
    H --> U[Return SafetyEvaluation]
    S --> U
    T --> U
```

## 2. LLM Evaluation Flow

```mermaid
graph TD
    A[performLLMEvaluation] --> B{checkIfRequiresReaudit?}
    B -->|No| C[Direct LLM Evaluation]
    B -->|Yes| D[collectExtendedContext]
    D --> E[Re-audit LLM Evaluation]
    E --> F[requiresUserIntentElicitation]
    F --> G{needsUserIntent?}
    G -->|No| H[Return reauditResult]
    G -->|Yes| I[elicitUserIntent in performLLM]
    I --> J{userIntent received?}
    J -->|No| K[Return CONDITIONAL_DENY]
    J -->|Yes| L[injectUserIntentIntoHistory]
    L --> M[Final LLM Evaluation with userIntent]
    C --> N[Parse LLM Response]
    M --> N
    N --> O[Return LLMEvaluationResult]
    H --> O
    K --> O
```

## 3. Elicitation Flow

```mermaid
graph TD
    A[elicitUserIntent] --> B{elicitation_enabled?}
    B -->|No| C[Return null, null]
    B -->|Yes| D[createIntentElicitationMessage]
    D --> E[createIntentElicitationSchema]
    E --> F{mcpServer available?}
    F -->|No| G[Log warning + Return null, null]
    F -->|Yes| H[sendIntentElicitationRequest]
    H --> I[MCP elicitation/create request]
    I --> J[Wait for MCP response]
    J --> K{response.action?}
    K -->|accept| L[Create UserIntentData]
    K -->|decline| M[Return null, decline_response]
    K -->|cancel| N[Return null, cancel_response]
    L --> O[Return userIntent, elicitationResponse]
    M --> P[Return null, elicitationResponse]
    N --> P
    G --> Q[Return null, null]
    C --> Q
    O --> R[Back to evaluateCommand]
    P --> R
    Q --> R
```

## 4. Data Flow to Safety Evaluation

```mermaid
graph TD
    A[combineEvaluations] --> B[Receive userConfirmation parameter]
    B --> C{userConfirmation exists?}
    C -->|No| D[Set user fields to undefined]
    C -->|Yes| E[Extract userConfirmation data]
    E --> F[userConfirmation.required → user_confirmation_required]
    F --> G[userConfirmation.response → user_response]
    G --> H[userConfirmation.message → confirmation_message]
    D --> I[Create SafetyEvaluation object]
    H --> I
    I --> J[Return SafetyEvaluation with user data]
```

## 5. Problem Analysis - Missing User Data

```mermaid
graph TD
    A[elicitUserIntent executed] --> B[elicitationResponse received]
    B --> C[userConfirmation object created]
    C --> D{In which evaluation path?}
    D -->|Main evaluateCommand| E[userConfirmation passed to combineEvaluations ✅]
    D -->|performLLMEvaluation re-audit| F[userConfirmation NOT passed up ❌]
    D -->|performLLMEvaluation nested| G[userConfirmation NOT passed up ❌]
    F --> H[Data Lost - Not in final SafetyEvaluation]
    G --> H
    E --> I[Data Present - In final SafetyEvaluation]
```

## 6. Multiple Elicitation Paths Problem

```mermaid
graph TD
    A[Command Input] --> B[evaluateCommand]
    B --> C[performLLMEvaluation]
    C --> D{requiresReaudit?}
    D -->|Yes| E[Re-audit Path]
    D -->|No| F[Direct Path]
    E --> G[collectExtendedContext]
    G --> H[re-audit performLLMEvaluation]
    H --> I[requiresUserIntentElicitation]
    I --> J{needsUserIntent?}
    J -->|Yes| K[🔴 ELICITATION PATH 1: In performLLMEvaluation]
    F --> L[Return to evaluateCommand]
    L --> M[requiresUserIntentElicitation]
    M --> N{needsUserIntent?}
    N -->|Yes| O[🔴 ELICITATION PATH 2: In evaluateCommand]
    K --> P[userConfirmation created in performLLMEvaluation]
    O --> Q[userConfirmation created in evaluateCommand]
    P --> R[❌ Data NOT passed to combineEvaluations]
    Q --> S[✅ Data passed to combineEvaluations]
```

## 7. Solution - Data Flow Fix

```mermaid
graph TD
    A[Fix Required] --> B[Ensure all elicitation results flow to final evaluation]
    B --> C[Option 1: Return userConfirmation from performLLMEvaluation]
    B --> D[Option 2: Simplify elicitation to single path]
    B --> E[Option 3: Pass userConfirmation through all nested calls]
    C --> F[Modify performLLMEvaluation return type]
    D --> G[Remove nested elicitation in performLLMEvaluation]
    E --> H[Add userConfirmation parameter to all functions]
    F --> I[evaluateCommand receives userConfirmation from performLLMEvaluation]
    G --> J[Only elicitate in evaluateCommand]
    H --> K[Thread userConfirmation through call stack]
```

## Problem Summary

The issue is that there are **multiple elicitation execution paths**:

1. **Path 1 (Working)**: `evaluateCommand` → `elicitUserIntent` → `userConfirmation` → `combineEvaluations` ✅
2. **Path 2 (Broken)**: `performLLMEvaluation` → `elicitUserIntent` → `userConfirmation` (lost) ❌
3. **Path 3 (Broken)**: `performLLMEvaluation` (re-audit) → `elicitUserIntent` → `userConfirmation` (lost) ❌

The user confirmation data is created in nested functions but not propagated back to the main evaluation flow.
