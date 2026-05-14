import { logger } from '../utils/logger';
import { Dispatcher } from './dispatcher';
import { UsageStorageService } from './usage-storage';
import { UsageRecord } from '../types/usage';
import { DebugManager } from './debug-manager';
import { calculateCosts } from '../utils/calculate-costs';
import { buildProbeChatRequest } from './probe-request';
import {
  OpenAITransformer,
  AnthropicTransformer,
  GeminiTransformer,
  ResponsesTransformer,
} from '../transformers';

export type ProbeSource = 'manual' | 'background';

export type ProbeApiType =
  | 'chat'
  | 'messages'
  | 'gemini'
  | 'responses'
  | 'embeddings'
  | 'images'
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
      return {
        model: modelPath,
        prompt: 'A tiny 256x256 red square',
        n: 1,
        size: '256x256',
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
        response = await this.dispatcher.dispatchEmbeddings({
          model: directModelPath,
          originalBody: testRequest,
          requestId,
          incomingApiType: 'embeddings',
        });
      } else if (apiType === 'images') {
        const imgReq = testRequest as {
          model: string;
          prompt: string;
          n?: number;
          size?: string;
          quality?: string;
          style?: string;
          user?: string;
        };
        response = await this.dispatcher.dispatchImageGenerations({
          model: imgReq.model,
          prompt: imgReq.prompt,
          n: imgReq.n,
          size: imgReq.size,
          response_format: 'url' as const,
          quality: imgReq.quality,
          style: imgReq.style,
          user: imgReq.user,
          originalBody: testRequest,
          requestId,
          incomingApiType: 'images',
        } as any);
      } else if (apiType === 'speech') {
        const { SpeechTransformer } = await import('../transformers/speech');
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
        response = await this.dispatcher.dispatch(unifiedRequest);
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
        apiType !== 'responses';
      usageRecord.attemptCount = response.plexus?.attemptCount || 1;
      usageRecord.retryHistory = response.plexus?.retryHistory || null;
      usageRecord.finalAttemptProvider =
        response.plexus?.finalAttemptProvider || usageRecord.provider || null;
      usageRecord.finalAttemptModel =
        response.plexus?.finalAttemptModel || usageRecord.selectedModelName || null;
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
      calculateCosts(usageRecord, pricing, providerDiscount);

      this.usageStorage.emitUpdatedAsync({
        requestId,
        provider: usageRecord.provider,
        selectedModelName: usageRecord.selectedModelName,
        canonicalModelName: usageRecord.canonicalModelName,
      });

      await this.usageStorage.saveRequest(usageRecord as UsageRecord);

      let responseText: string;
      if (apiType === 'images') {
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
