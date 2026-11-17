import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, googleOverrides } from "../lib/model";
import { synchronizeWorkspace } from "../lib/server/sync";
import { blocksForDay, scheduledTaskIds } from "../lib/engine";
import { GoogleEvent } from "../lib/google-plan";

const primary = {
  id: "test@example.com",
  summary: "Personal",
  accessRole: "owner",
  primary: true,
};

function fixture() {
  const s = emptyState();
  s.settings.timezone = "America/New_York";
  s.deadlines.push({
    id: "deadline",
    title: "Physics",
    date: "2026-11-13",
    time: null,
    projectId: null,
    status: "active",
    notes: "",
  });
  return s;
}

function fakeGoogle(options: { rejectTitle?: string } = {}) {
  const records = new Map<string, GoogleEvent>();
  const instances: GoogleEvent[] = [];
  const calls: string[] = [];
  let writes = 0;
  const external: GoogleEvent = {
    id: "external",
    summary: "Made in Google",
    start: { dateTime: "2026-11-12T10:00:00-05:00" },
    end: { dateTime: "2026-11-12T11:00:00-05:00" },
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)),
      method = init?.method || "GET",
      id = url.pathname.split("/").at(-1)!;
    calls.push(method + " " + (id === "events" ? "list" : id.slice(0, 8)));
    if (id === "calendarList") return Response.json({ items: [primary] });
    if (id === "events" && method === "GET")
      return Response.json({
        items: [external, ...records.values(), ...instances],
      });
    if (method === "GET")
      return records.has(id)
        ? Response.json(records.get(id))
        : Response.json({}, { status: 404 });
    if (method === "POST") {
      const body = JSON.parse(String(init?.body));
      if (body.summary === options.rejectTitle)
        return Response.json(
          { error: { message: "Invalid recurrence rule." } },
          { status: 400 },
        );
      writes++;
      const event = { ...body, etag: "v" + writes };
      records.set(body.id, event);
      return Response.json(event);
    }
    if (method === "PATCH" || method === "DELETE") {
      const current = records.get(id);
      if (new Headers(init?.headers).get("If-Match") !== current?.etag)
        return Response.json({}, { status: 412 });
      if (method === "DELETE") {
        records.set(id, { id, status: "cancelled" });
        return new Response(null, { status: 204 });
      }
      const patched = {
        ...current,
        ...JSON.parse(String(init?.body)),
        etag: "v" + ++writes,
      };
      records.set(id, patched);
      return Response.json(patched);
    }
    return Response.json({}, { status: 500 });
  };
  return { fetcher, calls, records, instances };
}

test("pull mode only imports and never writes or deletes", async () => {
  const original = globalThis.fetch;
  const google = fakeGoogle();
  globalThis.fetch = google.fetcher;
  try {
    const s = fixture();
    const r = await synchronizeWorkspace(s, "user-1", "token", "pull");
    assert.equal(r.written, 0);
    assert.deepEqual(
      r.events.map((e) => e.title),
      ["Made in Google"],
    );
    assert.ok(google.calls.every((c) => !c.startsWith("POST")));
    assert.equal(google.records.size, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("push mode skips unchanged records and writes only what changed", async () => {
  const original = globalThis.fetch;
  const google = fakeGoogle();
  globalThis.fetch = google.fetcher;
  try {
    const s = fixture();
    const first = await synchronizeWorkspace(s, "user-1", "token", "full");
    assert.equal(first.written, 1);
    s.links = first.links;
    // Nothing changed: no per-event requests at all.
    google.calls.length = 0;
    const idle = await synchronizeWorkspace(s, "user-1", "token", "push");
    assert.equal(idle.written, 0);
    assert.ok(
      google.calls.every((c) => c === "GET calendar" || c === "GET list"),
    );
    // A newly added record is written without re-verifying the old one.
    s.deadlines.push({
      id: "second",
      title: "Chemistry",
      date: "2026-11-14",
      time: null,
      projectId: null,
      status: "active",
      notes: "",
    });
    google.calls.length = 0;
    const next = await synchronizeWorkspace(s, "user-1", "token", "push");
    assert.equal(next.written, 1);
    assert.equal(google.calls.filter((c) => c.startsWith("POST")).length, 1);
    assert.equal(next.links.length, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("Google edits show in the planner and Daylight edits preserve unrelated Google fields", async () => {
  const original = globalThis.fetch;
  const google = fakeGoogle();
  globalThis.fetch = google.fetcher;
  try {
    const s = fixture();
    const first = await synchronizeWorkspace(s, "user-1", "token", "full");
    s.links = first.links;
    const id = first.links[0].eventId;
    const linked = google.records.get(id)!;
    google.records.set(id, {
      ...linked,
      start: { date: "2026-11-15" },
      end: { date: "2026-11-16" },
      location: "Library",
      etag: "changed",
    });
    const changed = await synchronizeWorkspace(s, "user-1", "token", "pull");
    assert.equal(changed.written, 0);
    assert.deepEqual(changed.conflicts, []);
    s.links = changed.links;
    s.events = changed.events;
    assert.ok(googleOverrides(s).has("deadline:deadline"));
    assert.equal(blocksForDay(s, "2026-11-15")[0].title, "Due · Physics");
    assert.equal(s.deadlines[0].date, "2026-11-13");

    s.deadlines[0].title = "Chemistry";
    const merged = await synchronizeWorkspace(s, "user-1", "token", "push");
    assert.equal(merged.written, 1);
    assert.deepEqual(merged.conflicts, []);
    assert.equal(google.records.get(id)?.summary, "Due · Chemistry");
    assert.equal(google.records.get(id)?.start?.date, "2026-11-15");
    assert.equal(google.records.get(id)?.location, "Library");

    s.links = merged.links;
    s.deadlines = [];
    google.records.set(id, { ...google.records.get(id), etag: "edited again" });
    const removed = await synchronizeWorkspace(s, "user-1", "token", "push");
    assert.deepEqual(removed.conflicts, []);
    assert.deepEqual(removed.links, []);
    assert.equal(google.records.get(id)?.status, "cancelled");
    assert.ok(!removed.events.some((event) => event.googleId === id));
  } finally {
    globalThis.fetch = original;
  }
});

test("Google deletion survives reload and repeated sync without losing task evidence", async () => {
  const original = globalThis.fetch;
  const google = fakeGoogle();
  globalThis.fetch = google.fetcher;
  try {
    const s = fixture();
    s.deadlines = [];
    s.tasks.push({
      id: "task",
      title: "Diary Update",
      estimate: null,
      remaining: null,
      deadlineId: null,
      projectId: null,
      milestoneId: null,
      importance: "normal",
      status: "active",
      notes: "",
      createdAt: "",
      completedAt: null,
    });
    s.sessions.push({
      id: "session",
      taskId: "task",
      date: "2026-11-13",
      start: "09:00",
      duration: 30,
      outcome: "partial-high",
      actualMinutes: 25,
      note: "Draft saved",
      needsReview: false,
    });
    const first = await synchronizeWorkspace(s, "user-1", "token", "full");
    s.links = first.links;
    const id = first.links[0].eventId;
    const originalEvent = google.records.get(id)!;
    google.records.set(id, {
      ...originalEvent,
      etag: "moved",
      summary: "Changed in Google",
      start: { dateTime: "2026-11-14T16:00:00Z" },
      end: { dateTime: "2026-11-14T16:45:00Z" },
    });
    const moved = await synchronizeWorkspace(s, "user-1", "token", "pull");
    assert.deepEqual(moved.sessionTimes, [
      { id: "session", date: "2026-11-14", start: "11:00", duration: 45 },
    ]);
    s.links = moved.links;
    s.events = moved.events;
    Object.assign(s.sessions[0], moved.sessionTimes[0]);
    const block = blocksForDay(s, "2026-11-14")[0];
    assert.equal(block.kind, "session");
    assert.equal(block.color, "sage");
    assert.equal(block.outcome, "partial-high");
    assert.equal(block.title, "Diary Update");
    assert.ok(!moved.events.some((event) => event.googleId === id));
    const unchanged = await synchronizeWorkspace(s, "user-1", "token", "full");
    assert.equal(unchanged.written, 0);

    google.records.set(id, { id, status: "cancelled" });

    const removed = await synchronizeWorkspace(s, "user-1", "token", "pull");
    assert.equal(removed.written, 0);
    assert.deepEqual(removed.conflicts, []);
    s.links = JSON.parse(JSON.stringify(removed.links));
    s.events = removed.events;
    assert.equal(s.links[0].deletedInGoogle, true);
    assert.ok(!scheduledTaskIds(s).has("task"));
    assert.ok(!blocksForDay(s, "2026-11-14").some((b) => b.id === "session"));
    assert.equal(s.sessions[0].actualMinutes, 25);

    const repeated = await synchronizeWorkspace(s, "user-1", "token", "full");
    assert.equal(repeated.written, 0);
    assert.deepEqual(repeated.links, s.links);
    assert.deepEqual(repeated.conflicts, []);
    s.sessions[0].start = "10:00";
    const republished = await synchronizeWorkspace(
      s,
      "user-1",
      "token",
      "push",
    );
    assert.equal(republished.written, 1);
    assert.notEqual(republished.links[0].eventId, id);
    assert.equal(republished.links[0].deletedInGoogle, undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test("one event Google rejects is reported without blocking the others", async () => {
  const original = globalThis.fetch;
  const google = fakeGoogle({ rejectTitle: "Due · Physics" });
  globalThis.fetch = google.fetcher;
  try {
    const s = fixture();
    s.deadlines.push({
      id: "ok",
      title: "Chemistry",
      date: "2026-11-14",
      time: null,
      projectId: null,
      status: "active",
      notes: "",
    });
    const r = await synchronizeWorkspace(s, "user-1", "token", "full");
    assert.equal(r.written, 1);
    assert.equal(r.conflicts.length, 1);
    assert.match(
      r.conflicts[0].reason,
      /rejected this event: Invalid recurrence rule/,
    );
    assert.equal(r.links.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("a moved or cancelled Google routine occurrence replaces just that local block", async () => {
  const original = globalThis.fetch;
  const google = fakeGoogle();
  globalThis.fetch = google.fetcher;
  try {
    const s = fixture();
    s.deadlines = [];
    s.routines.push({
      id: "routine",
      title: "Diary Update",
      recurrenceUnit: "days",
      days: [5],
      start: "09:00",
      duration: 30,
      since: "2026-11-13",
      until: null,
      paused: false,
      color: "sage",
    });
    const first = await synchronizeWorkspace(s, "user-1", "token", "full");
    s.links = first.links;
    const recurringEventId = first.links[0].eventId;
    google.instances.push(
      {
        id: "cancelled",
        recurringEventId,
        status: "cancelled",
        originalStartTime: { dateTime: "2026-11-13T14:00:00Z" },
      },
      {
        id: "moved",
        recurringEventId,
        summary: "Diary Update",
        originalStartTime: { dateTime: "2026-11-14T14:00:00Z" },
        start: { dateTime: "2026-11-14T15:00:00Z" },
        end: { dateTime: "2026-11-14T15:30:00Z" },
      },
    );
    const result = await synchronizeWorkspace(s, "user-1", "token", "pull");
    assert.deepEqual(result.conflicts, []);
    s.links = result.links;
    s.events = result.events;
    assert.ok(
      !blocksForDay(s, "2026-11-13").some((b) => b.title === "Diary Update"),
    );
    assert.deepEqual(
      blocksForDay(s, "2026-11-14").map((b) => b.start),
      [600],
    );
    assert.deepEqual(
      blocksForDay(s, "2026-11-15").map((b) => b.start),
      [540],
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("an unscheduled task survives cleanup of a stale link to its deleted Google event", async () => {
  const original = globalThis.fetch;
  const google = fakeGoogle();
  globalThis.fetch = google.fetcher;
  try {
    const s = fixture();
    s.deadlines = [];
    s.tasks.push({
      id: "pset",
      title: "14.7+14.8 PSET",
      estimate: 60,
      remaining: null,
      deadlineId: null,
      projectId: null,
      milestoneId: null,
      importance: "normal",
      status: "active",
      notes: "",
      createdAt: "",
      completedAt: null,
    });
    s.sessions.push({
      id: "booking",
      taskId: "pset",
      date: "2026-11-13",
      start: "09:00",
      duration: 60,
      outcome: "pending",
      actualMinutes: null,
      note: "",
      needsReview: false,
    });
    const scheduled = await synchronizeWorkspace(s, "user-1", "token");
    s.links = scheduled.links;
    s.sessions = [];
    const id = scheduled.links[0].eventId;
    // Both representations are possible for a previously deleted Google event.
    for (const status of ["cancelled", "missing"]) {
      if (status === "cancelled") google.records.set(id, { id, status });
      else google.records.delete(id);
      google.calls.length = 0;
      const sync = await synchronizeWorkspace(s, "user-1", "token", "full");
      assert.deepEqual(sync.conflicts, []);
      assert.deepEqual(sync.links, []);
      assert.ok(google.calls.every((call) => call.startsWith("GET ")));
      assert.equal(s.tasks[0].title, "14.7+14.8 PSET");
      assert.ok(!scheduledTaskIds(s).has("pset"));
    }
  } finally {
    globalThis.fetch = original;
  }
});
