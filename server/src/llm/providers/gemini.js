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
      const generationConfig = { maxOutputTokens: maxTokens };
      if (json) generationConfig.responseMimeType = "application/json";
      if (/gemini-3/.test(model)) {
        // Gemini 3.x: thinking is on by default and counts as output tokens. Send ONLY thinkingLevel
        // (sending thinkingBudget too is an error). Temperature is ignored by 3.x, so we don't send it.
        generationConfig.thinkingConfig = {
          thinkingLevel: process.env.GEMINI_THINKING_LEVEL || "minimal",
        };
      } else {
        generationConfig.temperature = temperature;
        if (/2\.5-flash/.test(model))
          generationConfig.thinkingConfig = { thinkingBudget: 0 };
      }
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
        .filter((p) => !p.thought)
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
