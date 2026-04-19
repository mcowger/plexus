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

export default function plexusOverride(pi) {
  const baseUrl = process.env.PLEXUS_BASE_URL;
  const apiKey = process.env.PLEXUS_API_KEY;

  if (!baseUrl) {
    console.error("[plexus-override] PLEXUS_BASE_URL not set; skipping");
    return;
  }

  const models = getModels(PROVIDER);
  if (!models.length) {
    console.error(`[plexus-override] no built-in models found for ${PROVIDER}`);
    return;
  }

  for (const m of models) {
    m.baseUrl = baseUrl;
  }

  if (apiKey) {
    pi.registerProvider(PROVIDER, {
      baseUrl,
      apiKey,
      authHeader: true,
    });
  }
}
