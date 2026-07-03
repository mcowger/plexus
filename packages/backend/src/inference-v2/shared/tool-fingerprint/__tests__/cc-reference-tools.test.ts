import { describe, expect, it } from 'vitest';
import { CC_TOOL_REFERENCE, matchesReferenceShape } from '../cc-reference-tools';

describe('matchesReferenceShape', () => {
  it('matches when required params are identical and in the same order', () => {
    expect(matchesReferenceShape('Bash', ['command'])).toBe(true);
    expect(matchesReferenceShape('Write', ['file_path', 'content'])).toBe(true);
  });

  it('matches when required params are identical but in a different order', () => {
    // Reference lists Edit as [file_path, old_string, new_string]; a caller
    // schema can list its `required` array in any order and still be the
    // same tool.
    expect(matchesReferenceShape('Edit', ['new_string', 'file_path', 'old_string'])).toBe(true);
  });

  it('matches a reference tool with no required params when given an empty array', () => {
    expect(matchesReferenceShape('TaskList', [])).toBe(true);
    expect(matchesReferenceShape('Workflow', [])).toBe(true);
  });

  it('does not match when the caller has an extra required param', () => {
    expect(matchesReferenceShape('Bash', ['command', 'timeout'])).toBe(false);
  });

  it('does not match when the caller is missing a required param', () => {
    expect(matchesReferenceShape('Edit', ['file_path', 'old_string'])).toBe(false);
  });

  it('does not match when required param names differ (e.g. camelCase vs snake_case)', () => {
    // The exact opencode-vs-real-CC collision this table exists to catch.
    expect(matchesReferenceShape('Write', ['filePath', 'content'])).toBe(false);
    expect(matchesReferenceShape('Edit', ['filePath', 'oldString', 'newString'])).toBe(false);
  });

  it('does not match an unknown tool name (not in the reference table)', () => {
    expect(matchesReferenceShape('glob', ['pattern'])).toBe(false);
    expect(matchesReferenceShape('NotARealTool', [])).toBe(false);
  });

  it('is case-sensitive on the tool name', () => {
    expect(matchesReferenceShape('bash', ['command'])).toBe(false);
    expect(matchesReferenceShape('BASH', ['command'])).toBe(false);
  });

  it('does not match when requiredParams is undefined, even against a zero-required reference tool', () => {
    // A caller schema with no `required` field at all is indistinguishable
    // here from "unknown shape" — matchesReferenceShape treats that as a
    // mismatch rather than assuming it's compatible, even for reference
    // tools whose own required list is empty (TaskList, Workflow, ...).
    // cc-collision-shape.ts callers should be aware this means such a tool
    // gets flagged for rename.
    expect(matchesReferenceShape('TaskList', undefined)).toBe(false);
    expect(matchesReferenceShape('Bash', undefined)).toBe(false);
  });

  it('ignores duplicate entries within the required arrays being compared', () => {
    expect(matchesReferenceShape('Bash', ['command', 'command'])).toBe(true);
  });

  it('keeps CC_TOOL_REFERENCE entries as arrays (order-independent by contract)', () => {
    for (const [name, required] of Object.entries(CC_TOOL_REFERENCE)) {
      expect(Array.isArray(required)).toBe(true);
      // Sanity: matching the reference against itself is always true.
      expect(matchesReferenceShape(name, [...required])).toBe(true);
    }
  });
});
