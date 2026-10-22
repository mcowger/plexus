import { describe, expect, it } from 'bun:test';

import { projectReasoningForResponses } from '../utils';

describe('projectReasoningForResponses', () => {
  it('returns undefined when reasoning is absent', () => {
    expect(projectReasoningForResponses(undefined)).toBeUndefined();
  });

  it("projects the Responses-native 'none' level as disabled", () => {
    expect(projectReasoningForResponses({ effort: 'none' })).toEqual({
      effort: 'none',
    });
  });

  it("normalizes the legacy 'off' level to 'none' instead of forwarding it", () => {
    expect(projectReasoningForResponses({ effort: 'off' })).toEqual({
      effort: 'none',
    });
  });

  it('projects enabled: false as disabled', () => {
    expect(projectReasoningForResponses({ enabled: false })).toEqual({
      effort: 'none',
    });
  });

  it('passes through effort and summary verbatim', () => {
    expect(projectReasoningForResponses({ effort: 'high', summary: 'auto' })).toEqual({
      effort: 'high',
      summary: 'auto',
    });
  });

  it('returns undefined when there is nothing Responses-relevant to project', () => {
    expect(projectReasoningForResponses({ enabled: true })).toBeUndefined();
  });
});
