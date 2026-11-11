"use client";
import { FormEvent, useState } from "react";
import { ArrowUpRight, Clock3, Trash2 } from "lucide-react";
import { addDays, formatDate } from "@/lib/model";
import {
  EventTime,
  GoogleEventInfo,
  ImportedEvent,
  timeEditorValues,
} from "@/lib/google-event-edit";
import type { GooglePerson } from "@/lib/google-plan";
import { Dialog, Field } from "./ui";

function EventLink({ url, label }: { url?: string; label?: string }) {
  if (!url) return null;
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return null;
  }
  if (!["https:", "http:", "tel:", "sip:"].includes(protocol)) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {label || url} <ArrowUpRight size={12} aria-hidden="true" />
    </a>
  );
}

function readableText(text: string) {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return text
    .replace(/<a\b[^>]*?href=(["'])([^"']+)\1[^>]*>(.*?)<\/a>/gis, "$3 ($2)")
    .replace(/<br\s*\/?>|<\/(?:p|div|li)>/gi, "\n")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/&([a-z]+|#\d+|#x[a-f\d]+);/gi, (raw, name: string) => {
      if (!name.startsWith("#")) return entities[name.toLowerCase()] ?? raw;
      const value =
        name[1]?.toLowerCase() === "x"
          ? parseInt(name.slice(2), 16)
          : Number(name.slice(1));
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : raw;
    });
}

function personName(person: GooglePerson) {
  return person.displayName
    ? person.displayName + (person.email ? " (" + person.email + ")" : "")
    : person.email || (person.self ? "You" : "Unnamed guest");
}

const responses: Record<string, string> = {
  accepted: "Accepted",
  declined: "Declined",
  tentative: "Maybe",
  needsAction: "No reply",
};

function Details({ info }: { info: GoogleEventInfo }) {
  const { conferenceData: conference, workingLocationProperties: work } = info;
  const entryPoints = conference?.entryPoints ?? [];
  const date = (value?: string) =>
    value && Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleString()
      : undefined;
  return (
    <dl className="google-event-info">
      {info.description && (
        <>
          <dt>Description</dt>
          <dd className="event-description">
            {readableText(info.description)}
          </dd>
        </>
      )}
      {(info.location || work?.type) && (
        <>
          <dt>Location</dt>
          <dd>
            {info.location ||
              work?.officeLocation?.label ||
              work?.customLocation?.label ||
              (work?.type === "homeOffice" ? "Home office" : work?.type)}
          </dd>
        </>
      )}
      {(info.hangoutLink || entryPoints.length > 0 || conference?.notes) && (
        <>
          <dt>{conference?.conferenceSolution?.name || "Joining details"}</dt>
          <dd>
            {info.hangoutLink &&
              !entryPoints.some((entry) => entry.uri === info.hangoutLink) && (
                <EventLink url={info.hangoutLink} label="Join video meeting" />
              )}
            {entryPoints.map((entry, i) => {
              const codes = [
                ["PIN", entry.pin],
                ["Access code", entry.accessCode],
                ["Meeting code", entry.meetingCode],
                ["Passcode", entry.passcode],
                ["Password", entry.password],
              ].filter(([, value]) => value);
              return (
                <div key={i}>
                  <EventLink
                    url={entry.uri}
                    label={
                      entry.label ||
                      (entry.entryPointType === "video"
                        ? "Join video meeting"
                        : undefined)
                    }
                  />
                  {codes.length > 0 && (
                    <small>
                      {codes
                        .map(([label, value]) => label + ": " + value)
                        .join(" · ")}
                    </small>
                  )}
                </div>
              );
            })}
            {conference?.notes && (
              <div className="event-description">
                {readableText(conference.notes)}
              </div>
            )}
          </dd>
        </>
      )}
      {info.organizer && (
        <>
          <dt>Organizer</dt>
          <dd>{personName(info.organizer)}</dd>
        </>
      )}
      {(!!info.attendees?.length || info.attendeesOmitted) && (
        <>
          <dt>Guests</dt>
          <dd>
            <ul>
              {info.attendees?.map((guest, i) => (
                <li key={i}>
                  {personName(guest)}
                  {guest.optional && " · Optional"}
                  {guest.responseStatus &&
                    " · " +
                      (responses[guest.responseStatus] || guest.responseStatus)}
                  {guest.comment && <small>{guest.comment}</small>}
                </li>
              ))}
            </ul>
            {info.attendeesOmitted && (
              <small>Google shared only part of the guest list.</small>
            )}
          </dd>
        </>
      )}
      {!!info.attachments?.length && (
        <>
          <dt>Attachments</dt>
          <dd>
            <ul>
              {info.attachments.map((file, i) => (
                <li key={i}>
                  {file.fileUrl ? (
                    <EventLink
                      url={file.fileUrl}
                      label={file.title || "Open attachment"}
                    />
                  ) : (
                    file.title || "Attachment"
                  )}
                </li>
              ))}
            </ul>
          </dd>
        </>
      )}
      {info.reminders && (
        <>
          <dt>Reminders</dt>
          <dd>
            {info.reminders.useDefault
              ? "Calendar defaults"
              : info.reminders.overrides?.length
                ? info.reminders.overrides
                    .map(
                      (reminder) =>
                        `${reminder.method === "popup" ? "Notification" : reminder.method} · ${reminder.minutes} min before`,
                    )
                    .join("; ")
                : "None"}
          </dd>
        </>
      )}
      {info.timeZone && (
        <>
          <dt>Event timezone</dt>
          <dd>{info.timeZone}</dd>
        </>
      )}
      {info.visibility && info.visibility !== "default" && (
        <>
          <dt>Visibility</dt>
          <dd>{info.visibility}</dd>
        </>
      )}
      {info.status && info.status !== "confirmed" && (
        <>
          <dt>Status</dt>
          <dd>{info.status}</dd>
        </>
      )}
      {info.eventType && info.eventType !== "default" && (
        <>
          <dt>Event type</dt>
          <dd>
            {(
              {
                focusTime: "Focus time",
                outOfOffice: "Out of office",
                workingLocation: "Working location",
                fromGmail: "From Gmail",
              } as Record<string, string>
            )[info.eventType] || info.eventType}
          </dd>
        </>
      )}
      {date(info.created) && (
        <>
          <dt>Created</dt>
          <dd>{date(info.created)}</dd>
        </>
      )}
      {date(info.updated) && (
        <>
          <dt>Last updated</dt>
          <dd>{date(info.updated)}</dd>
        </>
      )}
      {info.source?.url && (
        <>
          <dt>Source</dt>
          <dd>
            <EventLink
              url={info.source.url}
              label={info.source.title || "Open source"}
            />
          </dd>
        </>
      )}
    </dl>
  );
}

export function GoogleEventDetails({
  event,
  timezone,
  canUseGoogle,
  busy,
  selection,
  onSave,
  onDelete,
  onClose,
}: {
  event: ImportedEvent;
  timezone: string;
  canUseGoogle: boolean;
  busy: boolean;
  selection: {
    info?: GoogleEventInfo;
    infoLoading?: boolean;
    infoError?: string;
  };
  onSave: (time: EventTime) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const formatDay = (date: string) =>
    formatDate(date, {
      weekday: "short",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  const formatter = new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  });
  const endDay = event.allDay ? addDays(event.end.slice(0, 10), -1) : "";
  const dateLabel = event.allDay
    ? formatDay(event.start.slice(0, 10)) +
      (endDay === event.start.slice(0, 10) ? "" : " – " + formatDay(endDay))
    : formatter.formatRange(new Date(event.start), new Date(event.end));
  const canDelete =
    canUseGoogle && event.canDelete && event.googleId && event.etag;
  const canEdit = canUseGoogle && event.canEdit && event.googleId && event.etag;
  const initial = timeEditorValues(event, timezone);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fields = new FormData(e.currentTarget);
    const startDate = String(fields.get("startDate"));
    const endDate = String(fields.get("endDate"));
    setError("");
    try {
      await onSave(
        event.allDay
          ? { allDay: true, startDate, endDate }
          : {
              allDay: false,
              startDate,
              endDate,
              timezone,
              startTime: String(fields.get("startTime")),
              endTime: String(fields.get("endTime")),
            },
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Dialog
      title={event.title}
      subtitle={event.calendarName || "Google Calendar"}
      onClose={onClose}
      wide
    >
      <div className="editor-form google-event-details">
        <p>
          {dateLabel}
          {event.allDay ? " · All day" : ""}
          {event.holiday ? " · Holiday" : event.free ? " · Free" : " · Busy"}
        </p>
        {event.holiday && (
          <p className="form-hint">Holiday · Does not block planning time.</p>
        )}
        {event.recurring && (
          <p className="form-hint">
            This is a recurring event. Changes apply only to this occurrence.
          </p>
        )}
        {selection.infoLoading && (
          <p className="form-hint" role="status">
            Loading Google event details…
          </p>
        )}
        {selection.infoError && (
          <p className="form-hint" role="status">
            {selection.infoError}
          </p>
        )}
        {selection.info && <Details info={selection.info} />}
        {selection.info?.htmlLink && (
          <p>
            <EventLink
              url={selection.info.htmlLink}
              label="Open in Google Calendar"
            />
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {editing && canEdit ? (
          <form onSubmit={save} className="google-time-editor">
            <div className="form-grid">
              <Field label="Start date">
                <input
                  type="date"
                  name="startDate"
                  required
                  defaultValue={initial.startDate}
                />
              </Field>
              {!initial.allDay && (
                <Field label="Start time">
                  <input
                    type="time"
                    name="startTime"
                    required
                    defaultValue={initial.startTime}
                  />
                </Field>
              )}
              <Field label={initial.allDay ? "Last day" : "End date"}>
                <input
                  type="date"
                  name="endDate"
                  required
                  defaultValue={initial.endDate}
                />
              </Field>
              {!initial.allDay && (
                <Field label="End time">
                  <input
                    type="time"
                    name="endTime"
                    required
                    defaultValue={initial.endTime}
                  />
                </Field>
              )}
            </div>
            {!initial.allDay && (
              <p className="form-hint">Times are shown in {timezone}.</p>
            )}
            <div className="settings-actions">
              <button type="submit" className="button primary" disabled={busy}>
                {busy ? "Saving…" : "Save time in Google"}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setError("");
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="settings-actions">
            {canEdit && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setEditing(true);
                  setError("");
                }}
              >
                <Clock3 size={15} /> Edit date and time
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                className="button secondary danger"
                disabled={busy}
                onClick={async () => {
                  setError("");
                  try {
                    await onDelete();
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              >
                <Trash2 size={15} /> Delete from Google Calendar
              </button>
            )}
          </div>
        )}
        {!event.holiday && !canEdit && (
          <p className="form-hint">
            {!canUseGoogle
              ? "Sign in to manage Google events."
              : event.canEdit === undefined
                ? "Sync Google Calendar again to enable time editing."
                : "Google doesn’t allow time changes for this event from Daylight."}
          </p>
        )}
      </div>
    </Dialog>
  );
}
