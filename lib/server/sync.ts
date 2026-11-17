import { createHash } from "node:crypto";
import { State, addDays, clockTime, sessionSchema } from "../model";
import {
  outboundEvents,
  canonicalEvent,
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
// last sync, then import. pull: read Google changes without writing to Google.
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
    conflicts: {
      key: string;
      title: string;
      reason: string;
      url?: string;
    }[] = [];
  const old = new Map(
    state.links
      .filter((l) => l.calendarId === calendarId)
      .map((l) => [l.key, l]),
  );
  const desiredByKey = new Map(desired.map(({ key, event }) => [key, event]));
  const nextLinks = new Map([...old].map(([key, link]) => [key, { ...link }]));
  let written = 0;
  const pushing = mode !== "pull";
  if (pushing && desired.length > 500)
    throw new HttpError(
      "This sync supports up to 500 Daylight records. Archive/export older records before synchronizing larger workspaces.",
      400,
    );

  const keys = [
    ...new Set([...old.keys(), ...(pushing ? desiredByKey.keys() : [])]),
  ];
  const sessionTimes: Pick<
    State["sessions"][number],
    "id" | "date" | "start" | "duration"
  >[] = [];
  const sessions = new Map(
    state.sessions.map((session) => ["session:" + session.id, session]),
  );
  async function fetchLinked(key: string) {
    const initialId = createHash("sha256")
      .update(userId + ":" + calendarId + ":" + key)
      .digest("hex");
    const path =
      base + "/" + encodeURIComponent(old.get(key)?.eventId || initialId);
    return { initialId, path, fetched: await googleFetch(token, path) };
  }
  const prefetched = new Map<string, ReturnType<typeof fetchLinked>>();
  for (const [index, key] of keys.entries()) {
    if (!pushing && index % 8 === 0) {
      for (const pending of keys.slice(index, index + 8)) {
        if (desiredByKey.has(pending))
          prefetched.set(pending, fetchLinked(pending));
      }
      await Promise.all(prefetched.values());
    }
    const link = old.get(key);
    const event = desiredByKey.get(key);
    const fingerprint = event && eventFingerprint(event);
    const localChanged = !!event && fingerprint !== link?.fingerprint;
    if (mode === "push" && link && event && !localChanged) continue;
    if (!pushing && !event) continue;

    const { initialId, path, fetched } = await (prefetched.get(key) ||
      fetchLinked(key));
    prefetched.delete(key);
    const gone = fetched.status === 404 || fetched.status === 410;
    if (!fetched.ok && !gone)
      throw new HttpError(
        `Could not read Google events (${fetched.status}). Retry synchronization.`,
        502,
      );
    const current: GoogleEvent | null = fetched.ok
      ? await fetched.json()
      : null;
    const cancelled = current?.status === "cancelled";
    const owned =
      current?.extendedProperties?.private?.daylightOwner === userId &&
      current.extendedProperties.private.daylightKey === key;

    // Cancelled resources can contain only an ID. Check live resources separately.
    if (current && !cancelled && !owned) {
      conflicts.push({
        key,
        title: event?.summary || key,
        reason: "Event ownership could not be verified.",
        url: current.htmlLink,
      });
      continue;
    }

    if (current && !cancelled && !current.etag) {
      conflicts.push({
        key,
        title: current.summary || event?.summary || key,
        reason: "Google did not return an event version. Retry syncing.",
        url: current.htmlLink,
      });
      continue;
    }

    if (!event) {
      if (!gone && !cancelled) {
        const removed = await googleFetch(token, path, {
          method: "DELETE",
          headers: current?.etag ? { "If-Match": current.etag } : {},
        });
        if (!removed.ok && removed.status !== 404 && removed.status !== 410) {
          conflicts.push({
            key,
            title: current?.summary || "Removed record",
            reason: "Google could not remove this event. Retry syncing.",
            url: current?.htmlLink,
          });
          continue;
        }
        if (removed.ok) written++;
      }
      nextLinks.delete(key);
      continue;
    }

    if (cancelled || (gone && link)) {
      // Keep the deletion across pulls and retries. An edit after Daylight has
      // observed the deletion can publish a new copy with a fresh stable ID.
      if (!link?.deletedInGoogle || !localChanged || !pushing) {
        nextLinks.set(key, {
          key,
          calendarId,
          eventId: link?.eventId || initialId,
          etag: "",
          fingerprint: link?.deletedInGoogle ? link.fingerprint : fingerprint!,
          deletedInGoogle: true,
        });
        continue;
      }
    }

    let saved = current;
    const create = !current || cancelled;
    if (pushing && (create || localChanged)) {
      const privateTags = { daylightOwner: userId, daylightKey: key };
      const replacement = link?.deletedInGoogle && (gone || cancelled);
      const eventId = replacement
        ? createHash("sha256")
            .update(link.eventId + ":replacement")
            .digest("hex")
        : initialId;
      let payload: GoogleEvent = {
        ...event,
        extendedProperties: { private: privateTags },
      };
      if (!create && link) {
        // Merge field changes against the last Daylight projection. Google-only
        // changes (including metadata outside this projection) stay in Google.
        const previous = readFingerprint(link.fingerprint);
        const local = canonicalEvent(event);
        payload = {};
        if (local.summary !== previous?.summary)
          payload.summary = event.summary;
        if (local.description !== previous?.description)
          payload.description = event.description;
        if (local.transparency !== previous?.transparency)
          payload.transparency = local.transparency;
        if (
          JSON.stringify(local.recurrence) !==
          JSON.stringify(previous?.recurrence)
        )
          payload.recurrence = event.recurrence || [];
        if (
          local.start !== previous?.start ||
          local.end !== previous?.end ||
          local.timezone !== previous?.timezone
        ) {
          payload.start = event.start;
          payload.end = event.end;
        }
      }
      // An owned stable ID without a link means the insert succeeded on a previous attempt.
      if (create || (link && Object.keys(payload).length)) {
        const res = await googleFetch(token, create ? base : path, {
          method: create ? "POST" : "PATCH",
          headers: !create && current?.etag ? { "If-Match": current.etag } : {},
          body: JSON.stringify(create ? { id: eventId, ...payload } : payload),
        });
        if (create && res.status === 409) {
          const retry = await googleFetch(
            token,
            base + "/" + encodeURIComponent(eventId),
          );
          if (retry.ok) {
            const candidate: GoogleEvent = await retry.json();
            if (
              candidate.status !== "cancelled" &&
              candidate.extendedProperties?.private?.daylightOwner === userId &&
              candidate.extendedProperties.private.daylightKey === key
            )
              saved = candidate;
          }
        } else if (res.ok) {
          saved = await res.json();
          written++;
        }
        if (!res.ok && (res.status !== 409 || saved === current)) {
          if (res.status === 409 || res.status === 412 || res.status === 400) {
            const detail =
              res.status === 400
                ? (await res.json().catch(() => null))?.error?.message
                : null;
            conflicts.push({
              key,
              title: event.summary || key,
              reason:
                res.status === 400
                  ? "Google rejected this event" +
                    (detail ? ": " + String(detail).slice(0, 160) : " (400)") +
                    "."
                  : "Google changed this event during sync. Retry syncing.",
              url: current?.htmlLink,
            });
            continue;
          }
          throw new HttpError(
            `Google could not save an event (${res.status}). Retry synchronization.`,
            502,
          );
        }
      }
    }

    if (!saved?.id || !saved.etag) continue;
    let baseline = pushing ? fingerprint! : link!.fingerprint;
    const local = readFingerprint(baseline) || canonicalEvent(event);
    const remote = canonicalEvent(saved);
    const session = sessions.get(key);
    const intervalChanged =
      remote.start !== local.start || remote.end !== local.end;
    const startTime = saved.start?.dateTime;
    const endTime = saved.end?.dateTime;
    let nativeTime = !intervalChanged;
    if (
      session &&
      intervalChanged &&
      startTime &&
      endTime &&
      (pushing || !localChanged)
    ) {
      const start = zonedParts(startTime, state.settings.timezone);
      const end = zonedParts(endTime, state.settings.timezone);
      const endMinute =
        end.day === start.day
          ? end.minute
          : end.day === addDays(start.day, 1) && end.minute === 0
            ? 1440
            : -1;
      const timing = {
        id: session.id,
        date: start.day,
        start: clockTime(start.minute),
        duration: endMinute - start.minute,
      };
      if (
        sessionSchema.safeParse({ ...session, ...timing }).success &&
        localInstant(timing.date, timing.start, state.settings.timezone) ===
          remote.start &&
        localInstant(
          end.day,
          clockTime(end.minute),
          state.settings.timezone,
        ) === remote.end
      ) {
        sessionTimes.push(timing);
        baseline = JSON.stringify({
          ...local,
          start: remote.start,
          end: remote.end,
        });
        nativeTime = true;
      }
    }
    const googleOverride = session
      ? !nativeTime
      : remote.summary !== local.summary ||
        remote.start !== local.start ||
        remote.end !== local.end ||
        remote.transparency !== local.transparency ||
        JSON.stringify(remote.recurrence) !== JSON.stringify(local.recurrence);
    nextLinks.set(key, {
      key,
      calendarId,
      eventId: saved.id,
      etag: saved.etag,
      fingerprint: baseline,
      ...(googleOverride ? { googleOverride } : {}),
    });
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
        const linked =
          calendar.id === target.id
            ? new Map(
                [...nextLinks.values()].map((link) => [link.eventId, link]),
              )
            : new Map<string, State["links"][number]>();
        for (const link of linked.values()) delete link.googleOccurrenceDates;
        const occurrenceDates = new Map<string, Set<string>>();
        const importedEvents = events.flatMap((e) => {
          const link = linked.get(e.recurringEventId || e.id || "");
          const owned = e.extendedProperties?.private?.daylightOwner === userId;
          if (link?.deletedInGoogle) return [];
          if (
            link &&
            !link.googleOverride &&
            e.recurringEventId &&
            link.key.startsWith("routine:")
          ) {
            const original = e.originalStartTime;
            const date =
              original?.date ||
              (original?.dateTime &&
                zonedParts(original.dateTime, state.settings.timezone).day);
            const moved =
              !!original &&
              (original.date !== e.start?.date ||
                (Date.parse(original.dateTime || "") !==
                  Date.parse(e.start?.dateTime || "") &&
                  !!(original.dateTime || e.start?.dateTime)));
            const series = desiredByKey.get(link.key);
            const duration = (entry: GoogleEvent) => {
              const start = entry.start?.dateTime || entry.start?.date;
              const end = entry.end?.dateTime || entry.end?.date;
              return start && end ? Date.parse(end) - Date.parse(start) : null;
            };
            const changed =
              e.status === "cancelled" ||
              moved ||
              (series &&
                (e.summary !== series.summary ||
                  (e.transparency || "opaque") !==
                    (series.transparency || "opaque") ||
                  duration(e) !== duration(series)));
            if (!date || !changed) return [];
            const dates = occurrenceDates.get(link.key) || new Set<string>();
            dates.add(date);
            occurrenceDates.set(link.key, dates);
          } else if ((owned || link) && !link?.googleOverride) {
            return [];
          }
          const event = importedGoogleEvent(e, calendar);
          if (!event) return [];
          if (link) {
            event.canEdit = false;
            event.canDelete = false;
          }
          // Calendar API bounds are instants. Exclude all-day edge events returned
          // by calendars in a different timezone from the planner.
          if (event.allDay && (event.start >= to || event.end <= from))
            return [];
          return [event];
        });
        for (const [key, dates] of occurrenceDates)
          nextLinks.get(key)!.googleOccurrenceDates = [...dates].sort();
        return importedEvents;
      }),
    )
  ).flat();
  return {
    links: [
      ...state.links.filter((link) => link.calendarId !== calendarId),
      ...nextLinks.values(),
    ],
    events: imported,
    sessionTimes,
    conflicts,
    written,
    lastSync: new Date().toISOString(),
  };
}

function readFingerprint(
  value: string,
): ReturnType<typeof canonicalEvent> | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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
    showDeleted: "true",
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
