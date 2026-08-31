import { z } from "zod";

import { FindingSchema, RawFindingSchema, type Finding, type RawFinding, type ProviderConfig } from "./types.js";
import { createProvider, type LLMProvider } from "./providers.js";
import { reserveBudgetedCall, settleSuccessfulBudgetedCall } from "./budget.js";

const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";

export const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-sonnet-latest";
export const DEFAULT_API_ENDPOINT = ANTHROPIC_MESSAGES_ENDPOINT;

function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();

  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

export function extractJsonText(text: string): string {
  const trimmed = stripMarkdownFences(text);

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    const firstObject = trimmed.indexOf("{");
    const firstArray = trimmed.indexOf("[");
    const start =
      firstObject === -1
        ? firstArray
        : firstArray === -1
          ? firstObject
          : Math.min(firstObject, firstArray);
    const endObject = trimmed.lastIndexOf("}");
    const endArray = trimmed.lastIndexOf("]");
    const end = Math.max(endObject, endArray);

    if (start >= 0 && end > start) {
      const candidate = trimmed.slice(start, end + 1);
      JSON.parse(candidate);
      return candidate;
    }

    throw new Error("LLM response did not contain parseable JSON.");
  }
}

export async function callLLM(
  providerConfig: ProviderConfig,
  system: string,
  prompt: string,
  maxTokens = 4096
): Promise<string> {
  const reservation = reserveBudgetedCall(providerConfig, system, prompt, maxTokens);
  const provider = createProvider(reservation.providerConfig);
  const responseText = await provider.call(system, prompt, reservation.maxTokens);
  settleSuccessfulBudgetedCall(reservation, responseText);
  return responseText;
}

export async function callLLMStructured<T>(
  providerConfig: ProviderConfig,
  system: string,
  prompt: string,
  schema: z.ZodType<T>
): Promise<T> {
  let currentPrompt = prompt;
  let lastResponseText = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    // Provider/network errors are not schema errors and must not trigger another paid call.
    const rawText = await callLLM(providerConfig, system, currentPrompt);
    lastResponseText = rawText;

    try {
      const jsonText = extractJsonText(rawText);
      const parsed = JSON.parse(jsonText) as unknown;
      return schema.parse(parsed);
    } catch (error) {
      const errorMessage =
        error instanceof z.ZodError
          ? error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")
          : error instanceof Error
            ? error.message
            : String(error);

      if (attempt === 3) {
        console.error(`::error::LLM structured output failed after 3 attempts. Last error: ${errorMessage}`);
        throw error;
      }

      console.warn(
        `::warning::LLM structured output attempt ${attempt} failed: ${errorMessage}. Retrying with feedback...`
      );

      currentPrompt = [
        prompt,
        "---",
        "CRITICAL: Your previous response failed validation and could not be parsed.",
        "Your previous response was:",
        lastResponseText || "[EMPTY RESPONSE]",
        "Error details:",
        errorMessage,
        "Please correct your output and respond ONLY with a valid JSON block that perfectly matches the requested schema. Do not include markdown fences, preamble, or other commentary.",
      ].join("\n\n");
    }
  }

  throw new Error("LLM structured output failed unexpectedly.");
}

// Legacy functions for backward compatibility
export async function callAnthropic(
  apiKey: string,
  model: string,
  system: string,
  prompt: string,
  maxTokens = 4096,
  apiEndpoint = DEFAULT_API_ENDPOINT
): Promise<string> {
  return callLLM(
    { type: "anthropic", config: { apiKey, model, baseURL: apiEndpoint } },
    system,
    prompt,
    maxTokens
  );
}

export async function callAnthropicStructured<T>(
  apiKey: string,
  model: string,
  system: string,
  prompt: string,
  schema: z.ZodType<T>,
  apiEndpoint = DEFAULT_API_ENDPOINT
): Promise<T> {
  return callLLMStructured(
    { type: "anthropic", config: { apiKey, model, baseURL: apiEndpoint } },
    system,
    prompt,
    schema
  );
}

export function normalizeFinding(
  finding: RawFinding,
  fallbackAgent: string,
  idPrefix: string
): Finding {
  return FindingSchema.parse({
    id: finding.id?.trim() || idPrefix,
    agent: finding.agent?.trim() || fallbackAgent,
    severity: finding.severity,
    file: finding.file.trim(),
    line: finding.line,
    claim: finding.claim.trim(),
    confidence: finding.confidence,
    ...(finding.rebuttal_to ? { rebuttal_to: finding.rebuttal_to.trim() } : {}),
  });
}

export function ensureFindingArray(values: unknown): RawFinding[] {
  return z.array(RawFindingSchema).parse(values);
}
