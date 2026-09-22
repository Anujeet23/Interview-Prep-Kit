import { ProviderError, postJson, parseDelay } from "./errors.js";

/** Google Gemini via the Generative Language REST API (free tier from Google AI Studio). */
export function geminiProvider({ apiKey, model }) {
  return {
    name: `gemini:${model}`,
    async complete({
      system,
      messages,
      maxTokens = 2048,
      temperature = 0.3,
      json = true,
    }) {
      const generationConfig = { temperature, maxOutputTokens: maxTokens };
      if (json) generationConfig.responseMimeType = "application/json";
      // 2.5 Flash "thinks" by default and bills thinking against output tokens; we don't need it here.
      // if (/2\.5-flash/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
      if (/2\.5-flash/.test(model))
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
      // Gemini 3.x: thinking is on by default and eats the output-token budget; we only need structured extraction.
      else if (/gemini-3/.test(model))
        generationConfig.thinkingConfig = {
          thinkingLevel: process.env.GEMINI_THINKING_LEVEL || "minimal",
        };
      const { res, data } = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          headers: { "x-goog-api-key": apiKey },
          body: {
            systemInstruction: { parts: [{ text: system }] },
            contents: messages.map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            })),
            generationConfig,
          },
        },
      );
      if (!res.ok) throw classify(res, data);
      const cand = data.candidates?.[0];
      const text = (cand?.content?.parts || [])
        .map((p) => p.text || "")
        .join("");
      if (!text)
        throw new ProviderError(
          "BAD_RESPONSE",
          `Empty response (finishReason: ${cand?.finishReason || data.promptFeedback?.blockReason || "unknown"})`,
        );
      return {
        text,
        truncated: cand?.finishReason === "MAX_TOKENS",
        usage: data.usageMetadata,
      };
    },
  };
}

function classify(res, data) {
  const msg = data?.error?.message || data?.raw || `HTTP ${res.status}`;
  if (res.status === 429) {
    const details = data?.error?.details || [];
    const retry = details.find((d) =>
      String(d["@type"]).includes("RetryInfo"),
    )?.retryDelay;
    const perDay = JSON.stringify(details).match(/PerDay/i);
    return new ProviderError(perDay ? "QUOTA_EXHAUSTED" : "RATE_LIMITED", msg, {
      retryAfterMs: parseDelay(retry),
      status: 429,
    });
  }
  if (res.status === 401 || res.status === 403)
    return new ProviderError("AUTH", msg, { status: res.status });
  if (res.status >= 500)
    return new ProviderError("SERVER", msg, { status: res.status });
  return new ProviderError("BAD_REQUEST", msg, { status: res.status });
}
