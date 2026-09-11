export const ARRAY_FIELD_PAYLOAD = {
  model: 'gpt-5.5',
  messages: [
    { role: 'user', content: 'hi', some_field: 'x' },
    { role: 'assistant', content: 'yo' },
  ],
};

export const NESTED_ARRAY_PAYLOAD = {
  messages: [{ role: 'user', meta: { keep: 1, drop: 2 } }],
};

export const STRUCTURAL_MESSAGE_NAME_PAYLOAD = {
  model: 'gpt-4o',
  messages: [
    { role: 'user', content: 'hi', name: 'bob!' },
    { role: 'assistant', content: 'yo' },
  ],
};

export const BRACKET_MESSAGE_NAME_PAYLOAD = {
  model: 'gpt-4o',
  messages: [
    { role: 'user', content: 'hi', name: 'bob!' },
    { role: 'assistant', content: 'yo' },
  ],
};

export const STRUCTURAL_TOOLS_PAYLOAD = {
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'hi' }],
  tools: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
};

export const ARRAY_INDEX_TOOL_A = { type: 'function', name: 'a' };
export const ARRAY_INDEX_TOOL_B = { type: 'function', name: 'b' };
export const ARRAY_INDEX_TOOL_C = { type: 'function', name: 'c' };

export const ARRAY_INDEX_TOOLS_PAYLOAD = {
  model: 'gpt-5.5',
  tools: [ARRAY_INDEX_TOOL_A, ARRAY_INDEX_TOOL_B, ARRAY_INDEX_TOOL_C],
};

export const SHARED_MESSAGES = [{ role: 'user', content: 'hi', bad_field: 1 }];

export const SHARED_MESSAGES_PAYLOAD = {
  model: 'claude-x',
  messages: SHARED_MESSAGES,
};

export const TOP_LEVEL_TOOLS_PAYLOAD = {
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'hi' }],
  tools: [{ type: 'function', function: { name: 'f' } }],
};

export const PROMPT_CACHE_KEY_PAYLOAD = {
  model: 'openai/gpt-5.5',
  input: 'hello',
  prompt_cache_key: 'cache-key-123',
};

export const PROMPT_CACHE_METADATA_PAYLOAD = {
  model: 'openai/gpt-5.5',
  input: 'hello',
  metadata: { prompt_cache_key: 'cache-key-123', session: 's1' },
};

export const THINKING_SIGNATURE_ERROR_RESPONSE_BODY = JSON.stringify({
  type: 'error',
  error: {
    type: 'invalid_request_error',
    message: 'messages.3.content.0: Invalid `signature` in `thinking` block',
  },
  request_id: 'req_test123',
});

export const THINKING_SIGNATURE_PLAN_ERROR_BODY = JSON.stringify({
  error: { message: 'messages.3.content.0: Invalid `signature` in `thinking` block' },
});

export const RESPONSES_API_PAYLOAD = { model: 'gpt-5.5', input: 'hi' };
export const ANTHROPIC_MESSAGES_PAYLOAD = { model: 'claude-x', messages: [] };

export const THINKING_TEXT_PAYLOAD = {
  model: 'claude-x',
  messages: [
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'stale reasoning', signature: 'sig-from-model-a' },
        { type: 'text', text: 'the answer' },
      ],
    },
  ],
};

export const THINKING_TOOL_USE_PAYLOAD = {
  model: 'claude-x',
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'do the thing' }] },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'stale reasoning', signature: 'sig-from-model-a' },
        { type: 'tool_use', id: 'tool-1', name: 'search', input: { q: 'x' } },
      ],
    },
  ],
};

export const REDACTED_THINKING_PAYLOAD = {
  model: 'claude-x',
  messages: [
    {
      role: 'assistant',
      content: [
        { type: 'redacted_thinking', data: 'opaque-encrypted-payload' },
        { type: 'text', text: 'the answer' },
      ],
    },
  ],
};

export const MULTIPLE_THINKING_BLOCKS_PAYLOAD = {
  messages: [
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'a', signature: 'sig-a' },
        { type: 'redacted_thinking', data: 'b' },
        { type: 'text', text: 'the answer' },
      ],
    },
  ],
};

export const PLAIN_STRING_MESSAGES_PAYLOAD = {
  messages: [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi there' },
  ],
};

export const ARRAY_CONTENT_NO_THINKING_PAYLOAD = {
  model: 'gpt-4o',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
};

export const THINKING_COPY_ON_WRITE_UNTOUCHED_MESSAGE = {
  role: 'user',
  content: [{ type: 'text', text: 'hi' }],
};

export const THINKING_COPY_ON_WRITE_PAYLOAD = {
  model: 'claude-x',
  messages: [
    THINKING_COPY_ON_WRITE_UNTOUCHED_MESSAGE,
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'stale', signature: 'sig-a' },
        { type: 'text', text: 'answer' },
      ],
    },
  ],
};

export const THINKING_ONLY_END_PAYLOAD = {
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'stale', signature: 'sig-a' }],
    },
  ],
};

export const THINKING_ONLY_ALTERNATION_PAYLOAD = {
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'first' }] },
    {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'stale', signature: 'sig-a' }],
    },
    { role: 'user', content: [{ type: 'text', text: 'second' }] },
  ],
};

export const THINKING_ORPHAN_TOOL_RESULT_PAYLOAD = {
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'q' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'partial answer, no tool call' }] },
    {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'stale', signature: 'sig-a' }],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'result' }],
    },
  ],
};

export const THINKING_PAIRED_TOOL_RESULT_PAYLOAD = {
  messages: [
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tool-1', name: 'search', input: {} }],
    },
    {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'stale', signature: 'sig-a' }],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'result' }],
    },
  ],
};

export const ADVISOR_INVOCATION = {
  type: 'server_tool_use',
  id: 'srvtoolu_abc',
  name: 'advisor',
  input: {},
};

export const ADVISOR_RESULT = {
  type: 'advisor_tool_result',
  tool_use_id: 'srvtoolu_abc',
  content: { type: 'advisor_redacted_result', encrypted_content: 'EqQhCio-sealed-by-account-a' },
};

export const ADVISOR_SINGLE_MESSAGE_PAYLOAD = {
  model: 'claude-x',
  messages: [
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'let me consult' }, ADVISOR_INVOCATION, ADVISOR_RESULT],
    },
  ],
};

export const ADVISOR_SEPARATE_MESSAGES_PAYLOAD = {
  messages: [
    { role: 'assistant', content: [{ type: 'text', text: 'thinking' }, ADVISOR_INVOCATION] },
    { role: 'assistant', content: [ADVISOR_RESULT, { type: 'text', text: 'the answer' }] },
  ],
};

export const ADVISOR_UNRELATED_TOOL_PAYLOAD = {
  messages: [
    {
      role: 'assistant',
      content: [
        { type: 'server_tool_use', id: 'srvtoolu_web', name: 'web_search', input: {} },
        ADVISOR_INVOCATION,
        ADVISOR_RESULT,
      ],
    },
  ],
};

export const ADVISOR_PLACEHOLDER_PAYLOAD = {
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'q1' }] },
    { role: 'assistant', content: [ADVISOR_INVOCATION, ADVISOR_RESULT] },
    { role: 'user', content: [{ type: 'text', text: 'q2' }] },
  ],
};

export const ADVISOR_DROP_PAYLOAD = {
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'q1' }] },
    { role: 'assistant', content: [ADVISOR_INVOCATION, ADVISOR_RESULT] },
  ],
};

export const ADVISOR_NO_RESULT_PAYLOAD = {
  model: 'claude-x',
  messages: [{ role: 'assistant', content: [{ type: 'text', text: 'hi' }] }],
};

export const ADVISOR_RESULT_ERROR_RESPONSE_BODY = JSON.stringify({
  type: 'error',
  error: {
    type: 'invalid_request_error',
    message: 'Advisor tool result content could not be processed.',
  },
  request_id: 'req_test123',
});

export const ADVISOR_RESULT_PLAN_ERROR_BODY = JSON.stringify({
  error: { message: 'Advisor tool result content could not be processed.' },
});

export const LITE_UNSUPPORTED_TOOLS_ERROR_BODY = JSON.stringify({
  error: {
    message:
      'X-OpenAI-Internal-Codex-Responses-Lite only supports function tools, custom tools, and client-executed tool search.',
  },
});

export const LITE_MIXED_TOOLS_PAYLOAD = {
  model: 'gpt-5.6-luna',
  tools: [
    { type: 'function', name: 'exec_command' },
    { type: 'web_search' },
    { type: 'custom', name: 'apply_patch' },
    { type: 'tool_search' },
    { type: 'image_generation' },
  ],
};
