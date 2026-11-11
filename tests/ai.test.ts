import test from "node:test";
import assert from "node:assert/strict";
import { aiConfigured, aiModel, callAI, checkAI } from "../lib/server/ai";

test("Gemini keeps credentials server-side and rejects incomplete or invalid assessments", async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousModel = process.env.GEMINI_MODEL;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let payload: unknown = {};
  let status = 200;
  let transportCode: string | undefined;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(
      String(url),
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
    );
    assert.ok(!String(url).includes("private-fixture-key"));
    assert.equal(
      new Headers(init?.headers).get("x-goog-api-key"),
      "private-fixture-key",
    );
    const body = JSON.parse(String(init?.body));
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "low");
    assert.ok(!("temperature" in body.generationConfig));
    assert.equal(body.contents[0].parts[0].text, 'INPUT\n{"task":"a record"}');
    if (transportCode)
      throw new TypeError("fetch failed", { cause: { code: transportCode } });
    return new Response(JSON.stringify(payload), { status });
  };
  try {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    assert.equal(aiConfigured(), false);
    assert.equal(aiModel(), "gemini-3.8-flash");
    await assert.rejects(callAI("Return JSON", {}), /needs an API key/);
    assert.equal(calls, 0);
    process.env.GEMINI_API_KEY = "private-fixture-key";
    assert.equal(aiConfigured(), true);
    const input = { task: "a record" };
    payload = {
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [
              { thought: true, text: "private reasoning" },
              { text: '{"summary":' },
              { text: '"Observed evidence"}' },
            ],
          },
        },
      ],
    };
    assert.deepEqual(await callAI("Return JSON", input), {
      summary: "Observed evidence",
    });
    for (const finishReason of ["MAX_TOKENS", "SAFETY", undefined]) {
      payload = {
        candidates: [
          {
            finishReason,
            content: { parts: [{ text: '{"summary":"partial"}' }] },
          },
        ],
      };
      await assert.rejects(callAI("Return JSON", input), /complete assessment/);
    }
    payload = { promptFeedback: { blockReason: "SAFETY" } };
    await assert.rejects(callAI("Return JSON", input), /complete assessment/);
    payload = {
      candidates: [
        { finishReason: "STOP", content: { parts: [{ text: "not JSON" }] } },
      ],
    };
    await assert.rejects(callAI("Return JSON", input), /not valid JSON/);
    status = 429;
    await assert.rejects(callAI("Return JSON", input), /request limit/);
    const beforeTimeout = calls;
    transportCode = "UND_ERR_HEADERS_TIMEOUT";
    await assert.rejects(callAI("Return JSON", input), /took too long/);
    // A hung request is retried exactly once.
    assert.equal(calls, beforeTimeout + 2);
    transportCode = "EPERM";
    await assert.rejects(
      callAI("Return JSON", input),
      /blocked from connecting/,
    );
    process.env.GEMINI_MODEL = "../invalid?key=secret";
    const countBefore = calls;
    await assert.rejects(callAI("Return JSON", input), /model ID/);
    assert.equal(calls, countBefore);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previousModel;
  }
});

test("Gemini connection check reads model metadata without generating content or leaking provider errors", async () => {
  const original = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  const previousModel = process.env.GEMINI_MODEL;
  delete process.env.GEMINI_MODEL;
  process.env.GEMINI_API_KEY = "fixture-key";
  let invalid = false;
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /\/v1beta\/models\/gemini-3\.8-flash$/);
    assert.equal(init?.method, undefined);
    assert.equal(init?.body, undefined);
    assert.equal(
      new Headers(init?.headers).get("x-goog-api-key"),
      "fixture-key",
    );
    return invalid
      ? Response.json(
          {
            error: {
              message: "sensitive fixture-key",
              details: [{ reason: "API_KEY_INVALID" }],
            },
          },
          { status: 400 },
        )
      : Response.json({ supportedGenerationMethods: ["generateContent"] });
  };
  try {
    assert.deepEqual(await checkAI(), { model: "gemini-3.8-flash" });
    invalid = true;
    await assert.rejects(
      checkAI(),
      (err: Error) =>
        /rejected the Gemini API key/.test(err.message) &&
        !err.message.includes("fixture-key"),
    );
  } finally {
    globalThis.fetch = original;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previousModel;
  }
});
