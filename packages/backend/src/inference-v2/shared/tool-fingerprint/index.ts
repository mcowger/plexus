export { buildToolRenamePairs } from './registry';
export { dedupeSyntheticToolCollisions } from './dedupe';
export { injectClaudeCodeIdentity } from './cc-identity';
export { signBillingHeader } from './sign-billing';
export { applyClaudeCodeMasking, type ClaudeCodeMaskingResult } from './apply-masking';
export { getStainlessHeaders } from './cc-headers';
export { reverseToolRenames } from './reverse-rename';
export { REQUIRED_BETAS } from './cc-constants';
export type { RenamePair, ToolDescriptor, ToolShape } from './types';
