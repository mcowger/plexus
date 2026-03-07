import { loadConfig } from '../config';
import { ResponsesTransformer } from '../transformers/responses';
import { Router } from '../services/router';
import { Dispatcher } from '../services/dispatcher';
import { TransformerFactory } from '../services/transformer-factory';

function isReadableStream<T>(input: unknown): input is ReadableStream<T> {
  return !!input && typeof (input as ReadableStream<T>).getReader === 'function';
}

function isAsyncIterable<T>(input: unknown): input is AsyncIterable<T> {
  return !!input && typeof (input as AsyncIterable<T>)[Symbol.asyncIterator] === 'function';
}

async function* readableStreamToAsyncIterable<T>(stream: ReadableStream<T>): AsyncIterable<T> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        return;
      }
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

async function previewStreamEvents(
  stream: ReadableStream<any> | AsyncIterable<any>,
  maxEvents = 8
) {
  const iterable = isReadableStream(stream) ? readableStreamToAsyncIterable(stream) : stream;

  if (!isAsyncIterable(iterable)) {
    throw new Error('Unsupported stream type for preview');
  }

  const events: any[] = [];
  let count = 0;
  for await (const event of iterable) {
    events.push(event);
    count += 1;
    if (count >= maxEvents) {
      break;
    }
  }

  return events;
}

function printError(label: string, error: any) {
  console.log(`\n=== ${label} ===`);
  console.log(
    JSON.stringify(
      {
        message: error?.message,
        status: error?.status,
        statusCode: error?.statusCode,
        piAiResponse: error?.piAiResponse,
        routingContext: error?.routingContext,
        cause: error?.cause
          ? {
              message: error.cause?.message,
              status: error.cause?.status,
              statusCode: error.cause?.statusCode,
              piAiResponse: error.cause?.piAiResponse,
              routingContext: error.cause?.routingContext,
            }
          : undefined,
      },
      null,
      2
    )
  );
}

async function main() {
  const inputPath = process.argv[2] || 'raw.json';
  const execute = process.argv.includes('--execute');
  const runDispatch = process.argv.includes('--dispatch');
  const previewEvents = process.argv.includes('--preview-events');

  await loadConfig();

  const body = await Bun.file(inputPath).json();
  const transformer = new ResponsesTransformer();
  const unifiedRequest = await transformer.parseRequest(body);
  unifiedRequest.incomingApiType = 'responses';
  unifiedRequest.originalBody = body;
  unifiedRequest.requestId = 'repro-responses-oauth';

  const candidates = await Router.resolveCandidates(
    unifiedRequest.model,
    unifiedRequest.incomingApiType
  );
  const route =
    candidates[0] || (await Router.resolve(unifiedRequest.model, unifiedRequest.incomingApiType));

  const dispatcher = new Dispatcher();
  const selected = (dispatcher as any).selectTargetApiType(route, unifiedRequest.incomingApiType);
  const providerTransformer = TransformerFactory.getTransformer(selected.targetApiType);
  const requestWithTargetModel = { ...unifiedRequest, model: route.model };
  const transformed = await (dispatcher as any).transformRequestPayload(
    requestWithTargetModel,
    route,
    providerTransformer,
    selected.targetApiType
  );

  const summary = {
    model: unifiedRequest.model,
    incomingApiType: unifiedRequest.incomingApiType,
    route: {
      provider: route.provider,
      model: route.model,
      canonicalModel: route.canonicalModel,
      apiBaseUrl: route.config.api_base_url,
      oauthProvider: route.config.oauth_provider,
    },
    selectedTargetApiType: selected.targetApiType,
    selectionReason: selected.selectionReason,
    isOAuthRoute: (dispatcher as any).isOAuthRoute(route, selected.targetApiType),
    transformedPayloadPreview:
      typeof transformed.payload === 'string'
        ? transformed.payload.slice(0, 500)
        : JSON.stringify(transformed.payload, null, 2).slice(0, 4000),
  };

  console.log('=== Routing Summary ===');
  console.log(JSON.stringify(summary, null, 2));

  if (!execute && !runDispatch) {
    return;
  }

  if (runDispatch) {
    console.log('\n=== Executing Full Dispatcher Path ===');
    try {
      const response = await dispatcher.dispatch(unifiedRequest);
      console.log(
        JSON.stringify(
          {
            id: response.id,
            model: response.model,
            hasStream: !!response.stream,
            plexus: response.plexus,
          },
          null,
          2
        )
      );
    } catch (error) {
      printError('Dispatcher Error', error);
    }
  }

  if (!execute) {
    return;
  }

  console.log('\n=== Executing Direct Provider Path ===');

  if ((dispatcher as any).isOAuthRoute(route, selected.targetApiType)) {
    try {
      const oauthResponse = await (dispatcher as any).dispatchOAuthRequest(
        transformed.payload,
        unifiedRequest,
        route,
        selected.targetApiType,
        providerTransformer
      );

      if (oauthResponse.stream) {
        console.log('Received streaming UnifiedChatResponse');
        if (previewEvents) {
          const events = await previewStreamEvents(oauthResponse.stream, 8);
          console.log(JSON.stringify(events, null, 2));
        }
        return;
      }

      console.log(JSON.stringify(oauthResponse, null, 2));
      return;
    } catch (error) {
      printError('Direct OAuth Error', error);
      return;
    }
  }

  const url = (dispatcher as any).buildRequestUrl(
    route,
    providerTransformer,
    requestWithTargetModel,
    selected.targetApiType
  );
  const headers = (dispatcher as any).setupHeaders(
    route,
    selected.targetApiType,
    requestWithTargetModel
  );
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(transformed.payload),
  });

  const text = await response.text();
  console.log(
    JSON.stringify(
      { status: response.status, headers: Object.fromEntries(response.headers), body: text },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('=== Repro Failed ===');
  console.error(error);
  process.exitCode = 1;
});
