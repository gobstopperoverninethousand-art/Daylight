import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { emptyState, addDays, dayKey } from "../lib/model";
import { POST as propose } from "../app/api/projects/propose/route";
import { POST as tasks } from "../app/api/projects/tasks/route";

test("project proposals connect generations and tasks use the selected milestone", async () => {
  const originalFetch = globalThis.fetch;
  const names = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "GEMINI_API_KEY",
  ];
  const old = names.map((name) => process.env[name]);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture";
  process.env.GEMINI_API_KEY = "fixture";
  const state = emptyState();
  const today = dayKey();
  const milestone = (id: string, offset: number) => ({
    id,
    title: id,
    date: addDays(today, offset),
    approved: true,
    completed: false,
    dependsOn: [] as string[],
    estimate: null,
    reason: "",
  });
  state.projects.push({
    id: "project",
    title: "Test",
    outcome: "Ship",
    startingPoint: "",
    notes: "",
    status: "active",
    deadline: addDays(today, 30),
    milestones: [milestone("first", 5), milestone("last", 20)],
  });
  let output: unknown = {
    summary: "Add an intermediate step",
    assumptions: [],
    milestones: [
      {
        title: "Middle",
        date: addDays(today, 10),
        dependsOn: ["first"],
        reason: "Build on the first step",
      },
    ],
    existingDependencyUpdates: [{ milestoneId: "last", dependsOn: ["new:0"] }],
  };
  let sent: any;
  let generations = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/auth/v1/user"))
      return Response.json({
        id: "user",
        aud: "authenticated",
        role: "authenticated",
      });
    if (String(url).includes("/rpc/")) return Response.json(true);
    generations++;
    sent = JSON.parse(String(init?.body));
    return Response.json({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: JSON.stringify(output) }] },
        },
      ],
    });
  };
  const request = (extra = {}) =>
    new NextRequest("http://localhost/api/test", {
      method: "POST",
      headers: { authorization: "Bearer fixture" },
      body: JSON.stringify({ state, projectId: "project", ...extra }),
    });
  try {
    const response = await propose(request());
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.milestones[0].dependsOn, ["first"]);
    assert.deepEqual(result.dependencyUpdates[0].dependsOn, [
      result.milestones[0].id,
    ]);
    output = {
      summary: "Invalid cycle",
      assumptions: [],
      milestones: [
        {
          title: "Loop",
          date: addDays(today, 5),
          dependsOn: ["first"],
          reason: "",
        },
      ],
      existingDependencyUpdates: [
        { milestoneId: "first", dependsOn: ["new:0"] },
      ],
    };
    assert.notEqual((await propose(request())).status, 200);
    output = { tasks: [{ title: "Chosen milestone task", notes: "" }] };
    const taskResponse = await tasks(request({ milestoneId: "last" }));
    assert.equal(taskResponse.status, 200);
    assert.equal((await taskResponse.json()).milestoneId, "last");
    const input = JSON.parse(sent.contents[0].parts[0].text.slice(6));
    assert.equal(input.milestone.id, "last");
    const before = generations;
    assert.notEqual(
      (await tasks(request({ milestoneId: "missing" }))).status,
      200,
    );
    assert.equal(generations, before);
    assert.equal(state.projects[0].milestones.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    names.forEach((name, index) => {
      if (old[index] === undefined) delete process.env[name];
      else process.env[name] = old[index];
    });
  }
});
