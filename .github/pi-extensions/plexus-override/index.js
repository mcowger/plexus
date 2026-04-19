// Plexus proxy baseUrl override for the Pi coding agent.
//
// Problem: pi-coding-agent-action's Agent constructor calls
// modelRegistry.find() and caches the returned Model reference BEFORE any
// extension factory runs. If we then call pi.registerProvider() in
// override mode, the registry replaces its model objects via `.map(...)`
// with new objects, leaving the Agent's captured reference stale. The
// provider (openai-completions) reads baseUrl from the captured model at
// request time and sends the request to the original openrouter.ai URL
// with the Plexus API key, which fails silently.
//
// Fix: mutate the pi-ai source-of-truth model objects in place. getModels()
// returns references to the singleton modelRegistry Map's values, which is
// the same object the Agent cached. In-place mutation updates every
// reference, including the Agent's.
import { getModels } from "@mariozechner/pi-ai";

const PROVIDER = "openrouter";
const TAG = "[plexus-override]";

export default function plexusOverride(pi) {
  console.log(`${TAG} factory invoked`);
  const baseUrl = process.env.PLEXUS_BASE_URL;
  const apiKey = process.env.PLEXUS_API_KEY;
  console.log(
    `${TAG} env: PLEXUS_BASE_URL=${baseUrl ? "set" : "UNSET"} ` +
      `PLEXUS_API_KEY=${apiKey ? "set" : "UNSET"}`,
  );

  if (!baseUrl) {
    console.error(`${TAG} PLEXUS_BASE_URL not set; skipping`);
    return;
  }

  const models = getModels(PROVIDER);
  console.log(`${TAG} getModels("${PROVIDER}") returned ${models.length} models`);
  if (!models.length) {
    console.error(`${TAG} no built-in models found for ${PROVIDER}`);
    return;
  }

  const before = models[0].baseUrl;
  for (const m of models) {
    m.baseUrl = baseUrl;
  }
  const after = models[0].baseUrl;
  console.log(
    `${TAG} mutated ${models.length} model baseUrls: "${before}" -> "${after}"`,
  );

  if (apiKey) {
    try {
      pi.registerProvider(PROVIDER, {
        baseUrl,
        apiKey,
        authHeader: true,
      });
      console.log(`${TAG} pi.registerProvider(${PROVIDER}) succeeded`);
    } catch (err) {
      console.error(`${TAG} pi.registerProvider failed:`, err);
    }
  }
  console.log(`${TAG} factory done`);
}
