/**
 * JSON Repair Utility
 * 
 * Provides fallback mechanisms to repair common JSON formatting issues
 * that can occur when LLMs generate malformed JSON responses.
 */

export interface JsonRepairResult {
  success: boolean;
  value?: unknown;
  originalError?: string;
  repairAttempts?: string[];
  finalError?: string;
}

/**
 * Attempts to repair and parse malformed JSON strings.
 * Uses multiple repair strategies in sequence.
 */
export function repairAndParseJson(jsonString: string): JsonRepairResult {
  const result: JsonRepairResult = {
    success: false,
    repairAttempts: []
  };

  // Try original JSON first
  try {
    const parsed = JSON.parse(jsonString);
    result.success = true;
    result.value = parsed;
    return result;
  } catch (originalError) {
    result.originalError = originalError instanceof Error ? originalError.message : String(originalError);
  }

  // Repair strategies to try in order
  const repairStrategies = [
    fixShellEscapeSequences,
    fixQuoteIssues,
    fixAdvancedEscaping,
    fixTrailingCommas,
    fixUnquotedKeys,
    fixControlCharacters,
    fixComplexQuotePatterns,
    extractJsonFromText
  ];

  for (const strategy of repairStrategies) {
    try {
      const repairedJson = strategy(jsonString);
      if (result.repairAttempts) {
        result.repairAttempts.push(`Strategy ${strategy.name}: ${repairedJson.substring(0, 200)}...`);
      }
      
      const parsed = JSON.parse(repairedJson);
      result.success = true;
      result.value = parsed;
      return result;
    } catch (error) {
      // Log the error for debugging
      if (result.repairAttempts) {
        result.repairAttempts.push(`Strategy ${strategy.name} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      continue;
    }
  }

  result.finalError = 'All repair strategies failed';
  return result;
}

/**
 * Fix shell escape sequences that are invalid in JSON
 */
function fixShellEscapeSequences(json: string): string {
  let fixed = json;
  
  // Fix the main problem: \; (backslash semicolon) in JSON strings
  // This is a shell escape but invalid JSON escape sequence
  fixed = fixed.replace(/\\;/g, '\\\\;');
  
  // Also fix other problematic shell sequences
  fixed = fixed.replace(/\\{/g, '\\\\{');
  fixed = fixed.replace(/\\}/g, '\\\\}');
  fixed = fixed.replace(/\\\*/g, '\\\\*');
  fixed = fixed.replace(/\\\?/g, '\\\\?');
  
  // Fix pattern where backslash is followed by quote within JSON string
  // Pattern: \"Found: {}\" \; should become \"Found: {}\" \\;
  fixed = fixed.replace(/" \\;/g, '" \\\\;');
  
  return fixed;
}

/**
 * Fix common quote-related issues
 */
function fixQuoteIssues(json: string): string {
  let fixed = json;
  
  // Replace smart quotes with regular quotes
  fixed = fixed.replace(/[""]/g, '"');
  fixed = fixed.replace(/['']/g, "'");
  
  // Fix single quotes around strings (but not inside strings)
  fixed = fixed.replace(/:\s*'([^']*?)'/g, ': "$1"');
  fixed = fixed.replace(/{\s*'([^']*?)':/g, '{"$1":');
  fixed = fixed.replace(/,\s*'([^']*?)':/g, ', "$1":');
  
  // Fix unescaped quotes within strings
  fixed = fixed.replace(/"([^"]*?)"([^"]*?)"([^"]*?)"/g, (_match, p1, p2, p3) => {
    // If p2 contains unescaped quotes, escape them
    const escapedP2 = p2.replace(/"/g, '\\"');
    return `"${p1}${escapedP2}${p3}"`;
  });
  
  return fixed;
}

/**
 * Advanced escaping fixes for command patterns
 */
function fixAdvancedEscaping(json: string): string {
  let fixed = json;
  
  // Fix shell commands with complex quoting patterns
  // Pattern: find /tmp -name "*.tmp" -exec echo "Found: {}" \;
  fixed = fixed.replace(
    /"command":\s*"([^"]*find[^"]*-name[^"]*)"([^"]*)"([^"]*-exec[^"]*echo[^"]*)"([^"]*)"([^"]*\\;[^"]*)"/g,
    (_match, p1, p2, p3, p4, p5) => {
      const escapedCommand = `${p1}\\"${p2}\\"${p3}\\"${p4}\\"${p5}`;
      return `"command": "${escapedCommand}"`;
    }
  );
  
  // Fix reasoning fields with embedded quotes
  fixed = fixed.replace(
    /"reasoning":\s*"([^"]*)"([^"]*)"([^"]*)"([^"]*)"([^"]*)"/g,
    (_match, p1, p2, p3, p4, p5) => {
      const escapedReasoning = `${p1}\\"${p2}\\"${p3}\\"${p4}\\"${p5}`;
      return `"reasoning": "${escapedReasoning}"`;
    }
  );
  
  return fixed;
}

/**
 * Fix complex quote patterns including nested quotes
 */
function fixComplexQuotePatterns(json: string): string {
  let fixed = json;
  
  // Strategy: Find string values that contain unescaped quotes and fix them
  // This is more aggressive - looks for patterns like "field": "value"with"quotes"
  const stringFieldRegex = /"(\w+)":\s*"([^"]*(?:"[^"]*)*[^"]*)"/g;
  
  fixed = fixed.replace(stringFieldRegex, (match, fieldName, value) => {
    // Count quotes in the value
    const quoteCount = (value.match(/"/g) || []).length;
    
    // If we have unescaped quotes, escape them
    if (quoteCount > 0) {
      // Simple replacement - escape all internal quotes
      const escapedValue = value.replace(/"/g, '\\"');
      return `"${fieldName}": "${escapedValue}"`;
    }
    
    return match;
  });
  
  // Also handle specific problematic patterns we've seen
  // Pattern: "text with "quotes" inside"
  fixed = fixed.replace(
    /"([^"]*)"([^"]*)"([^"]*)"/g,
    '"$1\\"$2\\"$3"'
  );
  
  return fixed;
}

/**
 * Remove trailing commas
 */
function fixTrailingCommas(json: string): string {
  let fixed = json;
  
  // Remove trailing commas before closing brackets/braces
  fixed = fixed.replace(/,\s*]/g, ']');
  fixed = fixed.replace(/,\s*}/g, '}');
  
  return fixed;
}

/**
 * Quote unquoted object keys
 */
function fixUnquotedKeys(json: string): string {
  let fixed = json;
  
  // Quote unquoted keys
  fixed = fixed.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
  
  return fixed;
}

/**
 * Fix control characters and line breaks
 */
function fixControlCharacters(json: string): string {
  let fixed = json;
  
  // Replace actual newlines with escaped newlines within strings
  fixed = fixed.replace(/"([^"]*?)\n([^"]*?)"/g, '"$1\\n$2"');
  fixed = fixed.replace(/"([^"]*?)\r([^"]*?)"/g, '"$1\\r$2"');
  fixed = fixed.replace(/"([^"]*?)\t([^"]*?)"/g, '"$1\\t$2"');
  
  return fixed;
}

/**
 * Try to extract JSON from text that might have extra content
 */
function extractJsonFromText(text: string): string {
  // Look for JSON-like structure
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }
  
  // Look for array structure
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    return arrayMatch[0];
  }
  
  throw new Error('No JSON structure found');
}

/**
 * Advanced repair attempt using regex-based fixes for common LLM errors
 */
export function advancedJsonRepair(jsonString: string): string {
  let fixed = jsonString.trim();
  
  // Fix common LLM mistakes
  
  // 1. Fix reasoning field with unescaped quotes
  fixed = fixed.replace(
    /"reasoning":\s*"([^"]*?)"([^"]*?)"([^"]*?)"/g,
    (_match, p1, p2, p3) => {
      const escapedContent = `${p1}\\"${p2}\\"${p3}`;
      return `"reasoning": "${escapedContent}"`;
    }
  );
  
  // 2. Fix command field with unescaped quotes
  fixed = fixed.replace(
    /"command":\s*"([^"]*?)"([^"]*?)"([^"]*?)"/g,
    (_match, p1, p2, p3) => {
      const escapedContent = `${p1}\\"${p2}\\"${p3}`;
      return `"command": "${escapedContent}"`;
    }
  );
  
  // 3. Apply all other repair strategies
  fixed = fixQuoteIssues(fixed);
  fixed = fixTrailingCommas(fixed);
  fixed = fixUnquotedKeys(fixed);
  fixed = fixControlCharacters(fixed);
  
  return fixed;
}
