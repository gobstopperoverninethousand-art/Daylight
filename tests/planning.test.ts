import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "../app/api/priorities/route";
import { emptyState, addDays, type State, type Task } from "../lib/model";
import {
  evidenceKey,
  workspaceDay,
  priorityResultSchema,
} from "../lib/ai-freshness";
import { planningContext } from "../lib/planning-context";

function fixture() {
  const state = emptyState();
  state.settings.timezone = "America/New_York";
  state.settings.lastSync = new Date().toISOString();
  const day = workspaceDay(state);
  state.deadlines.push({
    id: "boards",
    title: "Prototype boards",
    date: addDays(day, 4),
    time: null,
    projectId: null,
    status: "active",
    workMode: "multiple",
    remainingMinutes: 240,
    notes: "PCB #2 is unstarted.",
  });
  const task: Task = {
    id: "pcb-1",
    title: "Design PCB #1",
    deadlineId: "boards",
    projectId: null,
    milestoneId: null,
    importance: "high",
    includeDate: day,
    status: "active",
    estimate: 120,
    remaining: 120,
    notes: "Design PCB #1 today.",
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  state.tasks.push(task, {
    ...task,
    id: "reading",
    title: "Read chapter",
    deadlineId: null,
    includeDate: null,
    estimate: null,
    remaining: null,
    notes: "Important background reading.",
  });
  state.sessions.push({
    id: "old",
    taskId: "reading",
    date: addDays(day, -2),
    start: "10:00",
    duration: 30,
    outcome: "partial-low",
    actualMinutes: 15,
    note: "Still have two sections to read.",
    needsReview: false,
  });
  state.routines.push({
    id: "practice",
    title: "Band practice",
    days: [0, 1, 2, 3, 4, 5, 6],
    start: "18:30",
    duration: 180,
    since: day,
    until: null,
    paused: false,
    color: "sage",
  });
  return state;
}

function saveMain(state: State, result: any) {
  state.tasks.push(...result.generatedTasks);
  state.aiRuns.push({
    id: "main",
    kind: "priorities",
    createdAt: new Date().toISOString(),
    version: result.version,
    inputKey: evidenceKey(state, workspaceDay(state)),
    snapshot: result.snapshot,
    output: priorityResultSchema.parse(result),
  });
}

test("planning requests preserve older evidence, validate recorded aspects, and separate optional work", async () => {
  const keys = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
  ];
  const previous = keys.map((key) => process.env[key]);
  const fetch = globalThis.fetch;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture";
  process.env.GEMINI_API_KEY = "fixture";
  process.env.GEMINI_MODEL = "gemini-3.8-flash";
  let sent: any;
  let output: any;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/auth/v1/user"))
      return Response.json({
        id: "user",
        aud: "authenticated",
        role: "authenticated",
      });
    if (String(url).includes("/rpc/")) return Response.json(true);
    assert.match(String(url), /:generateContent$/);
    calls++;
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
  const request = async (state: State, mode = "main") => {
    const response = await POST(
      new NextRequest("http://localhost/api/priorities", {
        method: "POST",
        headers: { authorization: "Bearer fixture" },
        body: JSON.stringify({ state, mode }),
      }),
    );
    return { status: response.status, body: await response.json() };
  };
  try {
    const state = fixture();
    output = {
      taskIds: ["pcb-1"],
      summary:
        "Included your selected tasks: Design PCB #1.\n\nLeft out today: further board work can wait.",
      decisionMemory: [
        {
          commitment: "deadline:boards",
          rationale:
            "Advance PCB #1 before tomorrow's band practice; verify reported progress later.",
        },
      ],
    };
    const main = await request(state);
    assert.equal(main.status, 200);
    assert.equal(main.body.aiError, undefined);
    const input = JSON.parse(sent.contents[0].parts[0].text.slice(6));
    assert.equal(
      input.task_history.find((task: any) => task.id === "reading").sessions[0]
        .note,
      "Still have two sections to read.",
    );
    assert(
      input.upcoming_commitments.some(
        (block: any) => block.title === "Band practice",
      ),
    );
    assert.match(
      sent.systemInstruction.parts[0].text,
      /Daylight main to-do list/,
    );
    assert.match(
      sent.systemInstruction.parts[0].text,
      /effort estimates, measured pace/,
    );
    output = {
      taskIds: ["pcb-1"], summary: "Keep the manual task once.",
      recordedWork: [
        { sourceTaskId: "pcb-1", title: "Design PCB #1", evidenceQuote: "Repeated selected work." },
        { sourceTaskId: "pcb-1", title: "PCB #2", evidenceQuote: "PCB #2 is unstarted." },
        { sourceTaskId: "pcb-1", title: "PCB #2", evidenceQuote: "Repeated new aspect." },
      ],
    };
    const repeated = await request(state);
    assert.equal(repeated.body.aiError, undefined);
    assert.equal(repeated.body.recommendations.filter((item: any) => item.taskId === "pcb-1").length, 1);
    assert.equal(repeated.body.generatedTasks.length, 1);
    assert.equal(repeated.body.generatedTasks[0].title, "PCB #2");
    assert.equal(state.tasks[0].estimate, 120);
    saveMain(state, main.body);
    const before = JSON.stringify(state);
    output = {
      taskIds: [],
      summary:
        "For any additional time, I recommend PCB #2 to discover difficulties early.",
      recordedWork: [
        {
          sourceTaskId: "pcb-1",
          title: "PCB #2",
          evidenceQuote: "PCB #2 is unstarted.",
        },
      ],
    };
    const extras = await request(state, "extras");
    assert.equal(extras.status, 200, JSON.stringify(extras.body));
    assert.equal(extras.body.aiError, undefined);
    assert.equal(extras.body.generatedTasks[0].title, "PCB #2");
    assert.equal(extras.body.generatedTasks[0].remaining, null);
    assert.equal(extras.body.generatedTasks[0].deadlineId, "boards");
    assert.equal(JSON.stringify(state), before);
    assert.match(
      sent.systemInstruction.parts[0].text,
      /Daylight extra-time recommendations/,
    );
    const extraInput = JSON.parse(sent.contents[0].parts[0].text.slice(6));
    assert(!extraInput.eligible_tasks.some((task: any) => task.id === "pcb-1"));
    assert.equal(extraInput.current_main_list.tasks[0].id, "pcb-1");
    assert.equal(extraInput.prior_decisions[0].commitment, "deadline:boards");
    assert.deepEqual(extraInput.included_for_consideration_task_ids, []);
    assert.equal(extraInput.mainRunId, "main");
    output = { taskIds: ["pcb-1"], summary: "Invalid duplicate of main list" };
    assert((await request(state, "extras")).body.aiError);
    output = {
      taskIds: [],
      summary: "Invalid invented aspect",
      recordedWork: [
        {
          sourceTaskId: "unknown-source",
          title: "PCB #3",
          evidenceQuote: "PCB #3 is unstarted.",
        },
      ],
    };
    assert((await request(state, "extras")).body.aiError);
    output = { taskIds: [], summary: "Invalid omission of the user's choice" };
    assert((await request(state)).body.aiError);
    const callsBefore = calls;
    state.tasks[0].notes = "The plan changed.";
    assert.equal((await request(state, "extras")).status, 409);
    assert.equal(calls, callsBefore);
    const today = workspaceDay(state);
    state.deadlines.push({ ...state.deadlines[0], id: "practice-log", title: "Practice Log", date: today });
    state.tasks.push({ ...state.tasks[0], id: "carried", title: "Carry over work", includeDate: null, aiTodoDate: addDays(today, -3) });
    output = { taskIds: ["pcb-1", "carried"], summary: "I selected an invented task." };
    const refreshed = (await request(state)).body;
    assert.equal(refreshed.aiError, undefined);
    assert.ok(refreshed.recommendations.some((entry: { taskId: string }) => entry.taskId === "carried"));
    assert.equal(refreshed.generatedTasks[0].title, "Practice Log");
    assert.match(refreshed.summary, /Due today: Practice Log/);
    assert.doesNotMatch(refreshed.summary, /invented task/);
  } finally {
    globalThis.fetch = fetch;
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});

test("freshness tracks edits to existing progress reports and named calendar constraints", () => {
  const state = fixture();
  const key = evidenceKey(state, workspaceDay(state));
  state.sessions[0].note = "Finished those sections.";
  assert.notEqual(evidenceKey(state, workspaceDay(state)), key);
  const context = planningContext(state, state.tasks);
  assert.equal(
    context.task_history.find((task) => task.id === "reading")?.sessions[0]
      .note,
    "Finished those sections.",
  );
  state.events.push({
    id: "event",
    title: "Appointment",
    start: new Date().toISOString(),
    end: new Date(Date.now() + 3600000).toISOString(),
    allDay: false,
    calendarId: "primary",
  });
  const eventKey = evidenceKey(state, workspaceDay(state));
  state.events[0].title = "Exam";
  assert.notEqual(evidenceKey(state, workspaceDay(state)), eventKey);
});
