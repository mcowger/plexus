export const TINY_IMAGE_B64 = 'aGVsbG8=';
export const TINY_IMAGE_MARKDOWN = `![generated image](data:image/png;base64,${TINY_IMAGE_B64})`;

export const OVERSIZED_IMAGE_RESULT_6_MB = 'A'.repeat(8 * 1024 * 1024 + 1);
export const AT_LIMIT_IMAGE_RESULT = 'A'.repeat(8 * 1024 * 1024);
export const OVERSIZED_IMAGE_RESULT_12_MB = 'B'.repeat(2 * 8 * 1024 * 1024);
export const NATIVE_OVERSIZED_IMAGE_RESULT = 'C'.repeat(2 * 8 * 1024 * 1024);
export const UNARY_OVERSIZED_IMAGE_RESULT = 'D'.repeat(8 * 1024 * 1024 + 1);
export const IMAGE_PLACEHOLDER_12_MB = '[generated image omitted: 12.0 MB exceeds inline limit]';
export const AUTHORED_WITH_MARKDOWN = `Check this markdown I wrote myself:\n${TINY_IMAGE_MARKDOWN}\nNeat, right?`;
export const AUTHORED_WITH_PLACEHOLDER = `If a file is too large you may see "${IMAGE_PLACEHOLDER_12_MB}" instead of the image.`;

export const PARALLEL_FUNCTION_CALL_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_1', model: 'gpt-5', created_at: 1234567890 },
  },
  {
    type: 'response.output_item.added',
    output_index: 4,
    item: {
      id: 'fc_first',
      type: 'function_call',
      call_id: 'call_first',
      name: 'add_task',
    },
  },
  {
    type: 'response.output_item.added',
    output_index: 9,
    item: {
      id: 'fc_second',
      type: 'function_call',
      call_id: 'call_second',
      name: 'add_task',
    },
  },
  {
    type: 'response.function_call_arguments.delta',
    output_index: 9,
    item_id: 'fc_second',
    delta: '{"title":"second"}',
  },
  {
    type: 'response.function_call_arguments.delta',
    output_index: 4,
    item_id: 'fc_first',
    delta: '{"title":"first"}',
  },
];

export const FUNCTION_CALL_COMPLETION_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_1', model: 'gpt-4o', created_at: 1234567890 },
  },
  {
    type: 'response.output_item.added',
    output_index: 0,
    item: {
      type: 'function_call',
      call_id: 'call_1',
      name: 'get_date',
      arguments: '',
    },
  },
  {
    type: 'response.function_call_arguments.delta',
    output_index: 0,
    item_id: 'fc_1',
    delta: '{"timezone":"UTC"}',
  },
  {
    type: 'response.completed',
    response: { usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
  },
];

export const TEXT_COMPLETION_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_1', model: 'gpt-4o', created_at: 1234567890 },
  },
  { type: 'response.output_text.delta', delta: 'Done' },
  { type: 'response.completed', response: {} },
];

export const COMPLETED_FUNCTION_CALL_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_1', model: 'gpt-4o', created_at: 1234567890 },
  },
  {
    type: 'response.completed',
    response: { output: [{ type: 'function_call' }] },
  },
];

export const FAILED_RESPONSE_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_1', model: 'gpt-5', created_at: 1234567890 },
  },
  {
    type: 'response.failed',
    response: {
      id: 'resp_1',
      status: 'failed',
      error: { code: 'server_error', message: 'The model encountered an error.' },
    },
  },
];

export const INCOMPLETE_MAX_OUTPUT_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_2', model: 'gpt-5', created_at: 1234567890 },
  },
  { type: 'response.output_text.delta', delta: 'Partial output' },
  {
    type: 'response.incomplete',
    response: {
      id: 'resp_2',
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
    },
  },
];

export const INCOMPLETE_CONTENT_FILTER_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_cf', model: 'gpt-5', created_at: 1234567890 },
  },
  { type: 'response.output_text.delta', delta: 'Partial' },
  {
    type: 'response.incomplete',
    response: {
      id: 'resp_cf',
      status: 'incomplete',
      incomplete_details: { reason: 'content_filter' },
    },
  },
];

export const INCOMPLETE_WITHOUT_DETAILS_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_nodetails', model: 'gpt-5', created_at: 1234567890 },
  },
  { type: 'response.output_text.delta', delta: 'Partial' },
  {
    type: 'response.incomplete',
    response: { id: 'resp_nodetails', status: 'incomplete' },
  },
];

export const FAILED_WITH_USAGE_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_failusage', model: 'gpt-5', created_at: 1234567890 },
  },
  {
    type: 'response.failed',
    response: {
      id: 'resp_failusage',
      status: 'failed',
      error: { code: 'server_error', message: 'boom' },
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    },
  },
];

export const INCOMPLETE_WITH_USAGE_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_incompleteusage', model: 'gpt-5', created_at: 1234567890 },
  },
  {
    type: 'response.incomplete',
    response: {
      id: 'resp_incompleteusage',
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
    },
  },
];

export const FAILED_WITHOUT_USAGE_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_nousage', model: 'gpt-5', created_at: 1234567890 },
  },
  {
    type: 'response.failed',
    response: { id: 'resp_nousage', status: 'failed', error: { message: 'boom' } },
  },
];

export const GENERIC_ERROR_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_3', model: 'gpt-5', created_at: 1234567890 },
  },
  { type: 'error', code: 'server_error', message: 'boom' },
];

export const IMAGE_RESPONSE = {
  id: 'resp_img',
  object: 'response',
  model: 'gpt-image-model',
  created_at: 1234567890,
  status: 'completed',
  output: [
    { type: 'image_generation_call', id: 'ig_1', status: 'completed', result: TINY_IMAGE_B64 },
  ],
  usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
};

export const IMAGE_ORDER_RESPONSE = {
  id: 'resp_img_order',
  object: 'response',
  model: 'gpt-image-model',
  created_at: 1234567890,
  status: 'completed',
  output: [
    {
      type: 'message',
      id: 'msg_1',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Here is your image:' }],
    },
    { type: 'image_generation_call', id: 'ig_1', status: 'completed', result: TINY_IMAGE_B64 },
  ],
};

export const createImageSniffResponse = (result: string) => ({
  id: 'resp_img_sniff',
  object: 'response',
  model: 'gpt-image-model',
  created_at: 1234567890,
  status: 'completed',
  output: [{ type: 'image_generation_call', id: 'ig_1', status: 'completed', result }],
});

export const IMAGE_OUTPUT_FORMAT_RESPONSE = {
  id: 'resp_img_webp',
  object: 'response',
  model: 'gpt-image-model',
  created_at: 1234567890,
  status: 'completed',
  output: [
    {
      type: 'image_generation_call',
      id: 'ig_1',
      status: 'completed',
      result: TINY_IMAGE_B64,
      output_format: 'webp',
    },
  ],
};

export const IMAGE_NO_RESULT_RESPONSE = {
  id: 'resp_img_noresult',
  object: 'response',
  model: 'gpt-image-model',
  created_at: 1234567890,
  status: 'completed',
  output: [{ type: 'image_generation_call', id: 'ig_1', status: 'completed' }],
};

export const TEXT_ONLY_RESPONSE = {
  id: 'resp_text_only',
  object: 'response',
  model: 'gpt-4o',
  created_at: 1234567890,
  status: 'completed',
  output: [
    {
      type: 'message',
      id: 'msg_1',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Full answer' }],
    },
  ],
};

export const IMAGE_OVERSIZED_RESPONSE = {
  id: 'resp_img_oversized',
  object: 'response',
  model: 'gpt-image-model',
  created_at: 1234567890,
  status: 'completed',
  output: [
    {
      type: 'image_generation_call',
      id: 'ig_1',
      status: 'completed',
      result: OVERSIZED_IMAGE_RESULT_6_MB,
    },
  ],
};

export const IMAGE_AT_LIMIT_RESPONSE = {
  id: 'resp_img_at_limit',
  object: 'response',
  model: 'gpt-image-model',
  created_at: 1234567890,
  status: 'completed',
  output: [
    {
      type: 'image_generation_call',
      id: 'ig_1',
      status: 'completed',
      result: AT_LIMIT_IMAGE_RESULT,
    },
  ],
};

export const IMAGE_STREAM_ITEM_DONE_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_img_s1', model: 'gpt-image-model', created_at: 1234567890 },
  },
  {
    type: 'response.output_item.done',
    output_index: 0,
    item: {
      id: 'ig_1',
      type: 'image_generation_call',
      status: 'completed',
      result: TINY_IMAGE_B64,
    },
  },
  { type: 'response.completed', response: {} },
];

export const IMAGE_COMPLETED_ONLY_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_img_s2', model: 'gpt-image-model', created_at: 1234567890 },
  },
  {
    type: 'response.completed',
    response: {
      id: 'resp_img_s2',
      status: 'completed',
      output: [
        {
          id: 'ig_1',
          type: 'image_generation_call',
          status: 'completed',
          result: TINY_IMAGE_B64,
        },
      ],
      usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
    },
  },
];

const IMAGE_DEDUPLICATED_ITEM = {
  id: 'ig_1',
  type: 'image_generation_call',
  status: 'completed',
  result: TINY_IMAGE_B64,
};

export const IMAGE_DEDUPLICATION_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_img_s3', model: 'gpt-image-model', created_at: 1234567890 },
  },
  { type: 'response.output_item.done', output_index: 0, item: IMAGE_DEDUPLICATED_ITEM },
  {
    type: 'response.completed',
    response: { id: 'resp_img_s3', output: [IMAGE_DEDUPLICATED_ITEM] },
  },
];

export const IMAGE_PARTIAL_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_img_s4', model: 'gpt-image-model', created_at: 1234567890 },
  },
  {
    type: 'response.image_generation_call.partial_image',
    output_index: 0,
    item_id: 'ig_1',
    partial_image_index: 0,
    partial_image_b64: 'UEFSVElBTA==',
  },
  {
    type: 'response.output_item.done',
    output_index: 0,
    item: {
      id: 'ig_1',
      type: 'image_generation_call',
      status: 'completed',
      result: TINY_IMAGE_B64,
    },
  },
  { type: 'response.completed', response: {} },
];

export const IMAGE_OVERSIZED_STREAM_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_img_s5', model: 'gpt-image-model', created_at: 1234567890 },
  },
  {
    type: 'response.output_item.done',
    output_index: 0,
    item: {
      id: 'ig_1',
      type: 'image_generation_call',
      status: 'completed',
      result: OVERSIZED_IMAGE_RESULT_12_MB,
    },
  },
  { type: 'response.completed', response: {} },
];

export const TYPED_IMAGE_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_typed_1', model: 'gpt-image-model', created_at: 1234567890 },
  },
  {
    type: 'response.output_item.done',
    output_index: 0,
    item: {
      id: 'ig_1',
      type: 'image_generation_call',
      status: 'completed',
      result: TINY_IMAGE_B64,
    },
  },
  { type: 'response.completed', response: {} },
];

export const TYPED_IMAGE_DELTA_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_typed_2', model: 'gpt-image-model', created_at: 1234567890 },
  },
  {
    type: 'response.output_item.done',
    output_index: 0,
    item: {
      id: 'ig_1',
      type: 'image_generation_call',
      status: 'completed',
      result: TINY_IMAGE_B64,
    },
  },
  { type: 'response.completed', response: {} },
];

const TYPED_IMAGE_DEDUPLICATED_ITEM = {
  id: 'ig_1',
  type: 'image_generation_call',
  status: 'completed',
  result: TINY_IMAGE_B64,
};

export const TYPED_IMAGE_DEDUPLICATION_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_typed_3', model: 'gpt-image-model', created_at: 1234567890 },
  },
  {
    type: 'response.output_item.done',
    output_index: 0,
    item: TYPED_IMAGE_DEDUPLICATED_ITEM,
  },
  {
    type: 'response.completed',
    response: { id: 'resp_typed_3', output: [TYPED_IMAGE_DEDUPLICATED_ITEM] },
  },
];

export const TYPED_IMAGE_COMPLETED_ONLY_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_typed_4', model: 'gpt-image-model', created_at: 1234567890 },
  },
  {
    type: 'response.completed',
    response: {
      id: 'resp_typed_4',
      status: 'completed',
      output: [
        {
          id: 'ig_9',
          type: 'image_generation_call',
          status: 'completed',
          result: TINY_IMAGE_B64,
        },
      ],
    },
  },
];

const IMAGE_NATIVE_FINISH_CHUNK = {
  id: 'resp_native_1',
  model: 'gpt-image-model',
  created: 1234567890,
  finish_reason: 'stop',
  usage: {
    input_tokens: 5,
    output_tokens: 1,
    total_tokens: 6,
    reasoning_tokens: 0,
    cached_tokens: 0,
    cache_creation_tokens: 0,
  },
};

const IMAGE_NATIVE_SINGLE_CHUNK = {
  id: 'resp_native_1',
  model: 'gpt-image-model',
  created: 1234567890,
  delta: { content: TINY_IMAGE_MARKDOWN },
  image_generation_calls: [{ id: 'ig_1', status: 'completed', result: TINY_IMAGE_B64 }],
  finish_reason: null,
};

export const IMAGE_NATIVE_SINGLE_EVENTS = [IMAGE_NATIVE_SINGLE_CHUNK, IMAGE_NATIVE_FINISH_CHUNK];

export const IMAGE_NATIVE_OVERSIZED_EVENTS = [
  {
    id: 'resp_native_2',
    model: 'gpt-image-model',
    created: 1234567890,
    delta: { content: IMAGE_PLACEHOLDER_12_MB },
    image_generation_calls: [
      { id: 'ig_big', status: 'completed', result: NATIVE_OVERSIZED_IMAGE_RESULT },
    ],
    finish_reason: null,
  },
  IMAGE_NATIVE_FINISH_CHUNK,
];

export const IMAGE_NATIVE_MESSAGE_EVENTS = [
  {
    id: 'resp_native_3',
    model: 'gpt-image-model',
    created: 1234567890,
    delta: { content: 'Here is your image:' },
    finish_reason: null,
  },
  IMAGE_NATIVE_SINGLE_CHUNK,
  IMAGE_NATIVE_FINISH_CHUNK,
];

export const IMAGE_ROUND_TRIP_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_rt_1', model: 'gpt-image-model', created_at: 1234567890 },
  },
  {
    type: 'response.output_item.done',
    output_index: 0,
    item: {
      id: 'ig_rt',
      type: 'image_generation_call',
      status: 'completed',
      result: TINY_IMAGE_B64,
    },
  },
  {
    type: 'response.completed',
    response: { usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 } },
  },
];

export const UNARY_TYPED_IMAGE_RESPONSE = {
  id: 'resp_unary_typed',
  object: 'response',
  model: 'gpt-image-model',
  created_at: 1234567890,
  status: 'completed',
  output: [
    {
      type: 'message',
      id: 'msg_1',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Here is your image:' }],
    },
    {
      type: 'image_generation_call',
      id: 'ig_1',
      status: 'completed',
      result: TINY_IMAGE_B64,
    },
  ],
};

export const UNARY_IMAGE_ROUND_TRIP_RESPONSE = {
  id: 'resp_unary_rt',
  object: 'response',
  model: 'gpt-image-model',
  created_at: 1234567890,
  status: 'completed',
  output: [
    {
      type: 'message',
      id: 'msg_1',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Here is your image:' }],
    },
    {
      type: 'image_generation_call',
      id: 'ig_1',
      status: 'completed',
      result: TINY_IMAGE_B64,
    },
  ],
};

export const UNARY_IMAGE_ONLY_RESPONSE = {
  id: 'resp_unary_imgonly',
  object: 'response',
  model: 'gpt-image-model',
  created_at: 1234567890,
  status: 'completed',
  output: [
    {
      type: 'image_generation_call',
      id: 'ig_1',
      status: 'completed',
      result: TINY_IMAGE_B64,
    },
  ],
};

export const UNARY_OVERSIZED_IMAGE_RESPONSE = {
  id: 'resp_unary_big',
  object: 'response',
  model: 'gpt-image-model',
  created_at: 1234567890,
  status: 'completed',
  output: [
    {
      type: 'image_generation_call',
      id: 'ig_big',
      status: 'completed',
      result: UNARY_OVERSIZED_IMAGE_RESULT,
    },
  ],
};

export const createCollisionResponseBody = () => ({
  id: 'resp_probe_md',
  object: 'response',
  model: 'gpt-image-model',
  created_at: 1234567890,
  status: 'completed',
  output: [
    {
      type: 'message',
      id: 'msg_1',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: AUTHORED_WITH_MARKDOWN }],
    },
    {
      type: 'image_generation_call',
      id: 'ig_1',
      status: 'completed',
      result: TINY_IMAGE_B64,
    },
  ],
});

export const createPlaceholderCollisionResponseBody = () => ({
  id: 'resp_probe_ph',
  object: 'response',
  model: 'gpt-image-model',
  created_at: 1234567890,
  status: 'completed',
  output: [
    {
      type: 'message',
      id: 'msg_1',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: AUTHORED_WITH_PLACEHOLDER }],
    },
    {
      type: 'image_generation_call',
      id: 'ig_big',
      status: 'completed',
      result: OVERSIZED_IMAGE_RESULT_12_MB,
    },
  ],
});

export const CLIENT_FAILED_EVENTS = [
  {
    id: 'resp_err_1',
    model: 'gpt-5',
    created: 1234567890,
    delta: { role: 'assistant', content: 'partial' },
    finish_reason: null,
  },
  {
    id: 'resp_err_1',
    model: 'gpt-5',
    created: 1234567890,
    event: 'error',
    delta: {},
    error: {
      statusCode: 500,
      code: 'server_error',
      message: 'The model encountered an error.',
    },
  },
];

export const CLIENT_INCOMPLETE_MAX_EVENTS = [
  {
    id: 'resp_err_2',
    model: 'gpt-5',
    created: 1234567890,
    delta: { role: 'assistant', content: 'partial output' },
    finish_reason: null,
  },
  {
    id: 'resp_err_2',
    model: 'gpt-5',
    created: 1234567890,
    event: 'error',
    delta: {},
    finish_reason: 'length',
    incomplete_details: { reason: 'max_output_tokens' },
    error: {
      statusCode: 500,
      code: 'max_output_tokens',
      message: 'Response ended incomplete: max_output_tokens',
    },
  },
];

export const CLIENT_INCOMPLETE_CONTENT_FILTER_EVENTS = [
  {
    id: 'resp_err_cf',
    model: 'gpt-5',
    created: 1234567890,
    delta: { role: 'assistant', content: 'partial' },
    finish_reason: null,
  },
  {
    id: 'resp_err_cf',
    model: 'gpt-5',
    created: 1234567890,
    event: 'error',
    delta: {},
    finish_reason: 'content_filter',
    incomplete_details: { reason: 'content_filter' },
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      reasoning_tokens: 0,
      cached_tokens: 0,
      cache_creation_tokens: 0,
    },
    error: {
      statusCode: 500,
      code: 'content_filter',
      message: 'Response ended incomplete: content_filter',
    },
  },
];

export const DETAIL_LESS_RESPONSES_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_nodetails_rt', model: 'gpt-5', created_at: 1234567890 },
  },
  { type: 'response.output_text.delta', delta: 'partial output' },
  {
    type: 'response.incomplete',
    response: { id: 'resp_nodetails_rt', status: 'incomplete' },
  },
];

export const DETAIL_LESS_CHAT_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_nodetails_chat', model: 'gpt-5', created_at: 1234567890 },
  },
  { type: 'response.output_text.delta', delta: 'partial output' },
  {
    type: 'response.incomplete',
    response: { id: 'resp_nodetails_chat', status: 'incomplete' },
  },
];

export const CLIENT_INCOMPLETE_ITEMS_EVENTS = [
  {
    id: 'resp_inc_items',
    model: 'gpt-5',
    created: 1234567890,
    delta: { role: 'assistant', reasoning_content: 'thinking...' },
    finish_reason: null,
  },
  {
    id: 'resp_inc_items',
    model: 'gpt-5',
    created: 1234567890,
    delta: { content: 'partial output' },
    finish_reason: null,
  },
  {
    id: 'resp_inc_items',
    model: 'gpt-5',
    created: 1234567890,
    delta: {
      tool_calls: [
        {
          index: 0,
          id: 'call_1',
          type: 'function',
          function: { name: 'lookup', arguments: '{"q":' },
        },
      ],
    },
    finish_reason: null,
  },
  {
    id: 'resp_inc_items',
    model: 'gpt-5',
    created: 1234567890,
    event: 'error',
    delta: {},
    finish_reason: 'length',
    incomplete_details: { reason: 'max_output_tokens' },
    error: {
      statusCode: 500,
      code: 'max_output_tokens',
      message: 'Response ended incomplete: max_output_tokens',
    },
  },
];

export const CLIENT_FAILED_ITEMS_EVENTS = [
  {
    id: 'resp_failed_items',
    model: 'gpt-5',
    created: 1234567890,
    delta: { role: 'assistant', content: 'partial' },
    finish_reason: null,
  },
  {
    id: 'resp_failed_items',
    model: 'gpt-5',
    created: 1234567890,
    event: 'error',
    delta: {},
    error: { statusCode: 500, code: 'server_error', message: 'boom' },
  },
];

export const CLIENT_HARD_ERROR_EVENTS = [
  {
    id: 'resp_hard_err',
    model: 'gpt-5',
    created: 1234567890,
    delta: { role: 'assistant', content: 'partial' },
    finish_reason: null,
  },
  {
    id: 'resp_hard_err',
    model: 'gpt-5',
    created: 1234567890,
    event: 'error',
    delta: {},
    error: { statusCode: 500, code: 'server_error', message: 'The model response failed.' },
  },
];

export const CHAT_INCOMPLETE_CONTENT_FILTER_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_cf_chat', model: 'gpt-5', created_at: 1234567890 },
  },
  { type: 'response.output_text.delta', delta: 'Partial' },
  {
    type: 'response.incomplete',
    response: {
      id: 'resp_cf_chat',
      status: 'incomplete',
      incomplete_details: { reason: 'content_filter' },
    },
  },
];

export const CHAT_FAILED_USAGE_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_fail_usage', model: 'gpt-5', created_at: 1234567890 },
  },
  { type: 'response.output_text.delta', delta: 'partial' },
  {
    type: 'response.failed',
    response: {
      id: 'resp_fail_usage',
      status: 'failed',
      error: { code: 'server_error', message: 'boom' },
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    },
  },
];

export const CHAT_IMAGE_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_img_chat', model: 'gpt-image-model', created_at: 1234567890 },
  },
  {
    type: 'response.output_item.done',
    output_index: 0,
    item: {
      id: 'ig_1',
      type: 'image_generation_call',
      status: 'completed',
      result: TINY_IMAGE_B64,
    },
  },
  {
    type: 'response.completed',
    response: {
      id: 'resp_img_chat',
      status: 'completed',
      output: [
        {
          id: 'ig_1',
          type: 'image_generation_call',
          status: 'completed',
          result: TINY_IMAGE_B64,
        },
      ],
      usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
    },
  },
];

export const CHAT_INCOMPLETE_USAGE_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_incomplete_usage', model: 'gpt-5', created_at: 1234567890 },
  },
  { type: 'response.output_text.delta', delta: 'partial' },
  {
    type: 'response.incomplete',
    response: {
      id: 'resp_incomplete_usage',
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
    },
  },
];

export const createToolSearchItem = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'tsc_1',
  type: 'tool_search_call',
  call_id: 'call_1',
  execution: 'client',
  status: 'completed',
  arguments: { query: 'exec_command' },
  ...overrides,
});

export const TOOL_SEARCH_STREAM_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_tsc_1', model: 'gpt-5.6-luna', created_at: 1234567890 },
  },
  { type: 'response.output_item.done', output_index: 0, item: createToolSearchItem() },
  { type: 'response.completed', response: {} },
];

const TOOL_SEARCH_DEDUPLICATED_ITEM = createToolSearchItem();
export const TOOL_SEARCH_DEDUPLICATION_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_tsc_2', model: 'gpt-5.6-luna', created_at: 1234567890 },
  },
  { type: 'response.output_item.done', output_index: 0, item: TOOL_SEARCH_DEDUPLICATED_ITEM },
  {
    type: 'response.completed',
    response: { id: 'resp_tsc_2', output: [TOOL_SEARCH_DEDUPLICATED_ITEM] },
  },
];

export const TOOL_SEARCH_COMPLETED_ONLY_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_tsc_3', model: 'gpt-5.6-luna', created_at: 1234567890 },
  },
  {
    type: 'response.completed',
    response: {
      id: 'resp_tsc_3',
      status: 'completed',
      output: [createToolSearchItem({ id: 'tsc_9' })],
    },
  },
];

export const TOOL_SEARCH_STOP_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_tsc_4', model: 'gpt-5.6-luna', created_at: 1234567890 },
  },
  { type: 'response.output_item.done', output_index: 0, item: createToolSearchItem() },
  { type: 'response.completed', response: {} },
];

export const TOOL_SEARCH_COMPLETED_STOP_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_tsc_5', model: 'gpt-5.6-luna', created_at: 1234567890 },
  },
  {
    type: 'response.completed',
    response: { output: [createToolSearchItem()] },
  },
];

export const TOOL_SEARCH_WITH_FUNCTION_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_tsc_6', model: 'gpt-5.6-luna', created_at: 1234567890 },
  },
  {
    type: 'response.output_item.added',
    output_index: 0,
    item: { type: 'function_call', call_id: 'call_fn', name: 'get_date', arguments: '' },
  },
  { type: 'response.output_item.done', output_index: 1, item: createToolSearchItem() },
  { type: 'response.completed', response: {} },
];

const TOOL_SEARCH_NATIVE_ITEM = createToolSearchItem();
export const TOOL_SEARCH_NATIVE_CHUNKS = [
  {
    id: 'resp_native_tsc',
    model: 'gpt-5.6-luna',
    created: 1234567890,
    delta: {},
    client_tool_calls: [TOOL_SEARCH_NATIVE_ITEM],
    finish_reason: null,
  },
  {
    id: 'resp_native_tsc',
    model: 'gpt-5.6-luna',
    created: 1234567890,
    delta: {},
    finish_reason: 'stop',
  },
];

export const TOOL_SEARCH_UNARY_RESPONSE = {
  id: 'resp_tsc_ns',
  object: 'response',
  created_at: 1234567890,
  status: 'completed',
  model: 'gpt-5.6-luna',
  output: [createToolSearchItem()],
};

export const TOOL_SEARCH_CHAT_EVENTS = [
  {
    type: 'response.created',
    response: { id: 'resp_tsc_chat', model: 'gpt-5.6-luna', created_at: 1234567890 },
  },
  { type: 'response.output_item.done', output_index: 0, item: createToolSearchItem() },
  { type: 'response.completed', response: {} },
];

export const UNARY_NO_RESULT_RESPONSE = {
  id: 'resp_unary_noresult',
  object: 'response',
  model: 'gpt-image-model',
  created_at: 1234567890,
  status: 'completed',
  output: [{ type: 'image_generation_call', id: 'ig_1', status: 'completed' }],
};
