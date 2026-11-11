import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyState,
  State,
  Task,
  Session,
  finishTask,
  removeTask,
  stateSchema,
  validateReferences,
  daySchema,
  dayKey,
  addDays,
} from "../lib/model";
import {
  blocksForDay,
  capacity,
  makeSnapshot,
  assess,
  mergedMinutes,
  recommendations,
  taskDue,
  taskDueTime,
  projectHealth,
} from "../lib/engine";
import { evidenceKey, projectDraftKey } from "../lib/ai-freshness";
import {
  outboundEvents,
  eventFingerprint,
  localInstant,
} from "../lib/google-plan";
const day = "2026-11-09",
  now = new Date("2026-11-09T13:00:00Z");
function state(): State {
  const s = emptyState();
  s.settings.timezone = "America/New_York";
  s.settings.workStart = "09:00";
  s.settings.workEnd = "18:00";
  s.settings.workDays = [1, 2, 3, 4, 5];
  s.settings.lastSync = now.toISOString();
  return s;
}

test("untimed routine appears on its day without consuming capacity and syncs as a free all-day recurrence", () => {
  const s = state();
  s.routines.push({
    id: "untimed",
    title: "Read",
    days: [1],
    start: "09:00",
    duration: 30,
    untimed: true,
    since: day,
    until: null,
    paused: false,
    color: "sage",
  });
  const block = blocksForDay(s, day).find(
    (entry) => entry.sourceId === "untimed",
  )!;
  assert.equal(block.allDay, true);
  assert.equal(block.free, true);
  assert.equal(capacity(s, day, day), 9 * 60);
  const event = outboundEvents(s, day).find(
    (entry) => entry.key === "routine:untimed",
  )!.event;
  assert.deepEqual(event.start, { date: day });
  assert.equal(event.transparency, "transparent");
  assert.match(event.recurrence![0], /FREQ=WEEKLY/);
});
function task(id = "task-1", overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: "Physics",
    estimate: 90,
    remaining: 90,
    deadlineId: null,
    projectId: null,
    milestoneId: null,
    importance: "normal",
    status: "active",
    notes: "",
    createdAt: now.toISOString(),
    completedAt: null,
    ...overrides,
  };
}
function session(id = "session-1", overrides: Partial<Session> = {}): Session {
  return {
    id,
    taskId: "task-1",
    date: day,
    start: "10:00",
    duration: 45,
    outcome: "pending",
    actualMinutes: null,
    note: "",
    needsReview: false,
    ...overrides,
  };
}
function deadline(s: State, date = day, time: string | null = null) {
  s.deadlines.push({
    id: "deadline-1",
    title: "Physics due",
    date,
    time,
    projectId: null,
    status: "active",
    notes: "",
  });
  s.tasks.push(task("task-1", { deadlineId: "deadline-1" }));
}

test("saving an AI result leaves its inputs fresh; adding a task or scheduling makes the saved result stale", () => {
  const s = state();
  s.tasks.push(task());
  const key = evidenceKey(s, day, [], day);
  s.aiRuns.push({
    id: "saved-run",
    kind: "priorities",
    createdAt: now.toISOString(),
    version: "fixture",
    inputKey: key,
    snapshot: {},
    output: { summary: "Start with physics", recommendations: [] },
  });
  assert.equal(evidenceKey(s, day, [], day), key);
  s.tasks.push(task("another-task"));
  assert.notEqual(evidenceKey(s, day, [], day), key);
  s.tasks.pop();
  s.sessions.push(session());
  assert.notEqual(evidenceKey(s, day, [], day), key);
  s.sessions.pop();
  assert.equal(evidenceKey(s, day, [], day), key);
  assert.notEqual(evidenceKey(s, day, ["Mixed"], day), key);
});

test("project pacing uses milestone workload and its own budget", () => {
  const s = state();
  const today = dayKey();
  const milestone = {
    id: "m",
    title: "Prototype",
    date: addDays(today, 14),
    approved: true,
    completed: false,
    dependsOn: [],
    estimate: 180,
    timeBudgetMinutes: 120,
    reason: "",
  };
  const p = {
    id: "p",
    title: "Project",
    outcome: "Finished prototype",
    deadline: addDays(today, 28),
    startingPoint: "",
    budgetMinutes: 300,
    availableMinutes: 120,
    notes: "",
    status: "active" as const,
    milestones: [milestone],
  };
  s.projects.push(p);
  s.tasks.push(
    task("no-estimate", {
      estimate: null,
      remaining: null,
      projectId: p.id,
      milestoneId: milestone.id,
    }),
  );
  assert.equal(projectHealth(s, p, today).label, "At risk");
  assert.match(projectHealth(s, p, today).reason, /milestone time budget/);
  milestone.timeBudgetMinutes = 240;
  assert.notEqual(projectHealth(s, p, today).label, "At risk");
  const key = projectDraftKey(s, p.id, "milestones");
  p.milestones.push({ ...milestone, id: "draft", approved: false });
  assert.equal(projectDraftKey(s, p.id, "milestones"), key);
  p.milestones[1].approved = true;
  assert.notEqual(projectDraftKey(s, p.id, "milestones"), key);
});
test("fixed cardio occurs Monday, Wednesday and Thursday at 18:30", () => {
  const s = state();
  s.routines.push({
    id: "r1",
    title: "Cardio",
    days: [1, 3, 4],
    start: "18:30",
    duration: 30,
    since: day,
    until: null,
    paused: false,
    color: "sage",
  });
  for (const d of ["2026-11-09", "2026-11-11", "2026-11-12"]) {
    assert.equal(blocksForDay(s, d)[0]?.start, 1110);
    assert.equal(blocksForDay(s, d)[0]?.duration, 30);
  }
  assert.equal(blocksForDay(s, "2026-11-10").length, 0);
});
test("routine skip and move apply only to one occurrence", () => {
  const s = state();
  s.routines.push({
    id: "r1",
    title: "Routine",
    days: [1, 2],
    start: "10:00",
    duration: 30,
    since: day,
    until: null,
    paused: false,
    color: "sage",
  });
  s.exceptions.push({
    routineId: "r1",
    date: day,
    skip: true,
    start: "10:00",
    duration: 30,
  });
  assert.equal(blocksForDay(s, day).length, 0);
  assert.equal(blocksForDay(s, "2026-11-10").length, 1);
  s.exceptions[0].skip = false;
  s.exceptions[0].start = "12:00";
  assert.equal(blocksForDay(s, day)[0].start, 720);
  assert.equal(blocksForDay(s, "2026-11-10")[0].start, 600);
});
test("a confirmed routine occurrence does not finish the series", () => {
  const s = state();
  s.routines.push({
    id: "r1",
    title: "Routine",
    days: [1, 2],
    start: "10:00",
    duration: 30,
    since: day,
    until: null,
    paused: false,
    color: "sage",
  });
  s.routineRecords.push({
    routineId: "r1",
    date: day,
    outcome: "completed",
    note: "",
  });
  assert.equal(blocksForDay(s, day)[0].outcome, "completed");
  assert.equal(blocksForDay(s, "2026-11-10")[0].outcome, "pending");
});
test("deadline stays a marker separate from scheduled sessions", () => {
  const s = state();
  deadline(s);
  s.sessions.push(session());
  assert.equal(blocksForDay(s, day).length, 1);
  const events = outboundEvents(s);
  assert.equal(events.length, 2);
  assert.equal(
    events.find((e) => e.key.startsWith("deadline"))?.event.transparency,
    "transparent",
  );
  assert.equal(
    events.find((e) => e.key.startsWith("deadline"))?.event.start?.date,
    day,
  );
});
test("independent sessions remain independent and finishing task preserves history", () => {
  const s = state();
  s.tasks.push(task());
  s.sessions.push(
    session("a", { outcome: "partial-medium" }),
    session("b", { date: "2026-11-10" }),
  );
  assert.equal(s.sessions[1].outcome, "pending");
  finishTask(s, "task-1");
  assert.equal(s.tasks[0].status, "completed");
  assert.equal(s.sessions[0].outcome, "partial-medium");
  assert.equal(s.sessions[1].outcome, "pending");
  assert.equal(s.sessions[1].needsReview, true);
  assert.equal(recommendations(s, day, now).length, 0);
  finishTask(s, "task-1", false);
  assert.equal(s.sessions[1].needsReview, false);
});

test("deleting a task removes its scheduled sessions and leaves no orphan references", () => {
  const s = emptyState();
  s.tasks.push({
    id: "task-1",
    title: "Remove me",
    estimate: 30,
    remaining: 30,
    deadlineId: null,
    projectId: null,
    milestoneId: null,
    importance: "normal",
    status: "active",
    notes: "",
    createdAt: new Date().toISOString(),
    completedAt: null,
  });
  s.sessions.push({
    id: "session-1",
    taskId: "task-1",
    date: "2026-11-10",
    start: "09:00",
    duration: 30,
    outcome: "pending",
    actualMinutes: null,
    note: "",
    needsReview: false,
  });
  assert.equal(removeTask(s, "task-1"), true);
  assert.equal(s.tasks.length, 0);
  assert.equal(s.sessions.length, 0);
  assert.equal(removeTask(s, "missing"), false);
  assert.doesNotThrow(() => validateReferences(s));
});
test("elapsed unconfirmed time is never actual work evidence", () => {
  const s = state();
  s.tasks.push(task());
  s.sessions.push(session("a", { duration: 120, actualMinutes: 120 }));
  const snapshot = makeSnapshot(s, day, "", "", "", now);
  assert.equal(snapshot.planned_minutes, 120);
  assert.equal(snapshot.confirmed_actual_minutes, 0);
  assert.equal(snapshot.confirmed_sessions, 0);
  assert.match(
    assess(snapshot).time_use_observation,
    /Actual work time is not known/,
  );
});
test("completed session without actual time does not invent duration", () => {
  const s = state();
  s.tasks.push(task());
  s.sessions.push(session("a", { duration: 120, outcome: "completed" }));
  const snapshot = makeSnapshot(s, day, "Focused", "", "", now);
  assert.equal(snapshot.confirmed_sessions, 1);
  assert.equal(snapshot.confirmed_actual_minutes, 0);
  assert.match(assess(snapshot).focus_observation, /Self-reported/);
  assert.equal(s.tasks[0].status, "active");
});
test("a reported zero is distinguished from unknown actual time", () => {
  const s = state();
  s.tasks.push(task());
  s.sessions.push(session("a", { outcome: "skipped", actualMinutes: 0 }));
  assert.match(
    assess(makeSnapshot(s, day, "", "", "", now)).time_use_observation,
    /0 min of actual time was self-reported/,
  );
});
test("overlapping calendar commitments are counted once", () => {
  assert.equal(
    mergedMinutes([
      [60, 180],
      [120, 240],
      [300, 330],
    ]),
    210,
  );
  const s = state();
  s.tasks.push(task());
  s.sessions.push(
    session("a", { start: "09:00", duration: 120 }),
    session("b", { start: "10:00", duration: 120 }),
  );
  assert.equal(capacity(s, day, day), 360);
});
test("remaining capacity excludes elapsed time and respects the due time", () => {
  const s = state();
  deadline(s, day, "17:00");
  const late = new Date("2026-11-09T20:00:00Z");
  assert.equal(
    capacity(s, day, day, "task-1", late, taskDueTime(s, s.tasks[0])),
    120,
  );
  assert.equal(
    capacity(s, day, day, undefined, new Date("2026-11-10T20:00:00Z")),
    0,
  );
});
test("known 8h workload against 3h capacity flags a shortfall", () => {
  const s = state();
  deadline(s);
  s.settings.workEnd = "12:00";
  s.tasks[0].estimate = 480;
  s.tasks[0].remaining = 480;
  const report = assess(makeSnapshot(s, day, "", "", "", now));
  assert.equal(report.pacing_status, "at-risk");
  assert.ok(report.evidence.some((e) => e.includes("8h") && e.includes("3h")));
  assert.ok(!JSON.stringify(report).includes("productivity score"));
});
test("combined deadlines cannot each claim the same capacity", () => {
  const s = state();
  deadline(s);
  s.settings.workEnd = "12:00";
  s.tasks[0].remaining = 120;
  s.tasks.push(task("task-2", { remaining: 120, deadlineId: "deadline-1" }));
  const snapshot = makeSnapshot(s, day, "", "", "", now);
  assert.ok(
    snapshot.tasks.every((t) => t.remaining_minutes! <= t.available_minutes),
  );
  assert.equal(assess(snapshot).pacing_status, "at-risk");
});
test("own task sessions count as available without double counting a conflicting commitment", () => {
  const s = state();
  s.tasks.push(task());
  s.sessions.push(session("a", { start: "09:00", duration: 120 }));
  s.routines.push({
    id: "r1",
    title: "Fixed",
    days: [1],
    start: "10:00",
    duration: 60,
    since: day,
    until: null,
    paused: false,
    color: "sage",
  });
  assert.equal(capacity(s, day, day, ["task-1"]), 480);
});
test("missing estimates or stale calendar cannot produce unqualified on-track", () => {
  const s = state();
  deadline(s);
  s.tasks[0].remaining = null;
  s.tasks[0].estimate = null;
  assert.equal(
    assess(makeSnapshot(s, day, "", "", "", now)).pacing_status,
    "insufficient-information",
  );
  s.tasks[0].estimate = 30;
  s.settings.lastSync = "2026-11-01T12:00:00Z";
  assert.equal(
    assess(makeSnapshot(s, day, "", "", "", now)).pacing_status,
    "insufficient-information",
  );
});
test("blocked work asks a short question only if the blocker is missing", () => {
  const s = state();
  s.tasks.push(task());
  s.sessions.push(session("a", { outcome: "blocked" }));
  assert.deepEqual(
    assess(makeSnapshot(s, day, "", "", "", now)).questions_if_needed,
    ["Main blocker?"],
  );
  s.sessions[0].note = "Waiting for a replacement sensor";
  assert.deepEqual(
    assess(makeSnapshot(s, day, "", "", "", now)).questions_if_needed,
    [],
  );
});
test("draft milestone date is not treated as an approved deadline", () => {
  const s = state();
  s.projects.push({
    id: "p",
    title: "Robot",
    outcome: "Working robot",
    deadline: "2026-12-15",
    startingPoint: "",
    budgetMinutes: 600,
    availableMinutes: null,
    notes: "",
    status: "active",
    milestones: [
      {
        id: "m",
        title: "PCB",
        date: day,
        approved: false,
        completed: false,
        dependsOn: [],
        estimate: null,
        reason: "",
      },
    ],
  });
  const t = task("t", { projectId: "p", milestoneId: "m" });
  s.tasks.push(t);
  assert.equal(taskDue(s, t), "2026-12-15");
  s.projects[0].milestones[0].approved = true;
  assert.equal(taskDue(s, t), day);
});
test("Google recurrence uses one RRULE rather than thousands of events", () => {
  const s = state();
  s.routines.push({
    id: "r1",
    title: "Cardio",
    days: [1, 3, 4],
    start: "18:30",
    duration: 30,
    since: day,
    until: null,
    paused: false,
    color: "sage",
  });
  const out = outboundEvents(s);
  assert.equal(out.length, 1);
  assert.ok(out[0].event.recurrence?.[0].includes("BYDAY=MO,WE,TH"));
  assert.equal(out[0].event.start?.timeZone, "America/New_York");
});
test("Google exceptions use EXDATE plus only the moved occurrence", () => {
  const s = state();
  s.routines.push({
    id: "r1",
    title: "Cardio",
    days: [1, 3, 4],
    start: "18:30",
    duration: 30,
    since: day,
    until: null,
    paused: false,
    color: "sage",
  });
  s.exceptions.push({
    routineId: "r1",
    date: day,
    skip: false,
    start: "19:00",
    duration: 30,
  });
  const out = outboundEvents(s);
  assert.equal(out.length, 2);
  assert.ok(out[0].event.recurrence?.[1].startsWith("EXDATE"));
  assert.equal(out[1].key, "exception:r1:" + day);
});
test("timezones honor daylight saving in routine times", () => {
  assert.equal(
    localInstant("2026-07-01", "18:30", "America/New_York"),
    "2026-07-01T22:30:00.000Z",
  );
  assert.equal(
    localInstant("2026-12-01", "18:30", "America/New_York"),
    "2026-12-01T23:30:00.000Z",
  );
});
test("Google offset normalization does not create false conflicts", () => {
  const one = {
    summary: "Task",
    start: {
      dateTime: "2026-11-09T10:00:00-05:00",
      timeZone: "America/New_York",
    },
    end: {
      dateTime: "2026-11-09T11:00:00-05:00",
      timeZone: "America/New_York",
    },
  };
  const two = {
    ...one,
    start: { ...one.start, dateTime: "2026-11-09T15:00:00.000Z" },
    end: { ...one.end, dateTime: "2026-11-09T16:00:00.000Z" },
  };
  assert.equal(eventFingerprint(one), eventFingerprint(two));
});

test("Google recurrence normalization ignores equivalent rule and exception formatting", () => {
  const one = {
    summary: "Band dance",
    start: {
      dateTime: "2026-11-10T14:00:00.000Z",
      timeZone: "America/New_York",
    },
    end: { dateTime: "2026-11-10T15:00:00.000Z", timeZone: "America/New_York" },
    recurrence: [
      "RRULE:FREQ=WEEKLY;BYDAY=TU,MO;INTERVAL=1",
      "EXDATE;TZID=America/New_York:20261112T090000",
    ],
  };
  const two = {
    ...one,
    recurrence: [
      "EXDATE:20261112T140000Z",
      "RRULE:INTERVAL=1;FREQ=WEEKLY;BYDAY=MO,TU",
    ],
  };
  assert.equal(eventFingerprint(one), eventFingerprint(two));
});
test("resolved deadline markers remain in Google export", () => {
  const s = state();
  deadline(s);
  s.deadlines[0].status = "resolved";
  const out = outboundEvents(s);
  assert.equal(out.length, 1);
  assert.match(out[0].event.summary!, /^✓/);
});
test("all-day commitments use exclusive end dates and block availability", () => {
  const s = state();
  s.events.push({
    id: "e",
    title: "Away",
    start: day,
    end: "2026-11-10",
    allDay: true,
    calendarId: "primary",
  });
  assert.equal(capacity(s, day, day), 0);
  assert.equal(blocksForDay(s, "2026-11-10").length, 0);
});
test("cross-midnight external events are clipped per local date", () => {
  const s = state();
  s.events.push({
    id: "e",
    title: "Travel",
    start: "2026-11-10T04:00:00Z",
    end: "2026-11-10T07:00:00Z",
    allDay: false,
    calendarId: "primary",
  });
  assert.equal(blocksForDay(s, day)[0].duration, 60);
  assert.equal(blocksForDay(s, "2026-11-10")[0].duration, 120);
});
test("backup validation rejects orphan sessions, duplicate IDs and impossible dates", () => {
  const s = state();
  s.sessions.push(session());
  assert.throws(() => validateReferences(s), /missing task/);
  assert.equal(daySchema.safeParse("2026-02-30").success, false);
  const good = state();
  good.tasks.push(task(), task());
  assert.throws(() => validateReferences(good), /Duplicate/);
});
test("milestone dependency cycles are rejected", () => {
  const s = state();
  s.projects.push({
    id: "p",
    title: "P",
    outcome: "Done",
    deadline: "2026-12-01",
    startingPoint: "",
    budgetMinutes: null,
    availableMinutes: null,
    notes: "",
    status: "active",
    milestones: ["a", "b"].map((id, i) => ({
      id,
      title: id,
      date: day,
      approved: true,
      completed: false,
      dependsOn: [i ? "a" : "b"],
      estimate: null,
      reason: "",
    })),
  });
  assert.throws(() => validateReferences(s), /cycle/);
});
test("sessions cannot spill into the next day without a separate booking", () => {
  const s = state();
  s.tasks.push(task());
  s.sessions.push(session("a", { start: "23:30", duration: 60 }));
  assert.equal(stateSchema.safeParse(s).success, false);
});
