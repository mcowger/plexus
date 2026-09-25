import { logger } from '../../utils/logger';
import { Dispatcher } from '../dispatch/dispatcher';
import { UsageStorageService } from '../observability/usage-storage';
import { UsageRecord } from '../../types/usage';
import { DebugManager } from '../observability/debug-manager';
import { calculateCosts } from '../../utils/calculate-costs';
import { buildProbeChatRequest } from './probe-request';
import {
  OpenAITransformer,
  AnthropicTransformer,
  GeminiTransformer,
  ResponsesTransformer,
} from '../../transformers';

export type ProbeSource = 'manual' | 'background';

export type ProbeApiType =
  | 'chat'
  | 'messages'
  | 'gemini'
  | 'responses'
  | 'embeddings'
  | 'images'
  | 'decisions'
  | 'speech'
  | 'oauth';

export interface RunProbeArgs {
  provider: string;
  model: string;
  apiType: ProbeApiType;
  source: ProbeSource;
  sourceIp?: string | null;
}

export interface ProbeResult {
  success: boolean;
  durationMs: number;
  apiType: ProbeApiType;
  response?: string;
  error?: string;
}

/**
 * Non-chat probe templates. Kept for manual-test UI debugging only — the
 * background explorer always uses the chat shape from probe-request.ts.
 *
 * Shapes mirror the historical TEST_TEMPLATES in routes/management/test.ts.
 */
const SECONDARY_SYSTEM_PROMPT = 'You are a helpful assistant.';
const SECONDARY_USER_PROMPT = 'Just respond with the word acknowledged';

function buildSecondaryRequest(apiType: ProbeApiType, modelPath: string): any {
  switch (apiType) {
    case 'messages':
      return {
        model: modelPath,
        stream: false,
        max_tokens: 100,
        system: SECONDARY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: SECONDARY_USER_PROMPT }],
      };
    case 'gemini':
      return {
        model: modelPath,
        contents: [{ role: 'user', parts: [{ text: SECONDARY_USER_PROMPT }] }],
        system_instruction: { parts: [{ text: SECONDARY_SYSTEM_PROMPT }] },
        generationConfig: { maxOutputTokens: 100 },
      };
    case 'responses':
      return {
        model: modelPath,
        input: SECONDARY_USER_PROMPT,
        instructions: SECONDARY_SYSTEM_PROMPT,
      };
    case 'embeddings':
      return { model: modelPath, input: ['Hello world'] };
    case 'images':
      // Deliberately minimal: `response_format` and `size` are not universally
      // supported (Codex Images rejects `url` and does not render 256x256), so
      // the probe sends only what every image target accepts.
      return { model: modelPath, prompt: 'A tiny red square', n: 1 };
    case 'decisions':
      return {
        model: modelPath,
        state: 'My checkout page shows a blank screen after I click Pay.',
        questions: {
          is_bug: { type: 'noul', instructions: 'Is the customer reporting a software defect?' },
          team: {
            type: 'choice',
            instructions: 'Which team should own this ticket?',
            criteria: { payments: 'Checkout and billing', frontend: 'Rendering issues' },
          },
          urgency: {
            type: 'score',
            instructions: 'How urgent is this ticket?',
            criteria: ['Can wait', 'This week', 'Blocking revenue'],
          },
        },
      };
    case 'speech':
      return { model: modelPath, input: 'Hello world' };
    case 'oauth':
      return {
        context: {
          systemPrompt: SECONDARY_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: SECONDARY_USER_PROMPT, timestamp: Date.now() }],
        },
        options: { maxTokens: 100 },
      };
    default:
      throw new Error(`No secondary probe template for apiType '${apiType}'`);
  }
}

export class ProbeService {
  constructor(
    private dispatcher: Dispatcher,
    private usageStorage: UsageStorageService
  ) {}

  async runProbe(args: RunProbeArgs): Promise<ProbeResult> {
    const { provider, model, apiType, source } = args;
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    const directModelPath = `direct/${provider}/${model}`;

    const usageRecord: Partial<UsageRecord> = {
      requestId,
      date: new Date().toISOString(),
      sourceIp: args.sourceIp ?? null,
      apiKey: 'probe',
      attribution: source,
      incomingApiType: apiType,
      startTime,
      isStreamed: false,
      responseStatus: 'pending',
      incomingModelAlias: directModelPath,
    };

    this.usageStorage.emitStartedAsync(usageRecord);

    if (apiType === ('transcriptions' as ProbeApiType)) {
      // Historic test.ts rejected transcriptions; preserve that.
      const error = 'Cannot probe transcriptions API — requires file upload.';
      usageRecord.responseStatus = 'error';
      usageRecord.durationMs = Date.now() - startTime;
      await this.usageStorage.saveRequest(usageRecord as UsageRecord);
      return {
        success: false,
        durationMs: usageRecord.durationMs,
        apiType,
        error,
      };
    }

    try {
      const testRequest =
        apiType === 'chat'
          ? buildProbeChatRequest(provider, model)
          : buildSecondaryRequest(apiType, directModelPath);

      let response: any;

      if (apiType === 'oauth') {
        const { context, options } = testRequest as {
          context: {
            systemPrompt?: string;
            messages: Array<{ role: string; content: any }>;
          };
          options?: Record<string, any>;
        };

        const unifiedRequest = {
          model: directModelPath,
          messages: [
            ...(context.systemPrompt ? [{ role: 'system', content: context.systemPrompt }] : []),
            ...context.messages.map((m) => ({
              role: m.role as any,
              content: m.content,
            })),
          ],
          incomingApiType: 'oauth',
          originalBody: { context, options },
          requestId,
        };

        response = await this.dispatcher.dispatch(unifiedRequest as any);
      } else if (apiType === 'embeddings') {
        const embReq = testRequest as { model: string; input: string | string[] };
        response = await this.dispatcher.dispatchEmbeddings({
          model: directModelPath,
          input: embReq.input,
          originalBody: testRequest,
          requestId,
          incomingApiType: 'embeddings',
        });
      } else if (apiType === 'images') {
        const imgReq = testRequest as { model: string; prompt: string; n?: number };
        response = await this.dispatcher.dispatchImageGenerations({
          model: imgReq.model,
          prompt: imgReq.prompt,
          n: imgReq.n,
          originalBody: testRequest,
          requestId,
          incomingApiType: 'images',
        });
      } else if (apiType === 'decisions') {
        response = await this.dispatcher.dispatchDecisions({
          ...testRequest,
          originalBody: testRequest,
          requestId,
          incomingApiType: 'decisions',
        });
      } else if (apiType === 'speech') {
        const { SpeechTransformer } = await import('../../transformers/speech');
        const transformer = new SpeechTransformer();
        const unifiedRequest = await transformer.parseRequest(testRequest);
        unifiedRequest.incomingApiType = 'speech';
        unifiedRequest.originalBody = testRequest;
        unifiedRequest.requestId = requestId;
        response = await this.dispatcher.dispatchSpeech(unifiedRequest);
      } else {
        let transformer;
        switch (apiType) {
          case 'chat':
            transformer = new OpenAITransformer();
            break;
          case 'messages':
            transformer = new AnthropicTransformer();
            break;
          case 'gemini':
            transformer = new GeminiTransformer();
            break;
          case 'responses':
            transformer = new ResponsesTransformer();
            break;
          default:
            transformer = new OpenAITransformer();
        }
        const unifiedRequest = await transformer.parseRequest(testRequest);
        unifiedRequest.incomingApiType = apiType;
        unifiedRequest.originalBody = testRequest;
        unifiedRequest.requestId = requestId;
        // Probes skip the inference routes that derive session headers, so give
        // each probe its own OpenCode Go session (sent only to opencode-go).
        unifiedRequest.cacheRoutingHeaders = { 'x-opencode-session': requestId };
        response = await this.dispatcher.dispatch(unifiedRequest);
      }

      // For streaming responses, cancel the stream to release the concurrency
      // slot. The probe only needs routing metadata (plexus.*), not the stream
      // content. Without this, the dispatcher's stream wrapper never fires its
      // release callback, leaking the concurrency slot permanently.
      if (response?.stream && typeof response.stream.cancel === 'function') {
        try {
          await response.stream.cancel();
        } catch (e) {
          // Slot is already released by the dispatcher's wrapper before the
          // underlying stream is cancelled; cancellation failure is non-fatal.
          logger.warn('Probe stream cancellation failed (slot already released):', e);
        }
      }

      const durationMs = Date.now() - startTime;

      usageRecord.provider = response.plexus?.provider;
      usageRecord.selectedModelName = response.plexus?.model;
      usageRecord.canonicalModelName = response.plexus?.canonicalModel;
      usageRecord.outgoingApiType = response.plexus?.apiType;
      usageRecord.durationMs = durationMs;
      usageRecord.responseStatus = 'success';
      usageRecord.isPassthrough =
        apiType !== 'chat' &&
        apiType !== 'messages' &&
        apiType !== 'gemini' &&
        apiType !== 'responses' &&
        apiType !== 'decisions';
      usageRecord.attemptCount = response.plexus?.attemptCount || 1;
      usageRecord.retryHistory = response.plexus?.retryHistory || null;
      usageRecord.finalAttemptProvider =
        response.plexus?.finalAttemptProvider || usageRecord.provider || null;
      usageRecord.finalAttemptModel =
        response.plexus?.finalAttemptModel || usageRecord.selectedModelName || null;
      usageRecord.upstreamModel =
        response.plexus?.upstreamModel || usageRecord.finalAttemptModel || null;
      usageRecord.allAttemptedProviders = response.plexus?.allAttemptedProviders || null;

      if (response.usage) {
        usageRecord.tokensInput = response.usage.input_tokens;
        usageRecord.tokensOutput = response.usage.output_tokens;
        usageRecord.tokensCached = response.usage.cached_tokens;
        usageRecord.tokensCacheWrite = response.usage.cache_creation_tokens;
        usageRecord.tokensReasoning = response.usage.reasoning_tokens;
      }

      const pricing = response.plexus?.pricing;
      const providerDiscount = response.plexus?.providerDiscount;
      calculateCosts(usageRecord, pricing, providerDiscount, {
        upstreamModel: response.plexus?.upstreamModel,
        pricingModel: response.plexus?.pricingModel,
        pricingFallback: response.plexus?.pricingFallback,
      });

      this.usageStorage.emitUpdatedAsync({
        requestId,
        provider: usageRecord.provider,
        selectedModelName: usageRecord.selectedModelName,
        canonicalModelName: usageRecord.canonicalModelName,
      });

      await this.usageStorage.saveRequest(usageRecord as UsageRecord);

      let responseText: string;
      if (apiType === 'decisions') {
        responseText = JSON.stringify(response.answers);
      } else if (apiType === 'images') {
        responseText =
          response.data && Array.isArray(response.data)
            ? `Success (${response.data.length} image${response.data.length > 1 ? 's' : ''} created)`
            : 'Success';
      } else if (apiType === 'embeddings') {
        responseText =
          response.data && Array.isArray(response.data)
            ? `Success (${response.data.length} embedding${response.data.length > 1 ? 's' : ''})`
            : 'Success';
      } else {
        responseText = response.content
          ? typeof response.content === 'string'
            ? response.content.substring(0, 100)
            : 'Success'
          : 'Success';
      }

      return {
        success: true,
        durationMs,
        apiType,
        response: responseText,
      };
    } catch (e: any) {
      const durationMs = Date.now() - startTime;
      logger.error(`Probe failed for ${provider}/${model} (${apiType}, ${source}):`, e);

      usageRecord.responseStatus = 'error';
      usageRecord.durationMs = durationMs;
      usageRecord.attemptCount = e.routingContext?.attemptCount || usageRecord.attemptCount || 1;
      usageRecord.retryHistory = e.routingContext?.retryHistory || usageRecord.retryHistory || null;
      await this.usageStorage.saveRequest(usageRecord as UsageRecord);

      const errorDetails = {
        apiType,
        ...(e.routingContext || {}),
      };
      this.usageStorage.saveError(requestId, e, errorDetails);
      DebugManager.getInstance().flush(requestId);

      return {
        success: false,
        durationMs,
        apiType,
        error: e.message || 'Unknown error',
      };
    }
  }
}
