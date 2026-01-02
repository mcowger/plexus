import { inspect } from "util";

const model = process.argv[2];
const apiType = process.argv[3] as "chat" | "messages" | "gemini";
const prompt = process.argv[4];
const includeTool = process.argv[5] === "true";
const stream = process.argv[6] === "true";

if (!model || !apiType || !prompt) {
  console.error("Usage: bun test.ts <model> <api_type> <prompt> [include_tool] [stream]");
  console.error("  api_type: chat | messages | gemini");
  console.error("  include_tool: true | false (default: false)");
  console.error("  stream: true | false (default: false)");
  console.error("\nExample: bun test.ts gpt-4o chat 'What is the weather in SF?' true true");
  process.exit(1);
}

const templates = {
  chat: (model: string, prompt: string, tool: boolean, stream: boolean) => ({
    model,
    messages: [{ role: "user", content: prompt }],
    stream,
    ...(tool && {
      tools: [{
        type: "function",
        function: {
          name: "get_weather",
          description: "Get the current weather in a given location",
          parameters: {
            type: "object",
            properties: {
              location: { type: "string", description: "The city and state, e.g. San Francisco, CA" },
              unit: { type: "string", enum: ["celsius", "fahrenheit"] }
            },
            required: ["location"]
          }
        }
      }]
    })
  }),
  messages: (model: string, prompt: string, tool: boolean, stream: boolean) => ({
    model,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
    stream,
    ...(tool && {
      tools: [{
        name: "get_weather",
        description: "Get the current weather in a given location",
        input_schema: {
          type: "object",
          properties: {
            location: { type: "string", description: "The city and state, e.g. San Francisco, CA" },
            unit: { type: "string", enum: ["celsius", "fahrenheit"], description: "The unit of temperature.  If the user doesn't specify, the default is celsius." }
          },
          required: ["location"]
        }
      }]
    })
  }),
  gemini: (_model: string, prompt: string, tool: boolean, stream: boolean) => ({
    contents: [{ parts: [{ text: prompt }] }],
    ...(tool && {
      tools: [{
        function_declarations: [{
          name: "get_weather",
          description: "Get the current weather in a given location",
          parameters: {
            type: "object",
            properties: {
              location: { type: "string", description: "The city and state, e.g. San Francisco, CA" },
              unit: { type: "string", enum: ["celsius", "fahrenheit"] }
            },
            required: ["location"]
          }
        }]
      }]
    })
  })
};

if (!templates[apiType]) {
  console.error(`Invalid api_type: ${apiType}. Must be one of: chat, messages, gemini`);
  process.exit(1);
}

const requestBody = templates[apiType](model, prompt, includeTool, stream);

let endpoint = "";
if (apiType === "gemini") {
  const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
  endpoint = `/v1beta/models/${model}:${action}`;
} else if (apiType === "messages") {
  endpoint = "/v1/messages";
} else {
  endpoint = "/v1/chat/completions";
}

const url = `http://localhost:4000${endpoint}`;

console.log(`\n🚀 Sending request to ${url}`);
console.log(`📦 Model: ${model}`);
console.log(`🛠️  Tool enabled: ${includeTool}`);
console.log(`🌊 Stream enabled: ${stream}`);
console.log(`-------------------------------------------\n`);

try {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (stream) {
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        process.stdout.write(decoder.decode(value));
      }
    }
  } else {
    const responseText = await response.text();
    try {
      const data = JSON.parse(responseText);
      console.log(inspect(data, { colors: true, depth: null }));
    } catch (e) {
      console.log(responseText);
    }
  }

  if (!response.ok) {
    console.error(`\n❌ Request failed with status ${response.status}`);
  }
} catch (error) {
  console.error("\n❌ Error:", error);
}
