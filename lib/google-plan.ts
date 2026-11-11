import {
  State,
  addDays,
  clockMinutes,
  clockTime,
  weekday,
  dayKey,
} from "./model";
export type GoogleEvent = {
  id?: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  organizer?: GooglePerson;
  attendees?: (GooglePerson & {
    responseStatus?: string;
    optional?: boolean;
    comment?: string;
  })[];
  attendeesOmitted?: boolean;
  hangoutLink?: string;
  conferenceData?: {
    conferenceSolution?: { name?: string };
    entryPoints?: {
      entryPointType?: string;
      uri?: string;
      label?: string;
      pin?: string;
      accessCode?: string;
      meetingCode?: string;
      passcode?: string;
      password?: string;
    }[];
    notes?: string;
  };
  attachments?: { fileUrl?: string; title?: string; mimeType?: string }[];
  reminders?: {
    useDefault?: boolean;
    overrides?: { method: string; minutes: number }[];
  };
  source?: { title?: string; url?: string };
  eventType?: string;
  visibility?: string;
  created?: string;
  locked?: boolean;
  guestsCanModify?: boolean;
  workingLocationProperties?: {
    type?: string;
    officeLocation?: { label?: string };
    customLocation?: { label?: string };
  };
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  recurrence?: string[];
  transparency?: string;
  extendedProperties?: { private?: Record<string, string> };
  updated?: string;
  recurringEventId?: string;
  htmlLink?: string;
};
export type GooglePerson = {
  displayName?: string;
  email?: string;
  self?: boolean;
};

export function googleTimeEditable(event: GoogleEvent) {
  return (
    !event.locked &&
    !["birthday", "fromGmail"].includes(event.eventType || "") &&
    (event.organizer?.self !== false || event.guestsCanModify === true)
  );
}

const weekdayOrder = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
function normalizedRecurrence(lines: string[]) {
  return lines
    .map((line) => {
      const split = line.indexOf(":");
      if (split < 0) return line.toUpperCase();
      const head = line.slice(0, split).toUpperCase();
      const value = line.slice(split + 1).toUpperCase();
      if (head.startsWith("RRULE")) {
        const parts = value.split(";").map((part) => {
          const [key, raw] = part.split("=", 2);
          if (key === "BYDAY")
            return [
              key,
              raw
                .split(",")
                .sort(
                  (a, b) =>
                    weekdayOrder.indexOf(a.slice(-2)) -
                    weekdayOrder.indexOf(b.slice(-2)),
                )
                .join(","),
            ].join("=");
          return part;
        });
        return (
          "RRULE:" +
          parts
            .sort((a, b) =>
              a.split("=", 1)[0].localeCompare(b.split("=", 1)[0]),
            )
            .join(";")
        );
      }
      if (head.startsWith("EXDATE")) {
        const values = value.split(",");
        if (head.includes("VALUE=DATE"))
          return "EXDATE;VALUE=DATE:" + values.sort().join(",");
        const timezone = head.match(/TZID=([^;]+)/)?.[1] || "UTC";
        const instants = values.map((compact) => {
          const match = compact.match(/^(\d{8})T(\d{6})(Z)?$/);
          if (!match) return compact;
          const [, date, time, utc] = match;
          const dateValue = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
          const timeValue = `${time.slice(0, 2)}:${time.slice(2, 4)}`;
          return utc
            ? new Date(`${dateValue}T${timeValue}:00Z`).toISOString()
            : localInstant(dateValue, timeValue, timezone);
        });
        return "EXDATE:" + instants.sort().join(",");
      }
      return head + ":" + value;
    })
    .sort();
}
export function canonicalEvent(e: GoogleEvent) {
  return {
    summary: e.summary || "",
    description: e.description || "",
    start:
      e.start?.date ||
      (e.start?.dateTime ? new Date(e.start.dateTime).toISOString() : ""),
    end:
      e.end?.date ||
      (e.end?.dateTime ? new Date(e.end.dateTime).toISOString() : ""),
    timezone: e.start?.timeZone || "",
    recurrence: normalizedRecurrence(e.recurrence || []),
    transparency: e.transparency || "opaque",
  };
}
export function eventFingerprint(e: GoogleEvent): string {
  return JSON.stringify(canonicalEvent(e));
}
export function localInstant(date: string, time: string, zone: string) {
  const target = new Date(date + "T" + time + ":00Z");
  let guess = +target;
  for (let i = 0; i < 3; i++) {
    const p = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const get = (t: string) => p.find((x) => x.type === t)?.value;
    const shown = Date.parse(
      `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:00Z`,
    );
    const delta = +target - shown;
    if (!delta) break;
    guess += delta;
  }
  return new Date(guess).toISOString();
}
function interval(date: string, start: string, duration: number, zone: string) {
  const end = clockMinutes(start) + duration;
  return {
    start: { dateTime: localInstant(date, start, zone), timeZone: zone },
    end: {
      dateTime: localInstant(
        end === 1440 ? addDays(date, 1) : date,
        end === 1440 ? "00:00" : clockTime(end),
        zone,
      ),
      timeZone: zone,
    },
  };
}
export function outboundEvents(
  s: State,
  today = dayKey(),
): { key: string; event: GoogleEvent }[] {
  const out: { key: string; event: GoogleEvent }[] = [],
    zone = s.settings.timezone;
  for (const x of s.sessions) {
    const task = s.tasks.find((t) => t.id === x.taskId);
    out.push({
      key: "session:" + x.id,
      event: {
        summary: task?.title || "Work session",
        description:
          "Daylight work session. Scheduling does not confirm completion.",
        ...interval(x.date, x.start, x.duration, zone),
      },
    });
  }
  for (const r of s.routines) {
    let first = r.since;
    for (let i = 0; i < 7 && !r.days.includes(weekday(first)); i++)
      first = addDays(first, 1);
    const pauseDay =
      s.audit
        .filter((a) => a.recordId === r.id && a.action === "Routine paused")
        .at(-1)
        ?.at.slice(0, 10) || today;
    const until = r.paused ? addDays(pauseDay, -1) : r.until;
    const exceptions = s.exceptions.filter((x) => x.routineId === r.id);
    const recurrence = [
      `RRULE:FREQ=${r.recurrenceUnit === "months" ? "MONTHLY" : r.recurrenceUnit === "days" ? "DAILY" : "WEEKLY"};INTERVAL=${r.recurrenceInterval || 1}${r.recurrenceUnit === "days" ? "" : ";BYDAY=" + r.days.map((d) => ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][d]).join(",")}${until ? ";UNTIL=" + (r.untimed ? until.replace(/-/g, "") : localInstant(until, "23:59", zone).replace(/[-:]/g, "").replace(".000", "")) : ""}`,
    ];
    if (until && until < first) continue;
    for (const ex of exceptions)
      recurrence.push(
        r.untimed
          ? "EXDATE;VALUE=DATE:" + ex.date.replace(/-/g, "")
          : "EXDATE;TZID=" +
              zone +
              ":" +
              localInstant(ex.date, r.start, zone)
                .replace(/[-:]/g, "")
                .replace(".000", "")
                .replace(/Z$/, ""),
      );
    out.push({
      key: "routine:" + r.id,
      event: {
        summary: r.title,
        description: r.untimed
          ? "Daylight routine for any time of day."
          : "Fixed Daylight routine.",
        ...(r.untimed
          ? {
              start: { date: first },
              end: { date: addDays(first, 1) },
              transparency: "transparent",
            }
          : interval(first, r.start, r.duration, zone)),
        recurrence,
      },
    });
    for (const ex of exceptions.filter(
      (x) => !x.skip && (!until || x.date <= until),
    ))
      out.push({
        key: `exception:${r.id}:${ex.date}`,
        event: {
          summary: r.title,
          description: "One-off Daylight routine change.",
          ...interval(ex.date, ex.start, ex.duration, zone),
        },
      });
  }
  for (const d of s.deadlines)
    out.push({
      key: "deadline:" + d.id,
      event: {
        summary: (d.status === "resolved" ? "✓ " : "Due · ") + d.title,
        description: `Daylight deadline marker, not a work session.${d.time ? " Due at " + d.time + " (" + zone + ")." : ""}`,
        start: { date: d.date },
        end: { date: addDays(d.date, 1) },
        transparency: "transparent",
      },
    });
  for (const p of s.projects) {
    out.push({
      key: "project:" + p.id,
      event: {
        summary: (p.status === "completed" ? "✓ " : "Due · ") + p.title,
        description: "Daylight final project deadline; not a work session.",
        start: { date: p.deadline },
        end: { date: addDays(p.deadline, 1) },
        transparency: "transparent",
      },
    });
    for (const m of p.milestones.filter((x) => x.approved))
      out.push({
        key: "milestone:" + m.id,
        event: {
          summary: (m.completed ? "✓ " : "Milestone · ") + m.title,
          description:
            p.title + " · Approved Daylight milestone; not a work session.",
          start: { date: m.date },
          end: { date: addDays(m.date, 1) },
          transparency: "transparent",
        },
      });
  }
  return out;
}
