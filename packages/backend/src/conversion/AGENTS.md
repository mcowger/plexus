

## Description
standalone utility to convert various API requests to LanguageModelV2Prompt format and call options.

## File to Create
- Single self-contained converter files
- All types and helper functions in one location
- Uses package imports (not relative imports)

## Implementation Approach

### 1. Type Definitions

Define all types inline (no relative imports):
```typescript
// Import from packages only
import { LanguageModelV2Prompt, LanguageModelV2CallOptions } from '@ai-sdk/provider';
import { JSONSchema7 } from 'json-schema';
