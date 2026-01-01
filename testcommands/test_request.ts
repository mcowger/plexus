import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const model = process.argv[2];
let jsonFile = process.argv[3];

if (!model || !jsonFile) {
  console.error("Usage: bun test_request.ts <model> <json_file>");
  console.error("Example: bun test_request.ts minimax-m2.1 chat/basic.json");
  console.error("Example: bun test_request.ts gemini-1.5-flash gemini/basic.json");
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve the path relative to the backend test cases directory
const CASES_BASE = path.join(__dirname, "..", "packages", "backend", "src", "services", "__tests__", "cases");

let finalPath = jsonFile;
if (!existsSync(finalPath)) {
    finalPath = path.join(CASES_BASE, jsonFile);
}

// Try appending .json if not present
if (!existsSync(finalPath) && !finalPath.endsWith(".json")) {
    finalPath += ".json";
}

if (!existsSync(finalPath)) {
  console.error(`Error: Could not find test case file: ${jsonFile}`);
  console.error(`Search path: ${finalPath}`);
  process.exit(1);
}

try {
  const fileContent = readFileSync(finalPath, "utf-8");
  const requestBody = JSON.parse(fileContent);

  // Determine endpoint based on path
  const isMessages = jsonFile.includes("messages/") || jsonFile.startsWith("messages");
  const isGemini = jsonFile.includes("gemini/") || jsonFile.startsWith("gemini");
  const isStream = jsonFile.includes("stream") || requestBody.stream;

  let endpoint;
  if (isGemini) {
    const action = isStream ? "streamGenerateContent?alt=sse" : "generateContent";
    endpoint = `/v1beta/models/${model}:${action}`;
  } else {
    endpoint = isMessages ? "/v1/messages" : "/v1/chat/completions";
    // Replace placeholder or set model for OpenAI/Anthropic
    requestBody.model = model;
  }
  
  const url = `http://localhost:4000${endpoint}`;
  
  console.log(`Sending request to ${url}`);
  console.log(`Model: ${model}`);
  console.log(`File:  ${path.relative(process.cwd(), finalPath)}`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (isStream) {
    console.log("\nResponse (Streaming):");
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
        console.log("\nResponse:", JSON.stringify(data, null, 2));
    } catch (e) {
        console.log("\nResponse (Text):", responseText);
    }
  }
  
  if (!response.ok) {
      console.error(`\nRequest failed with status ${response.status}`);
  }

} catch (error) {
  console.error("Error:", error);
}