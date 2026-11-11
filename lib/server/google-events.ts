import { GoogleEvent, googleTimeEditable } from "../google-plan";
import {
  EventTime,
  GoogleEventInfo,
  ImportedEvent,
  googleEventInterval,
} from "../google-event-edit";
import { HttpError } from "./auth";
import {
  GoogleCalendar,
  googleFetch,
  isHolidayCalendar,
  isWritableCalendar,
} from "./google";

type EventRef = { calendarId: string; eventId: string };
type VersionedEvent = EventRef & { etag: string };

const eventPath = ({ calendarId, eventId }: EventRef) =>
  `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;

export function importedGoogleEvent(
  event: GoogleEvent,
  calendar: GoogleCalendar,
): ImportedEvent | null {
  const start = event.start?.dateTime || event.start?.date;
  const end = event.end?.dateTime || event.end?.date;
  if (!event.id || !start || !end || event.status === "cancelled") return null;
  const holiday = isHolidayCalendar(calendar.id);
  const writable = !holiday && isWritableCalendar(calendar) && !!event.etag;
  return {
    id: calendar.id + ":" + event.id,
    googleId: event.id,
    etag: event.etag,
    title:
      event.summary ||
      (holiday
        ? "Holiday"
        : event.transparency === "transparent"
          ? "Google event"
          : "Busy"),
    start,
    end,
    allDay: !!event.start?.date,
    calendarId: calendar.id,
    calendarName: calendar.summaryOverride || calendar.summary,
    updated: event.updated,
    canDelete: writable,
    canEdit: writable && googleTimeEditable(event),
    recurring: !!event.recurringEventId,
    holiday,
    free: holiday || event.transparency === "transparent",
  };
}

async function writableCalendar(
  token: string,
  calendarId: string,
  forbidden: string,
) {
  if (isHolidayCalendar(calendarId)) throw new HttpError(forbidden, 403);
  const access = await googleFetch(
    token,
    "users/me/calendarList/" + encodeURIComponent(calendarId),
  );
  if (access.status === 403 || access.status === 404)
    throw new HttpError(forbidden, 403);
  if (!access.ok)
    throw new HttpError(
      "Could not check your Google Calendar permissions.",
      502,
    );
  const calendar: GoogleCalendar = await access.json();
  if (!isWritableCalendar(calendar)) throw new HttpError(forbidden, 403);
  return { ...calendar, id: calendarId };
}

export async function readGoogleEventInfo(
  token: string,
  ref: EventRef,
): Promise<GoogleEventInfo> {
  const fetched = await googleFetch(token, eventPath(ref));
  if (fetched.status === 404 || fetched.status === 410)
    throw new HttpError(
      "This event is no longer available in Google. Sync to update the planner.",
      404,
    );
  if (fetched.status === 403)
    throw new HttpError(
      "Google did not grant access to this event’s details.",
      403,
    );
  if (!fetched.ok)
    throw new HttpError("Could not read this event from Google.", 502);
  const e: GoogleEvent = await fetched.json();
  if (e.status === "cancelled")
    throw new HttpError(
      "This event was cancelled in Google. Sync to update the planner.",
      404,
    );
  return {
    description: e.description,
    location: e.location,
    organizer: e.organizer,
    attendees: e.attendees,
    attendeesOmitted: e.attendeesOmitted,
    hangoutLink: e.hangoutLink,
    conferenceData: e.conferenceData,
    attachments: e.attachments,
    reminders: e.reminders,
    source: e.source,
    eventType: e.eventType,
    status: e.status,
    visibility: e.visibility,
    created: e.created,
    updated: e.updated,
    htmlLink: e.htmlLink,
    timeZone: e.start?.timeZone,
    workingLocationProperties: e.workingLocationProperties,
  };
}

export async function moveImportedEvent(
  token: string,
  userId: string,
  ref: VersionedEvent,
  time: EventTime,
) {
  const forbidden =
    "Google doesn’t allow Daylight to change this event’s time.";
  const changed = "This event changed in Google. Sync again before moving it.";
  const calendar = await writableCalendar(token, ref.calendarId, forbidden);
  const path = eventPath(ref);
  const fetched = await googleFetch(token, path);
  if (fetched.status === 403) throw new HttpError(forbidden, 403);
  if (fetched.status === 404 || fetched.status === 410)
    throw new HttpError(changed, 409);
  if (!fetched.ok)
    throw new HttpError("Could not read this event from Google.", 502);
  const current: GoogleEvent = await fetched.json();
  if (current.status === "cancelled" || current.etag !== ref.etag)
    throw new HttpError(changed, 409);
  if (current.extendedProperties?.private?.daylightOwner === userId)
    throw new HttpError(
      "Edit the original Daylight record, then sync to update Google.",
      409,
    );
  if (!googleTimeEditable(current)) throw new HttpError(forbidden, 403);
  if (time.allDay !== !!current.start?.date)
    throw new HttpError(
      "An event must keep its all-day or timed format when moved.",
      400,
    );
  let body;
  try {
    body = googleEventInterval(time, current);
  } catch (err) {
    throw new HttpError((err as Error).message, 400);
  }
  const updated = await googleFetch(
    token,
    path + "?supportsAttachments=true&conferenceDataVersion=1",
    {
      method: "PATCH",
      headers: { "If-Match": ref.etag },
      body: JSON.stringify(body),
    },
  );
  if (
    updated.status === 412 ||
    updated.status === 404 ||
    updated.status === 410
  )
    throw new HttpError(changed, 409);
  if (updated.status === 403) throw new HttpError(forbidden, 403);
  if (!updated.ok)
    throw new HttpError(
      "Google could not save this time. Check the dates and try again.",
      502,
    );
  const event = importedGoogleEvent(await updated.json(), calendar);
  if (!event)
    throw new HttpError(
      "Google saved the time but returned no event. Sync to update the planner.",
      502,
    );
  return event;
}

export async function deleteImportedEvent(
  token: string,
  userId: string,
  ref: VersionedEvent,
) {
  const forbidden =
    "You don't have permission to delete events from this Google calendar.";
  const changed =
    "This event changed in Google. Sync again before deleting it.";
  await writableCalendar(token, ref.calendarId, forbidden);
  const path = eventPath(ref);
  const fetched = await googleFetch(token, path);
  if (fetched.status === 404 || fetched.status === 410) return;
  if (fetched.status === 403) throw new HttpError(forbidden, 403);
  if (!fetched.ok)
    throw new HttpError("Could not read this event from Google.", 502);
  const current: GoogleEvent = await fetched.json();
  if (current.status === "cancelled") return;
  if (current.extendedProperties?.private?.daylightOwner === userId)
    throw new HttpError(
      "Remove the original Daylight record, then sync to update Google.",
      409,
    );
  if (current.etag !== ref.etag) throw new HttpError(changed, 409);

  const removed = await googleFetch(token, path, {
    method: "DELETE",
    headers: { "If-Match": ref.etag },
  });
  if (removed.ok || removed.status === 404 || removed.status === 410) return;
  if (removed.status === 412) throw new HttpError(changed, 409);
  if (removed.status === 403) throw new HttpError(forbidden, 403);
  throw new HttpError("Google could not delete this event. Try again.", 502);
}
