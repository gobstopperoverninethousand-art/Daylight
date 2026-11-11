import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { seal, unseal } from "../lib/server/crypto";
import { POST as review } from "../app/api/review/route";
import { POST as sync } from "../app/api/google/sync/route";
import {
  DELETE as deleteEvent,
  GET as getEvent,
  PATCH as patchEvent,
} from "../app/api/google/events/route";
import { POST as aiStatus } from "../app/api/ai/status/route";
import { POST as connect } from "../app/api/google/connect/route";
import { POST as project } from "../app/api/projects/propose/route";
import { POST as priorities } from "../app/api/priorities/route";
import { POST as tasks } from "../app/api/projects/tasks/route";
test("integration endpoints reject unauthenticated requests before provider access", async () => {
  for (const route of [
    review,
    sync,
    connect,
    project,
    priorities,
    tasks,
    aiStatus,
  ]) {
    const r = await route(
      new NextRequest("http://localhost:3000/api/test", {
        method: "POST",
        body: "{}",
      }),
    );
    assert.equal(r.status, 401);
    assert.match((await r.json()).error, /Sign in/);
  }
  for (const [method, route] of [
    ["GET", getEvent],
    ["PATCH", patchEvent],
    ["DELETE", deleteEvent],
  ] as const) {
    const result = await route(
      new NextRequest("http://localhost:3000/api/google/events", {
        method,
        ...(method === "GET" ? {} : { body: "{}" }),
      }),
    );
    assert.equal(result.status, 401);
  }
});
test("encrypted credentials authenticate ciphertext and reject tampering", () => {
  const prior = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
  try {
    const input = { refresh_token: "private-test-token" },
      encrypted = seal(input);
    assert.ok(!encrypted.includes("private-test-token"));
    assert.deepEqual(unseal(encrypted), input);
    const bytes = Buffer.from(encrypted, "base64url");
    bytes[30] ^= 1;
    assert.throws(() => unseal(bytes.toString("base64url")));
  } finally {
    if (prior) process.env.TOKEN_ENCRYPTION_KEY = prior;
    else delete process.env.TOKEN_ENCRYPTION_KEY;
  }
});
