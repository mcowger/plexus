# Troubleshooting

## API Timeout Errors / "API Error: terminated"

If you encounter API timeout errors, which often manifest in the Gemini CLI and derivatives as "API Error: terminated", you should check the Keep Alive timeout settings on your proxy server.

**Recommendation:** Ensure the Keep Alive timeout is set to at least **10 minutes**. Many default configurations are set to 30 or 60 seconds, which is often insufficient for long-running LLM requests.
