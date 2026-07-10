import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  AuiIf,
  AttachmentPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  SimpleImageAttachmentAdapter,
  ThreadPrimitive,
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadAssistantMessagePart,
  type ThreadMessage,
} from '@assistant-ui/react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import {
  Type,
  type Api,
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type ProviderStreams,
  type TextContent,
  type ImageContent,
  type Tool,
  type ToolCall,
  type ToolResultMessage,
} from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { ArrowDown, Copy, Paperclip, SendHorizontal, Square, Wrench, X } from 'lucide-react';
import { memo, useMemo, useRef } from 'react';
import type { KeyConfig } from '../../lib/api';

export type PlaygroundApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'gemini';
export type ToolMode = 'off' | 'sample-tools';

export type PlaygroundToolCall = {
  name: string;
  arguments: string;
  result: string;
};

type PlaygroundChatProps = {
  selectedKey: KeyConfig;
  selectedModel: string;
  selectedApi: PlaygroundApi;
  toolMode: ToolMode;
  onRoutingPending: (clientRequestId: string) => void;
  onToolCalls: (calls: PlaygroundToolCall[]) => void;
};

type ToolExecution = {
  call: ToolCall;
  result: string;
  isError: boolean;
  startedAt: number;
  completedAt: number;
};

const streamsByApi: Record<PlaygroundApi, ProviderStreams> = {
  'openai-completions': openAICompletionsApi(),
  'openai-responses': openAIResponsesApi(),
  'anthropic-messages': anthropicMessagesApi(),
  gemini: googleGenerativeAIApi(),
};

const imageAttachmentAdapter = new SimpleImageAttachmentAdapter();

const playgroundTools: Tool[] = [
  {
    name: 'get_date',
    description:
      'Get the current date and time in a specified timezone. Use UTC when none is specified.',
    parameters: Type.Object(
      {
        timezone: Type.String({
          description: 'IANA timezone, such as America/Los_Angeles.',
        }),
      },
      { additionalProperties: false }
    ),
  },
  {
    name: 'add_tasks',
    description:
      'Add one or more tasks to this browser-only test task list. Use one call with every task in titles.',
    parameters: Type.Object(
      {
        titles: Type.Array(Type.String(), {
          description: 'One or more tasks to add together',
        }),
      },
      { additionalProperties: false }
    ),
  },
  {
    name: 'list_tasks',
    description: 'List tasks added during this current Playground chat session.',
    parameters: Type.Object({}, { additionalProperties: false }),
  },
];

const zeroUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const apiName = (api: PlaygroundApi): Api => (api === 'gemini' ? 'google-generative-ai' : api);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// Responses is deliberately stateless (`store: false`). pi-ai preserves output
// item IDs for clients that use stored responses, so remove those IDs before
// replaying full items. Reasoning items without encrypted content cannot be
// replayed statelessly and are omitted; their visible summary is still rendered.
const makeResponsesPayloadStateless = (payload: unknown): unknown => {
  if (!isRecord(payload) || !Array.isArray(payload.input)) return payload;

  const input = payload.input.flatMap((item) => {
    if (!isRecord(item)) return [item];
    if (item.type === 'reasoning' && typeof item.encrypted_content !== 'string') return [];
    const { id: _storedItemId, ...statelessItem } = item;
    return [statelessItem];
  });

  return { ...payload, store: false, previous_response_id: undefined, input };
};

const createModel = (api: PlaygroundApi, modelId: string): Model<Api> => ({
  id: modelId,
  name: modelId,
  api: apiName(api),
  provider: 'plexus-playground',
  baseUrl:
    api === 'anthropic-messages'
      ? window.location.origin
      : `${window.location.origin}/${api === 'gemini' ? 'v1beta' : 'v1'}`,
  reasoning: false,
  input: ['text', 'image'],
  cost: zeroUsage.cost,
  contextWindow: 1_000_000,
  maxTokens: 4096,
});

const dataUrlToImage = (value: string, fallbackMimeType = 'image/png') => {
  const match = value.match(/^data:([^;,]+);base64,(.*)$/s);
  return {
    type: 'image' as const,
    mimeType: match?.[1] ?? fallbackMimeType,
    data: match?.[2] ?? value,
  };
};

const storedPiMessages = (message: ThreadMessage): Message[] | undefined => {
  const value = message.metadata.custom.piMessages;
  if (!Array.isArray(value)) return undefined;
  return value as Message[];
};

const toPiContext = (messages: readonly ThreadMessage[], tools: Tool[] | undefined): Context => {
  const context: Context = { messages: [], tools };

  for (const message of messages) {
    if (message.role === 'system') {
      const text = message.content.map((part) => part.text).join('\n');
      context.systemPrompt = context.systemPrompt ? `${context.systemPrompt}\n${text}` : text;
      continue;
    }

    if (message.role === 'user') {
      const content: Array<TextContent | ImageContent> = [];
      const parts = [
        ...message.content,
        ...message.attachments.flatMap((attachment) => attachment.content ?? []),
      ];
      for (const part of parts) {
        if (part.type === 'text') content.push({ type: 'text', text: part.text });
        if (part.type === 'image') content.push(dataUrlToImage(part.image));
        if (part.type === 'file' && part.mimeType.startsWith('image/')) {
          content.push(dataUrlToImage(part.data, part.mimeType));
        }
      }
      context.messages.push({ role: 'user', content, timestamp: message.createdAt.getTime() });
      continue;
    }

    const stored = storedPiMessages(message);
    if (stored) {
      context.messages.push(...stored);
      continue;
    }

    const assistantContent: AssistantMessage['content'] = [];
    for (const part of message.content) {
      if (part.type === 'text') assistantContent.push({ type: 'text', text: part.text });
      if (part.type === 'reasoning') {
        assistantContent.push({ type: 'thinking', thinking: part.text });
      }
      if (part.type === 'tool-call') {
        assistantContent.push({
          type: 'toolCall',
          id: part.toolCallId,
          name: part.toolName,
          arguments: part.args as Record<string, unknown>,
        });
      }
    }

    const assistant: AssistantMessage = {
      role: 'assistant',
      api: 'openai-completions',
      provider: 'plexus-playground',
      model: 'unknown',
      content: assistantContent,
      usage: zeroUsage,
      stopReason: message.content.some((part) => part.type === 'tool-call') ? 'toolUse' : 'stop',
      timestamp: message.createdAt.getTime(),
    };
    context.messages.push(assistant);

    for (const part of message.content) {
      if (part.type !== 'tool-call' || part.result === undefined) continue;
      context.messages.push({
        role: 'toolResult',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        content: [{ type: 'text', text: String(part.result) }],
        isError: part.isError ?? false,
        timestamp: message.createdAt.getTime(),
      });
    }
  }

  return context;
};

const toAssistantParts = (
  message: AssistantMessage,
  executions: Map<string, ToolExecution> = new Map()
): ThreadAssistantMessagePart[] =>
  message.content.map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text };
    if (part.type === 'thinking') return { type: 'reasoning', text: part.thinking };

    const execution = executions.get(part.id);
    return {
      type: 'tool-call',
      toolCallId: part.id,
      toolName: part.name,
      args: part.arguments,
      argsText: JSON.stringify(part.arguments),
      result: execution?.result,
      isError: execution?.isError,
      timing: execution
        ? { startedAt: execution.startedAt, completedAt: execution.completedAt }
        : undefined,
    };
  });

const executeTool = async (call: ToolCall, tasks: string[]): Promise<ToolExecution> => {
  const startedAt = Date.now();
  let result: Record<string, unknown>;
  let isError = false;

  switch (call.name) {
    case 'get_date': {
      const timezone =
        typeof call.arguments.timezone === 'string' ? call.arguments.timezone : 'UTC';
      try {
        result = {
          datetime: new Date().toLocaleString('en-US', { timeZone: timezone }),
          timezone,
        };
      } catch {
        isError = true;
        result = { error: `Invalid timezone: ${timezone}` };
      }
      break;
    }
    case 'add_tasks': {
      const titles = Array.isArray(call.arguments.titles)
        ? call.arguments.titles
            .filter((title): title is string => typeof title === 'string')
            .map((title) => title.trim())
            .filter(Boolean)
        : [];
      if (titles.length === 0) {
        isError = true;
        result = { error: 'At least one task title is required.' };
      } else {
        tasks.push(...titles);
        result = { added: titles, taskCount: tasks.length };
      }
      break;
    }
    case 'list_tasks':
      result = { tasks: [...tasks] };
      break;
    default:
      isError = true;
      result = { error: `Unknown browser tool: ${call.name}` };
  }

  return {
    call,
    result: JSON.stringify(result),
    isError,
    startedAt,
    completedAt: Date.now(),
  };
};

const toolResultMessage = (execution: ToolExecution): ToolResultMessage => ({
  role: 'toolResult',
  toolCallId: execution.call.id,
  toolName: execution.call.name,
  content: [{ type: 'text', text: execution.result }],
  isError: execution.isError,
  timestamp: execution.completedAt,
});

const makeAdapter = ({
  selectedKey,
  selectedModel,
  selectedApi,
  toolMode,
  tasks,
  onRoutingPending,
  onToolCalls,
}: PlaygroundChatProps & { tasks: string[] }): ChatModelAdapter => ({
  async *run({ messages, abortSignal }) {
    const model = createModel(selectedApi, selectedModel);
    const context = toPiContext(
      messages,
      toolMode === 'sample-tools' ? playgroundTools : undefined
    );
    const completedParts: ThreadAssistantMessagePart[] = [];
    const generatedMessages: Message[] = [];
    const requestTrace: Array<Record<string, unknown>> = [];
    const firstRequestId = crypto.randomUUID();
    onRoutingPending(firstRequestId);

    for (let round = 0; round < 8; round++) {
      const clientRequestId = round === 0 ? firstRequestId : crypto.randomUUID();
      let finalMessage: AssistantMessage | undefined;

      const stream = streamsByApi[selectedApi].stream(model, context, {
        apiKey: selectedKey.secret,
        signal: abortSignal,
        maxRetries: 0,
        headers: { 'x-client-request-id': clientRequestId },
        onPayload: (payload) => {
          const outgoingPayload =
            selectedApi === 'openai-responses' ? makeResponsesPayloadStateless(payload) : payload;
          requestTrace.push({ clientRequestId, payload: outgoingPayload });
          return outgoingPayload;
        },
        onResponse: (response) => {
          requestTrace.push({ clientRequestId, status: response.status });
        },
      });

      for await (const event of stream) {
        if ('partial' in event) {
          yield {
            content: [...completedParts, ...toAssistantParts(event.partial)],
            metadata: { custom: { requestTrace } },
          };
        }
        if (event.type === 'done') finalMessage = event.message;
        if (event.type === 'error') finalMessage = event.error;
      }

      if (!finalMessage) {
        yield {
          content: completedParts,
          status: {
            type: 'incomplete',
            reason: abortSignal.aborted ? 'cancelled' : 'error',
            error: abortSignal.aborted ? undefined : 'The response stream ended unexpectedly.',
          },
        };
        return;
      }

      if (finalMessage.stopReason === 'error' || finalMessage.stopReason === 'aborted') {
        const finalParts = [...completedParts, ...toAssistantParts(finalMessage)];
        generatedMessages.push(finalMessage);
        yield {
          content: finalParts,
          status: {
            type: 'incomplete',
            reason: finalMessage.stopReason === 'aborted' ? 'cancelled' : 'error',
            error: finalMessage.errorMessage,
          },
          metadata: {
            custom: { piMessages: generatedMessages, requestTrace },
            steps: [
              {
                usage: {
                  inputTokens: finalMessage.usage.input,
                  outputTokens: finalMessage.usage.output,
                },
              },
            ],
          },
        };
        return;
      }

      const calls = finalMessage.content.filter(
        (part): part is ToolCall => part.type === 'toolCall'
      );
      generatedMessages.push(finalMessage);

      if (calls.length === 0) {
        completedParts.push(...toAssistantParts(finalMessage));
        yield {
          content: completedParts,
          status: { type: 'complete', reason: 'stop' },
          metadata: {
            custom: {
              piMessages: generatedMessages,
              requestTrace,
              responseId: finalMessage.responseId,
              responseModel: finalMessage.responseModel,
              stopReason: finalMessage.stopReason,
              usage: finalMessage.usage,
              diagnostics: finalMessage.diagnostics,
            },
            steps: [
              {
                usage: {
                  inputTokens: finalMessage.usage.input,
                  outputTokens: finalMessage.usage.output,
                },
              },
            ],
          },
        };
        return;
      }

      const executions = await Promise.all(calls.map((call) => executeTool(call, tasks)));
      const executionMap = new Map(executions.map((execution) => [execution.call.id, execution]));
      completedParts.push(...toAssistantParts(finalMessage, executionMap));
      onToolCalls(
        executions.map((execution) => ({
          name: execution.call.name,
          arguments: JSON.stringify(execution.call.arguments),
          result: execution.result,
        }))
      );

      const resultMessages = executions.map(toolResultMessage);
      generatedMessages.push(...resultMessages);
      context.messages.push(finalMessage, ...resultMessages);
      yield {
        content: completedParts,
        metadata: { custom: { piMessages: generatedMessages, requestTrace } },
      };
    }

    yield {
      content: completedParts,
      status: {
        type: 'incomplete',
        reason: 'error',
        error: 'Tool execution exceeded the 8-round spike limit.',
      },
      metadata: { custom: { piMessages: generatedMessages, requestTrace } },
    };
  },
});

const ToolCard = ({
  part,
}: {
  part: Extract<ThreadAssistantMessagePart, { type: 'tool-call' }>;
}) => (
  <div className="my-2 overflow-hidden rounded-md border border-primary/40 bg-slate-950/60">
    <div className="flex items-center gap-2 border-b border-primary/20 bg-primary/10 px-3 py-2">
      <Wrench className="h-3.5 w-3.5 text-primary" />
      <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-primary">
        Tool
      </span>
      <span className="font-mono text-xs font-semibold text-text">{part.toolName}</span>
    </div>
    <div className="grid gap-2 p-2 sm:grid-cols-2">
      <div>
        <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-text-muted">
          Arguments
        </div>
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950/70 p-2 font-mono text-[10px] text-text-secondary">
          {JSON.stringify(part.args, null, 2)}
        </pre>
      </div>
      <div>
        <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-text-muted">
          Result
        </div>
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950/70 p-2 font-mono text-[10px] text-text-secondary">
          {part.result === undefined ? 'Running…' : String(part.result)}
        </pre>
      </div>
    </div>
  </div>
);

const AssistantParts = () => (
  <MessagePrimitive.Parts>
    {({ part }) => {
      if (part.type === 'text') {
        if (part.status?.type === 'running' && part.text === '') {
          return <div className="py-1 text-text-muted">Thinking…</div>;
        }
        return (
          <MarkdownTextPrimitive className="space-y-2 break-words [&_a]:text-primary [&_code]:rounded [&_code]:bg-slate-950/70 [&_code]:px-1 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-slate-950/70 [&_pre]:p-3" />
        );
      }
      if (part.type === 'reasoning') {
        return (
          <details className="my-2 rounded-md border border-border bg-slate-950/30 px-3 py-2 text-text-secondary">
            <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wider text-text-muted">
              Reasoning
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px]">
              {part.text}
            </pre>
          </details>
        );
      }
      if (part.type === 'tool-call') return <ToolCard part={part} />;
      if (part.type === 'image')
        return <MessagePartPrimitive.Image className="max-h-80 rounded-md" />;
      return null;
    }}
  </MessagePrimitive.Parts>
);

const UserMessage = () => (
  <MessagePrimitive.Root className="mx-auto flex w-full max-w-3xl justify-end px-3 py-2">
    <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm leading-relaxed text-slate-950">
      <MessagePrimitive.Parts>
        {({ part }) => {
          if (part.type === 'text') return <MessagePartPrimitive.Text />;
          if (part.type === 'image') {
            return <MessagePartPrimitive.Image className="mt-2 max-h-64 rounded-md" />;
          }
          return null;
        }}
      </MessagePrimitive.Parts>
    </div>
  </MessagePrimitive.Root>
);

const AssistantMessageView = () => (
  <MessagePrimitive.Root className="group mx-auto w-full max-w-3xl px-3 py-2">
    <div className="max-w-[92%] rounded-lg border border-border bg-bg-subtle px-3 py-2 text-sm leading-relaxed text-text">
      <AssistantParts />
      <AuiIf
        condition={(state) =>
          state.message.status?.type === 'incomplete' && state.message.status.reason === 'error'
        }
      >
        <ErrorPrimitive.Root className="mt-2 rounded-md border border-danger/30 bg-danger/10 p-2 text-xs text-danger">
          <ErrorPrimitive.Message />
        </ErrorPrimitive.Root>
      </AuiIf>
    </div>
    <ActionBarPrimitive.Root className="mt-1 flex h-7 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      <ActionBarPrimitive.Copy className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-text">
        <Copy className="h-3.5 w-3.5" />
      </ActionBarPrimitive.Copy>
    </ActionBarPrimitive.Root>
  </MessagePrimitive.Root>
);

const Composer = () => (
  <div className="border-t border-border bg-bg-subtle/90 p-3">
    <ComposerPrimitive.Root className="mx-auto max-w-3xl rounded-lg border border-border bg-slate-950/70 p-2">
      <ComposerPrimitive.Attachments>
        {({ attachment }) => (
          <AttachmentPrimitive.Root className="mb-2 inline-flex items-center gap-2 rounded border border-border bg-bg-subtle p-1.5 text-xs text-text-secondary">
            {attachment.content?.[0]?.type === 'image' && (
              <img src={attachment.content[0].image} className="h-10 w-10 rounded object-cover" />
            )}
            <AttachmentPrimitive.Name />
            <AttachmentPrimitive.Remove className="rounded p-1 hover:bg-bg-hover">
              <X className="h-3 w-3" />
            </AttachmentPrimitive.Remove>
          </AttachmentPrimitive.Root>
        )}
      </ComposerPrimitive.Attachments>
      <ComposerPrimitive.Input
        rows={2}
        placeholder="Send a test prompt through Plexus…"
        className="max-h-40 min-h-14 w-full resize-none bg-transparent px-1 py-1 text-sm text-text outline-none placeholder:text-text-muted"
        style={{ outline: 'none', boxShadow: 'none' }}
      />
      <div className="mt-1 flex items-center justify-between">
        <ComposerPrimitive.AddAttachment className="rounded-md p-2 text-text-muted hover:bg-bg-hover hover:text-text">
          <Paperclip className="h-4 w-4" />
        </ComposerPrimitive.AddAttachment>
        <ThreadPrimitive.If running={false}>
          <ComposerPrimitive.Send className="rounded-md bg-primary p-2 text-slate-950 hover:bg-primary-hover disabled:opacity-40">
            <SendHorizontal className="h-4 w-4" />
          </ComposerPrimitive.Send>
        </ThreadPrimitive.If>
        <ThreadPrimitive.If running>
          <ComposerPrimitive.Cancel className="rounded-md bg-danger p-2 text-white hover:opacity-90">
            <Square className="h-4 w-4 fill-current" />
          </ComposerPrimitive.Cancel>
        </ThreadPrimitive.If>
      </div>
    </ComposerPrimitive.Root>
  </div>
);

const PlaygroundThread = ({
  selectedKey,
  selectedModel,
}: Pick<PlaygroundChatProps, 'selectedKey' | 'selectedModel'>) => (
  <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-bg">
    <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <ThreadPrimitive.Empty>
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center text-sm text-text-secondary">
          <div className="mb-3 rounded-full border border-primary/30 bg-primary/10 p-3 text-primary">
            <Wrench className="h-5 w-5" />
          </div>
          <div className="font-medium text-text">Plexus simulation is active</div>
          <div className="mt-1 text-xs text-text-muted">
            Key “{selectedKey.key}” · model “{selectedModel}”
          </div>
        </div>
      </ThreadPrimitive.Empty>
      <ThreadPrimitive.Messages>
        {({ message }) =>
          message.role === 'user' ? (
            <UserMessage />
          ) : message.role === 'assistant' ? (
            <AssistantMessageView />
          ) : null
        }
      </ThreadPrimitive.Messages>
      <ThreadPrimitive.ScrollToBottom className="sticky bottom-2 mx-auto rounded-full border border-border bg-bg-subtle p-2 text-text-secondary shadow-lg hover:text-text disabled:hidden">
        <ArrowDown className="h-4 w-4" />
      </ThreadPrimitive.ScrollToBottom>
    </ThreadPrimitive.Viewport>
    <Composer />
  </ThreadPrimitive.Root>
);

export const PlaygroundChat = memo((props: PlaygroundChatProps) => {
  const tasksRef = useRef<string[]>([]);
  const adapter = useMemo(
    () => makeAdapter({ ...props, tasks: tasksRef.current }),
    [
      props.selectedKey,
      props.selectedModel,
      props.selectedApi,
      props.toolMode,
      props.onRoutingPending,
      props.onToolCalls,
    ]
  );
  const runtime = useLocalRuntime(adapter, {
    adapters: { attachments: imageAttachmentAdapter },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <PlaygroundThread selectedKey={props.selectedKey} selectedModel={props.selectedModel} />
    </AssistantRuntimeProvider>
  );
});

PlaygroundChat.displayName = 'PlaygroundChat';
