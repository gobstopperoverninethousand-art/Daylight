import { createHash } from "node:crypto";
import { State, dayKey, addDays } from "../model";
import {
  outboundEvents,
  eventFingerprint,
  GoogleEvent,
  localInstant,
} from "../google-plan";
import { zonedParts } from "../engine";
import { HttpError } from "./auth";
import { importedGoogleEvent } from "./google-events";
import {
  googleCalendars,
  googleFetch,
  googleJson,
  isHolidayCalendar,
  isWritableCalendar,
} from "./google";
// full: verify every linked event. push: write only records changed since the
// last sync, then import. pull: import only (cheap enough to run every minute).
export type SyncMode = "full" | "push" | "pull";
export async function synchronizeWorkspace(
  state: State,
  userId: string,
  token: string,
  mode: SyncMode = "full",
) {
  const calendarId = state.settings.calendarId,
    base = `calendars/${encodeURIComponent(calendarId)}/events`;
  const calendars = await googleCalendars(token);
  const target = calendars.find((c) =>
    calendarId === "primary" ? c.primary : c.id === calendarId,
  );
  if (!target || !isWritableCalendar(target) || isHolidayCalendar(target.id))
    throw new HttpError(
      "Choose a writable Google calendar in Settings before syncing.",
      403,
    );
  const desired = outboundEvents(state),
    links = [...state.links],
    conflicts: {
      key: string;
      title: string;
      reason: string;
      url?: string;
    }[] = [];
  const old = state.links.filter((l) => l.calendarId === calendarId);
  let written = 0;
  const pushing = mode !== "pull";
  if (pushing && desired.length > 500)
    throw new HttpError(
      "This manual sync supports up to 500 Daylight records. Archive/export older records before synchronizing larger workspaces.",
      400,
    );
  // Stable Google event IDs make retries safe even if a response or local save is interrupted.
  for (const { key, event } of pushing ? desired : []) {
    const eventId = createHash("sha256")
      .update(userId + ":" + calendarId + ":" + key)
      .digest("hex");
    const link = old.find((l) => l.key === key);
    const fingerprint = eventFingerprint(event);
    if (mode === "push" && link && link.fingerprint === fingerprint) continue;
    const path = base + "/" + encodeURIComponent(link?.eventId || eventId);
    let current: GoogleEvent | null = null;
    const fetched = await googleFetch(token, path);
    if (fetched.ok) current = await fetched.json();
    else if (fetched.status !== 404 && fetched.status !== 410)
      throw new HttpError(
        `Could not read Google events (${fetched.status}). Retry synchronization.`,
        502,
      );
    if (
      current &&
      (current.extendedProperties?.private?.daylightOwner !== userId ||
        current.extendedProperties?.private?.daylightKey !== key)
    ) {
      conflicts.push({
        key,
        title: event.summary || key,
        reason: "Event ownership could not be verified.",
      });
      continue;
    }
    if (current?.status === "cancelled" || (!current && link)) {
      // A Daylight-created event can be removed from Google directly. Keep
      // the local task/session, but drop the link so the event is not recreated
      // on every subsequent sync.
      const removedIndex = links.findIndex(
        (l) => l.key === key && l.calendarId === calendarId,
      );
      if (removedIndex >= 0) links.splice(removedIndex, 1);
      continue;
    }
    if (
      current &&
      (!link || current.etag !== link.etag) &&
      eventFingerprint(current) !== fingerprint
    ) {
      conflicts.push({
        key,
        title: event.summary || key,
        reason: "Changed in Google Calendar. Daylight preserved both versions.",
        url: current.htmlLink,
      });
      continue;
    }
    let saved = current;
    if (!current || eventFingerprint(current) !== fingerprint) {
      const payload = {
        ...event,
        extendedProperties: {
          private: { daylightOwner: userId, daylightKey: key },
        },
      };
      const res = await googleFetch(token, current ? path : base, {
        method: current ? "PATCH" : "POST",
        headers: current?.etag ? { "If-Match": current.etag } : {},
        body: JSON.stringify(current ? payload : { id: eventId, ...payload }),
      });
      if (res.status === 409 || res.status === 412) {
        conflicts.push({
          key,
          title: event.summary || key,
          reason:
            "A concurrent change was detected. Retry after reviewing Google Calendar.",
        });
        continue;
      }
      if (res.status === 400) {
        const detail = (await res.json().catch(() => null))?.error?.message;
        conflicts.push({
          key,
          title: event.summary || key,
          reason:
            "Google rejected this event" +
            (detail ? ": " + String(detail).slice(0, 160) : " (400)") +
            ". Everything else still synchronized.",
        });
        continue;
      }
      if (!res.ok)
        throw new HttpError(
          `Google could not save an event (${res.status}). Some earlier events may have synchronized; retry is safe.`,
          502,
        );
      saved = await res.json();
      written++;
    }
    const next = {
      key,
      eventId: saved!.id!,
      etag: saved!.etag!,
      fingerprint,
      calendarId,
    };
    const idx = links.findIndex(
      (l) => l.key === key && l.calendarId === calendarId,
    );
    if (idx >= 0) links[idx] = next;
    else links.push(next);
  }
  // Only explicitly removed Daylight records with an owned, unchanged linked event may be deleted.
  for (const link of pushing
    ? old.filter((l) => !desired.some((d) => d.key === l.key))
    : []) {
    const path = base + "/" + encodeURIComponent(link.eventId);
    const r = await googleFetch(token, path);
    if (r.status === 404 || r.status === 410) {
      links.splice(
        links.findIndex((l) => l === link),
        1,
      );
      continue;
    }
    if (!r.ok)
      throw new HttpError("Could not verify an event before removal.", 502);
    const event: GoogleEvent = await r.json();
    if (
      event.extendedProperties?.private?.daylightOwner !== userId ||
      event.extendedProperties?.private?.daylightKey !== link.key ||
      event.etag !== link.etag
    ) {
      conflicts.push({
        key: link.key,
        title: event.summary || "Removed record",
        reason: "Google changed this event. It was preserved.",
        url: event.htmlLink,
      });
      continue;
    }
    const removed = await googleFetch(token, path, {
      method: "DELETE",
      headers: { "If-Match": link.etag },
    });
    if (!removed.ok && removed.status !== 404 && removed.status !== 410) {
      conflicts.push({
        key: link.key,
        title: event.summary || "Removed record",
        reason: "Removal could not be completed.",
      });
      continue;
    }
    const index = links.findIndex(
      (l) => l.key === link.key && l.calendarId === calendarId,
    );
    if (index >= 0) links.splice(index, 1);
    written++;
  }
  // Background pulls do not write, but they still verify Daylight-owned links.
  // Without this check, a linked event deleted or edited in Google is invisible
  // until the user happens to run a full sync.
  if (mode === "pull") {
    const desiredByKey = new Map(desired.map(({ key, event }) => [key, event]));
    for (const link of old) {
      const path = base + "/" + encodeURIComponent(link.eventId);
      const checked = await googleFetch(token, path);
      if (checked.status === 404 || checked.status === 410) {
        const removedIndex = links.findIndex((l) => l === link);
        if (removedIndex >= 0) links.splice(removedIndex, 1);
        continue;
      }
      if (!checked.ok)
        throw new HttpError("Could not verify linked calendar events.", 502);
      const current: GoogleEvent = await checked.json();
      if (current.status === "cancelled") {
        const removedIndex = links.findIndex((l) => l === link);
        if (removedIndex >= 0) links.splice(removedIndex, 1);
        continue;
      }
      if (
        current.extendedProperties?.private?.daylightOwner !== userId ||
        current.extendedProperties?.private?.daylightKey !== link.key
      ) {
        conflicts.push({
          key: link.key,
          title: current.summary || link.key,
          reason: "Event ownership could not be verified.",
          url: current.htmlLink,
        });
        continue;
      }
      const desiredEvent = desiredByKey.get(link.key);
      if (
        current.etag !== link.etag &&
        desiredEvent &&
        eventFingerprint(current) !== eventFingerprint(desiredEvent)
      ) {
        conflicts.push({
          key: link.key,
          title: current.summary || desiredEvent.summary || link.key,
          reason:
            "Changed in Google Calendar. Daylight preserved both versions.",
          url: current.htmlLink,
        });
      }
    }
  }
  const today = zonedParts(
    new Date().toISOString(),
    state.settings.timezone,
  ).day;
  const year = Number(today.slice(0, 4));
  const sources = [
    {
      calendar: target,
      from: addDays(today, -31),
      to: addDays(today, 366),
    },
    ...(state.settings.syncHolidays
      ? calendars
          .filter((c) => isHolidayCalendar(c.id) && c.selected !== false)
          .map((calendar) => ({
            calendar,
            from: `${year}-01-01`,
            to: `${year + 2}-01-01`,
          }))
      : []),
  ];
  // Incomplete pagination must never replace a complete local snapshot.
  const imported = (
    await Promise.all(
      sources.map(async ({ calendar, from, to }) => {
        const events = await readEvents(
          token,
          calendar.id,
          from,
          to,
          state.settings.timezone,
        );
        return events.flatMap((e) => {
          if (e.extendedProperties?.private?.daylightOwner === userId)
            return [];
          const event = importedGoogleEvent(e, calendar);
          if (!event) return [];
          // Calendar API bounds are instants. Exclude all-day edge events returned
          // by calendars in a different timezone from the planner.
          if (event.allDay && (event.start >= to || event.end <= from))
            return [];
          return [event];
        });
      }),
    )
  ).flat();
  return {
    links,
    events: imported,
    conflicts,
    written,
    lastSync: new Date().toISOString(),
  };
}

async function readEvents(
  token: string,
  calendarId: string,
  from: string,
  to: string,
  timezone: string,
) {
  const base = `calendars/${encodeURIComponent(calendarId)}/events`;
  const events: GoogleEvent[] = [];
  let pageToken = "";
  const params = new URLSearchParams({
    singleEvents: "true",
    timeMin: localInstant(from, "00:00", timezone),
    timeMax: localInstant(to, "00:00", timezone),
    maxResults: "2500",
  });
  for (let page = 0; page < 30; page++) {
    if (pageToken) params.set("pageToken", pageToken);
    const data = await googleJson(token, base + "?" + params);
    events.push(...(data.items || []));
    pageToken = data.nextPageToken || "";
    if (!pageToken) return events;
  }
  throw new HttpError(
    "Calendar is too large for a complete snapshot. Existing imported events were preserved.",
    502,
  );
}
