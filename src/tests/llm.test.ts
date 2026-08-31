import assert from "node:assert/strict";
import test from "node:test";

import { callAnthropic, callLLM, extractJsonText } from "../llm.js";

test("extractJsonText accepts fenced JSON", () => {
  const extracted = extractJsonText("```json\n[{\"id\":\"1\"}]\n```");

  assert.equal(extracted, "[{\"id\":\"1\"}]");
});

test("extractJsonText extracts embedded JSON from surrounding text", () => {
  const extracted = extractJsonText("Here is the payload: {\"ok\":true}");

  assert.equal(extracted, "{\"ok\":true}");
});

test("callAnthropic retries once on retryable status and then succeeds", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response("retry", { status: 500 });
    }

    return new Response(
      JSON.stringify({
        content: [{ type: "text", text: "[]" }],
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  const response = await callAnthropic("test-key", "test-model", "system", "prompt");

  assert.equal(response, "[]");
  assert.equal(attempts, 2);
});

test("callAnthropic throws on non-retryable status", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async () => new Response("bad request", { status: 400 })) as typeof fetch;

  await assert.rejects(
    () => callAnthropic("test-key", "test-model", "system", "prompt"),
    /Anthropic request failed with 400/
  );
});

test("callLLMStructured self-heals after validation failure", async (t) => {
  const { callLLMStructured } = await import("../llm.js");
  const { z } = await import("zod");

  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const schema = z.object({
    success: z.boolean(),
  });

  let attempts = 0;
  const promptsSent: string[] = [];

  globalThis.fetch = (async (url, init) => {
    attempts += 1;
    const body = JSON.parse(init?.body as string);
    // Anthropic messages structure has content array: body.messages[0].content
    // Wait, let's look at how AnthropicProvider passes the prompt:
    // It passes messages: [{ role: "user", content: prompt }]
    const userPrompt = body.messages[0]?.content;
    promptsSent.push(userPrompt);

    if (attempts === 1) {
      // First attempt returns JSON that fails validation (missing success field)
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: JSON.stringify({ wrongField: true }) }],
        }),
        { status: 200 }
      );
    }

    // Second attempt returns valid JSON matching the schema
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text: JSON.stringify({ success: true }) }],
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  const result = await callLLMStructured(
    {
      type: "anthropic",
      config: { apiKey: "test-key", model: "claude-3-5-sonnet-latest" },
    },
    "system",
    "Please return success true.",
    schema
  );

  assert.deepEqual(result, { success: true });
  assert.equal(attempts, 2);
  assert.ok(promptsSent[1].includes("CRITICAL: Your previous response failed validation and could not be parsed."));
  assert.ok(promptsSent[1].includes("wrongField"));
});

test("callLLMStructured does not repeat paid calls for provider errors", async (t) => {
  const { callLLMStructured } = await import("../llm.js");
  const { z } = await import("zod");
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    return new Response("bad request", { status: 400 });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    () =>
      callLLMStructured(
        { type: "anthropic", config: { apiKey: "test-key", model: "claude-3-5-sonnet-latest" } },
        "system",
        "prompt",
        z.array(z.unknown())
      ),
    /Anthropic request failed with 400/
  );
  assert.equal(attempts, 1);
});

test("callAnthropic sends requests to the configured endpoint", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = (async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ content: [{ type: "text", text: "[]" }] }), {
      status: 200,
    });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await callAnthropic(
    "test-key",
    "test-model",
    "system",
    "prompt",
    100,
    "https://gateway.example.com/v1/messages"
  );

  assert.equal(requestedUrl, "https://gateway.example.com/v1/messages");
});

test("provider base URLs are expanded to their request endpoints", async (t) => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input) => {
    requestedUrls.push(String(input));
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "[]" } }],
        content: [{ type: "text", text: "[]" }],
      }),
      { status: 200 }
    );
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await callAnthropic("test-key", "test-model", "system", "prompt", 100, "https://gateway.example.com");
  await callLLM(
    { type: "openai", config: { apiKey: "test-key", model: "gpt-4o", baseURL: "https://openai.example.com/v1/" } },
    "system",
    "prompt"
  );
  await callLLM(
    { type: "custom", config: { apiKey: "test-key", model: "custom", baseURL: "https://custom.example.com/v1" } },
    "system",
    "prompt"
  );

  assert.deepEqual(requestedUrls, [
    "https://gateway.example.com/v1/messages",
    "https://openai.example.com/v1/chat/completions",
    "https://custom.example.com/v1/chat/completions",
  ]);
});
