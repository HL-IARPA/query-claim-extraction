/**
 * Gemini API client with JSON mode support
 */

import type { LLMResponse } from './types.js';

// Pricing for Gemini 2.5 Flash
const INPUT_COST_PER_MILLION = 0.15;
const OUTPUT_COST_PER_MILLION = 0.60;
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 120000;

export interface GeminiConfig {
  apiKey: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export class GeminiClient {
  private apiKey: string;
  private model: string;
  private temperature: number;
  private maxOutputTokens: number;

  constructor(config: GeminiConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'gemini-2.5-flash';
    this.temperature = config.temperature ?? 0.3; // Lower for more deterministic output
    this.maxOutputTokens = config.maxOutputTokens || 16384;
  }

  async generateJSON<T>(
    systemPrompt: string,
    userPrompt: string,
    schema?: object
  ): Promise<{ data: T; response: LLMResponse }> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: this.maxOutputTokens,
      temperature: this.temperature,
      responseMimeType: 'application/json',
    };

    if (schema) {
      generationConfig.responseSchema = schema;
    }

    const requestBody = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig,
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        if (attempt > 0) {
          console.log(`  [Gemini] Retry ${attempt}/${MAX_RETRIES}...`);
        }

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`  [Gemini] Error ${response.status}: ${errorText.slice(0, 200)}`);

          if (response.status === 429 || response.status >= 500) {
            const delay = Math.min(15000 * Math.pow(2, attempt), 120000);
            console.log(`  [Gemini] Rate limited, waiting ${delay}ms...`);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          throw new Error(`Gemini API error (${response.status}): ${errorText}`);
        }

        const data = (await response.json()) as Record<string, unknown>;

        const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
        const parts = (candidates?.[0]?.content as Record<string, unknown>)?.parts as Array<Record<string, unknown>> | undefined;
        const content = parts
          ?.filter((p) => !p.thought && p.text)
          .map((p) => p.text as string)
          .join('') || '';

        const usage = (data.usageMetadata as Record<string, number>) || {};
        const promptTokens = usage.promptTokenCount || 0;
        const completionTokens = usage.candidatesTokenCount || 0;
        const totalTokens = usage.totalTokenCount || promptTokens + completionTokens;

        const cost =
          (promptTokens / 1_000_000) * INPUT_COST_PER_MILLION +
          (completionTokens / 1_000_000) * OUTPUT_COST_PER_MILLION;

        const llmResponse: LLMResponse = {
          content,
          tokens: totalTokens,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          cost_usd: cost,
        };

        // Parse JSON
        const parsed = JSON.parse(content) as T;

        return { data: parsed, response: llmResponse };
      } catch (error) {
        clearTimeout(timeoutId);
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < MAX_RETRIES) {
          const delay = Math.min(15000 * Math.pow(2, attempt), 120000);
          console.log(`  [Gemini] Error: ${lastError.message.slice(0, 100)}, retrying in ${delay}ms...`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw lastError || new Error('Gemini request failed');
  }
}

// Singleton for convenience
let defaultClient: GeminiClient | null = null;

export function getGeminiClient(): GeminiClient {
  if (!defaultClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    defaultClient = new GeminiClient({ apiKey });
  }
  return defaultClient;
}
