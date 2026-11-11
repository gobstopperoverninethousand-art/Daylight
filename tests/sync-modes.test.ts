import test from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../lib/model";
import { synchronizeWorkspace } from "../lib/server/sync";
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
  const calls: string[] = [];
  let writes = 0;
  const external = {
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
      return Response.json({ items: [external] });
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
    return Response.json({}, { status: 500 });
  };
  return { fetcher, calls, records };
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

test("pull mode reports Daylight-owned events deleted or changed in Google", async () => {
  const original = globalThis.fetch;
  const google = fakeGoogle();
  globalThis.fetch = google.fetcher;
  try {
    const s = fixture();
    const first = await synchronizeWorkspace(s, "user-1", "token", "full");
    s.links = first.links;
    const linked = google.records.get(first.links[0].eventId)!;
    google.records.set(first.links[0].eventId, {
      ...linked,
      summary: "Changed in Google",
      etag: "changed",
    });
    const changed = await synchronizeWorkspace(s, "user-1", "token", "pull");
    assert.equal(changed.written, 0);
    assert.match(changed.conflicts[0].reason, /Changed in Google/);

    google.records.delete(first.links[0].eventId);
    const removed = await synchronizeWorkspace(s, "user-1", "token", "pull");
    assert.equal(removed.written, 0);
    assert.equal(removed.conflicts.length, 0);
    assert.equal(removed.links.length, 0);
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
