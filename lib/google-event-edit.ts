import { z } from "zod";
import { State, addDays, clockTime, daySchema, timeSchema } from "./model";
import { zonedParts } from "./engine";
import { localInstant } from "./google-plan";
import type { GoogleEvent } from "./google-plan";

export const eventTimeSchema = z.discriminatedUnion("allDay", [
  z.object({
    allDay: z.literal(true),
    startDate: daySchema,
    endDate: daySchema,
  }),
  z.object({
    allDay: z.literal(false),
    startDate: daySchema,
    endDate: daySchema,
    startTime: timeSchema,
    endTime: timeSchema,
    timezone: z
      .string()
      .max(100)
      .refine((zone) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      }),
  }),
]);
export type EventTime = z.infer<typeof eventTimeSchema>;
export type EventDrop = { date: string; start?: string; duration?: number };
export type ImportedEvent = State["events"][number];
export type GoogleEventInfo = Pick<
  GoogleEvent,
  | "description"
  | "location"
  | "organizer"
  | "attendees"
  | "attendeesOmitted"
  | "hangoutLink"
  | "conferenceData"
  | "attachments"
  | "reminders"
  | "source"
  | "visibility"
  | "eventType"
  | "status"
  | "created"
  | "updated"
  | "htmlLink"
  | "workingLocationProperties"
> & { timeZone?: string };

const dateDistance = (start: string, end: string) =>
  (Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) /
  86400000;

export function timeEditorValues(
  event: ImportedEvent,
  timezone: string,
  move?: EventDrop,
): EventTime {
  if (event.allDay) {
    const original = event.start.slice(0, 10);
    const startDate = move?.date || original;
    return {
      allDay: true,
      startDate,
      endDate: addDays(
        startDate,
        dateDistance(original, event.end.slice(0, 10)) - 1,
      ),
    };
  }
  let start = zonedParts(event.start, timezone);
  let end = zonedParts(event.end, timezone);
  if (move) {
    const newStart = localInstant(
      move.date,
      move.start || clockTime(start.minute),
      timezone,
    );
    const duration =
      (move?.duration || 0) * 60000 ||
      Date.parse(event.end) - Date.parse(event.start);
    end = zonedParts(
      new Date(Date.parse(newStart) + duration).toISOString(),
      timezone,
    );
    const [hour, minute] = (move.start || clockTime(start.minute))
      .split(":")
      .map(Number);
    start = { day: move.date, minute: hour * 60 + minute };
  }
  return {
    allDay: false,
    startDate: start.day,
    endDate: end.day,
    startTime: clockTime(start.minute),
    endTime: clockTime(end.minute),
    timezone,
  };
}

export function googleEventInterval(time: EventTime, current: GoogleEvent) {
  if (time.allDay) {
    if (time.endDate < time.startDate)
      throw new Error("The last day must be on or after the start day.");
    return {
      start: { date: time.startDate },
      end: { date: addDays(time.endDate, 1) },
    };
  }
  const { timezone } = time;
  function toInstant(date: string, clock: string, old?: GoogleEvent["start"]) {
    // Keep the original instant (including its DST offset) for an unchanged wall time.
    if (old?.dateTime) {
      const before = zonedParts(old.dateTime, timezone);
      if (before.day === date && clockTime(before.minute) === clock)
        return old.dateTime;
    }
    const iso = localInstant(date, clock, timezone);
    const actual = zonedParts(iso, timezone);
    if (actual.day !== date || clockTime(actual.minute) !== clock)
      throw new Error(
        "That time doesn’t exist in this timezone. Choose another time.",
      );
    return iso;
  }
  const start = toInstant(time.startDate, time.startTime, current.start);
  const end = toInstant(time.endDate, time.endTime, current.end);
  if (Date.parse(end) <= Date.parse(start))
    throw new Error("The event must end after it starts.");
  return {
    start: {
      dateTime: start,
      timeZone: current.start?.timeZone || time.timezone,
    },
    end: { dateTime: end, timeZone: current.end?.timeZone || time.timezone },
  };
}
