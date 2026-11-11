import test from "node:test";
import assert from "node:assert/strict";
import {
  googleEventInterval,
  timeEditorValues,
} from "../lib/google-event-edit";
import {
  importedGoogleEvent,
  moveImportedEvent,
  readGoogleEventInfo,
} from "../lib/server/google-events";
import type { GoogleEvent } from "../lib/google-plan";

const calendar = {
  id: "private@example.com",
  summary: "Personal",
  accessRole: "owner",
};
const ref = {
  calendarId: calendar.id,
  eventId: "series_20261107T130000Z",
  etag: '"a"',
};
const current: GoogleEvent = {
  id: ref.eventId,
  etag: ref.etag,
  summary: "Project meeting",
  description: "Bring notes",
  location: "Room A",
  organizer: { email: calendar.id, self: true },
  attendees: [{ email: "guest@example.com", responseStatus: "accepted" }],
  hangoutLink: "https://meet.google.com/example",
  attachments: [{ title: "Agenda", fileUrl: "https://example.com/agenda" }],
  reminders: { useDefault: true },
  extendedProperties: { private: { hidden: "not for the browser" } },
  start: {
    dateTime: "2026-11-07T08:00:00-05:00",
    timeZone: "America/New_York",
  },
  end: { dateTime: "2026-11-07T09:30:00-05:00", timeZone: "America/New_York" },
  recurringEventId: "series",
};

test("moving a Google occurrence changes only the interval and respects permissions and the synced version", async () => {
  const original = globalThis.fetch;
  const time = {
    allDay: false as const,
    startDate: "2026-11-08",
    startTime: "23:30",
    endDate: "2026-11-09",
    endTime: "01:00",
    timezone: "America/New_York",
  };
  let fetched = { ...current };
  let role = "owner",
    patchStatus = 200,
    patches = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/calendarList/"))
      return Response.json({ ...calendar, accessRole: role });
    assert.ok(url.pathname.endsWith("/events/" + ref.eventId));
    if (init?.method !== "PATCH") return Response.json(fetched);
    patches++;
    assert.equal(new Headers(init.headers).get("If-Match"), ref.etag);
    assert.equal(url.searchParams.get("supportsAttachments"), "true");
    assert.equal(url.searchParams.get("conferenceDataVersion"), "1");
    const payload = JSON.parse(String(init.body));
    assert.deepEqual(payload, {
      start: {
        dateTime: "2026-11-09T04:30:00.000Z",
        timeZone: "America/New_York",
      },
      end: {
        dateTime: "2026-11-09T06:00:00.000Z",
        timeZone: "America/New_York",
      },
    });
    return Response.json(
      { ...fetched, ...payload, etag: '"b"' },
      { status: patchStatus },
    );
  };
  try {
    const info = await readGoogleEventInfo("token", ref);
    assert.equal(info.description, current.description);
    assert.equal(info.location, current.location);
    assert.deepEqual(info.attendees, current.attendees);
    assert.deepEqual(info.attachments, current.attachments);
    assert.equal(info.hangoutLink, current.hangoutLink);
    assert.ok(!("extendedProperties" in info));

    const move = () => moveImportedEvent("token", "daylight-owner", ref, time);
    role = "reader";
    await assert.rejects(move(), /doesn’t allow/);
    role = "writer";
    fetched = {
      ...current,
      organizer: { self: false },
      guestsCanModify: false,
    };
    await assert.rejects(move(), /doesn’t allow/);
    fetched = { ...current, etag: '"changed"' };
    await assert.rejects(move(), /changed in Google/);
    fetched = {
      ...current,
      extendedProperties: { private: { daylightOwner: "daylight-owner" } },
    };
    await assert.rejects(move(), /original Daylight record/);
    assert.equal(patches, 0);
    fetched = { ...current };
    patchStatus = 412;
    await assert.rejects(move(), /changed in Google/);
    patchStatus = 200;
    const moved = await move();
    assert.equal(moved.etag, '"b"');
    assert.equal(moved.recurring, true);
    assert.equal(moved.canEdit, true);
    assert.equal(moved.start, "2026-11-09T04:30:00.000Z");
    assert.equal(patches, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("dragging preserves event duration; time editing respects exclusive all-day ends and DST", () => {
  const zone = "America/New_York";
  const timed = importedGoogleEvent(current, calendar)!;
  assert.deepEqual(
    timeEditorValues(timed, zone, { date: "2026-11-08", start: "23:30" }),
    {
      allDay: false,
      startDate: "2026-11-08",
      startTime: "23:30",
      endDate: "2026-11-09",
      endTime: "01:00",
      timezone: zone,
    },
  );
  assert.deepEqual(
    timeEditorValues(timed, zone, {
      date: "2026-11-08",
      start: "09:15",
      duration: 45,
    }),
    {
      allDay: false,
      startDate: "2026-11-08",
      startTime: "09:15",
      endDate: "2026-11-08",
      endTime: "10:00",
      timezone: zone,
    },
  );
  const allDay = importedGoogleEvent(
    {
      ...current,
      start: { date: "2026-10-31" },
      end: { date: "2026-11-03" },
    },
    calendar,
  )!;
  const dragged = timeEditorValues(allDay, zone, { date: "2026-11-07" });
  assert.deepEqual(dragged, {
    allDay: true,
    startDate: "2026-11-07",
    endDate: "2026-11-09",
  });
  assert.deepEqual(googleEventInterval(dragged, {}), {
    start: { date: "2026-11-07" },
    end: { date: "2026-11-10" },
  });
  assert.throws(
    () =>
      googleEventInterval(
        {
          allDay: false,
          startDate: "2026-03-08",
          endDate: "2026-03-08",
          startTime: "02:30",
          endTime: "04:00",
          timezone: zone,
        },
        current,
      ),
    /doesn’t exist/,
  );
});
