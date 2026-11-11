"use client";
import { useEffect, useState } from "react";
import {
  Sunrise,
  Download,
  Upload,
  RefreshCw,
  Link2,
  LogOut,
  ShieldCheck,
  Database,
  Sparkles,
  ExternalLink,
  Check,
  AlertTriangle,
} from "lucide-react";
import {
  State,
  stateSchema,
  validateReferences,
  audit,
  dayKey,
} from "@/lib/model";
import { useWorkspace } from "@/lib/use-workspace";
import { browserDb } from "@/lib/supabase";
import { PageHeading } from "./work-views";
import { Field, Badge, DAYS } from "./ui";
export type Health = {
  supabaseConfigured: boolean;
  googleConfigured: boolean;
  aiConfigured: boolean;
  aiProvider: string;
  aiModel: string | null;
};
export function download(name: string, data: unknown) {
  const blob = new Blob(
      [typeof data === "string" ? data : JSON.stringify(data, null, 2)],
      { type: "application/json" },
    ),
    url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Settings({
  workspace,
  health,
  api,
  sync,
  busy,
  notify,
}: {
  workspace: ReturnType<typeof useWorkspace>;
  health: Health | null;
  api: (path: string, body?: unknown, method?: string) => Promise<any>;
  sync: () => void;
  busy: boolean;
  notify: (s: string) => void;
}) {
  const { state, update, auth, mode } = workspace;
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [calendars, setCalendars] = useState<
      { id: string; name: string; primary: boolean }[]
    >([]),
    [holidays, setHolidays] = useState<string[] | null>(null),
    [aiCheck, setAiCheck] = useState<{ success: boolean; text: string } | null>(
      null,
    );
  async function action(fn: () => Promise<void>) {
    setError("");
    setMessage("");
    setLoading(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function loadCalendars() {
    const result = await api("/api/google/calendars", undefined, "GET");
    setCalendars(result.calendars);
    setHolidays(result.holidays);
    const primary = result.calendars.find(
      (calendar: { primary: boolean }) => calendar.primary,
    );
    // Older workspaces used Google's "primary" alias. Store the concrete
    // calendar ID so the selector cannot treat the same calendar as two
    // separate destinations and create duplicate Daylight events.
    if (primary && state.settings.calendarId === "primary") {
      update((s) => {
        s.settings.calendarId = primary.id;
        s.settings.calendarName = primary.name;
        for (const link of s.links)
          if (link.calendarId === "primary") link.calendarId = primary.id;
      });
    }
    setMessage("Google Calendar connection verified.");
  }
  return (
    <>
      <PageHeading
        eyebrow="A WORKSPACE THAT FITS YOU"
        title="A few thoughtful settings."
        subtitle="Your availability, your connections, and a copy of your work."
      />
      <div className="settings-grid">
        <section className="panel">
          <div className="settings-heading">
            <Sunrise size={20} />
            <h2>Your planning defaults</h2>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError("");
              const f = new FormData(e.currentTarget);
              try {
                update((s) => {
                  s.settings.name = String(f.get("name") || "");
                  s.settings.timezone = String(f.get("timezone"));
                  s.settings.workStart = String(f.get("start"));
                  s.settings.workEnd = String(f.get("end"));
                  s.settings.workDays = f.getAll("days").map(Number);
                  s.settings.horizon = Number(f.get("horizon"));
                  audit(s, "Planning availability updated", "settings");
                });
                notify("Planning defaults saved.");
              } catch (err) {
                setError(
                  (err as Error).name === "ZodError"
                    ? "Check the timezone and availability window."
                    : (err as Error).message,
                );
              }
            }}
          >
            <Field label="Your name">
              <input
                name="name"
                defaultValue={state.settings.name}
                placeholder="What should we call you?"
                maxLength={80}
              />
            </Field>
            <Field label="Calendar timezone">
              <input
                name="timezone"
                required
                defaultValue={state.settings.timezone}
                list="timezones"
              />
              <datalist id="timezones">
                {[
                  "America/New_York",
                  "America/Chicago",
                  "America/Denver",
                  "America/Los_Angeles",
                  "Europe/London",
                  "Europe/Paris",
                  "Asia/Tokyo",
                  "Australia/Sydney",
                  "UTC",
                ].map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </datalist>
            </Field>
            <div className="form-grid">
              <Field label="Available from">
                <input
                  type="time"
                  name="start"
                  required
                  defaultValue={state.settings.workStart}
                />
              </Field>
              <Field label="Available until">
                <input
                  type="time"
                  name="end"
                  required
                  defaultValue={state.settings.workEnd}
                />
              </Field>
            </div>
            <fieldset className="days-field">
              <legend>Planning days</legend>
              <div className="day-options">
                {DAYS.map((d, i) => (
                  <label key={d}>
                    <input
                      type="checkbox"
                      name="days"
                      value={i}
                      defaultChecked={state.settings.workDays.includes(i)}
                    />
                    <span title={d}>{d.slice(0, 2)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Field
              label="Look ahead · days"
              hint="Seven days is an editable starting point, not a fixed scheduling rule."
            >
              <input
                type="number"
                name="horizon"
                min="1"
                max="30"
                required
                defaultValue={state.settings.horizon}
              />
            </Field>
            <p className="form-hint">
              Capacity uses these windows minus recorded commitments. Set
              realistic availability; Daylight does not infer your working
              hours.
            </p>
            <button className="button primary">Save preferences</button>
          </form>
        </section>
        <div className="settings-stack">
          <section className="panel">
            <div className="settings-heading">
              <Database size={19} />
              <h2>Workspace & account</h2>
              <Badge tone={auth ? "sage" : "neutral"}>
                {auth ? "Signed in" : "Local workspace"}
              </Badge>
            </div>
            {auth ? (
              <>
                <p>
                  Signed in as <strong>{auth.user.email}</strong>.
                </p>
                <p className="form-hint">
                  {workspace.status}. Cloud workspaces are private to your
                  account. Local and sample workspaces stay separate.
                </p>
                <button
                  className="button secondary"
                  onClick={() =>
                    action(async () => {
                      await workspace.save();
                      const { error } = await browserDb()!.auth.signOut();
                      if (error) throw error;
                    })
                  }
                >
                  <LogOut size={15} />
                  Sign out
                </button>
              </>
            ) : (
              <>
                <p>
                  Work locally, or sign in to save privately with Supabase and
                  connect Google Calendar.
                </p>
                <button
                  type="button"
                  className="button secondary"
                  disabled={loading || !health?.supabaseConfigured}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 10,
                    background: "#fff",
                    color: "#3c4043",
                    border: "1px solid #dadce0",
                    fontWeight: 500,
                  }}
                  onClick={() =>
                    void action(async () => {
                      const db = browserDb();
                      if (!db) throw new Error("Supabase is not configured.");
                      const { error } = await db.auth.signInWithOAuth({
                        provider: "google",
                        options: {
                          redirectTo: window.location.origin + "/auth/callback",
                        },
                      });
                      if (error) throw error;
                    })
                  }
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 48 48"
                    aria-hidden="true"
                  >
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                  </svg>
                  Sign in with Google
                </button>
                <p className="form-hint">
                  Use the same Google account you signed in with before, so your
                  saved workspace opens.
                </p>
              </>
            )}
            <small className="muted">
              {health?.supabaseConfigured
                ? "Server credentials are configured; cloud storage also needs the SQL migration."
                : "Add Supabase settings to .env.local to enable cloud persistence."}
            </small>
          </section>
          <section className="panel">
            <div className="settings-heading">
              <Link2 size={19} />
              <h2>Google Calendar</h2>
              <Badge tone={state.settings.lastSync ? "sage" : "neutral"}>
                {state.settings.lastSync
                  ? "Last sync recorded"
                  : "Not synchronized"}
              </Badge>
            </div>
            <p>
              Sync sessions, fixed recurring routines, and deadline markers.
              Import events from the selected calendar and holidays from Google.
            </p>
            <div className="settings-actions">
              <button
                className="button secondary"
                disabled={
                  loading ||
                  busy ||
                  !auth ||
                  mode === "demo" ||
                  !health?.googleConfigured
                }
                onClick={() =>
                  action(async () => {
                    const r = await api("/api/google/connect", {});
                    window.location.assign(r.url);
                  })
                }
              >
                <Link2 size={14} />
                Connect Google
              </button>
              <button
                className="text-button"
                disabled={!auth || loading || busy || mode === "demo"}
                onClick={() => action(loadCalendars)}
              >
                Check connection
                <RefreshCw size={13} />
              </button>
            </div>
            {calendars.length > 0 && (
              <Field label="Calendar to synchronize">
                <select
                  value={state.settings.calendarId}
                  disabled={busy || loading}
                  onChange={(e) => {
                    const id = e.target.value;
                    const cal = calendars.find((c) => c.id === id);
                    if (
                      state.links.length &&
                      !confirm(
                        "Switch the calendar? Existing events in the previous calendar will be preserved. New syncs target the selected calendar.",
                      )
                    )
                      return;
                    update((s) => {
                      s.settings.calendarId = id;
                      s.settings.calendarName =
                        cal?.name || "Selected calendar";
                      s.settings.lastSync = null;
                      s.events = [];
                      audit(s, "Google calendar selection changed", "settings");
                    });
                  }}
                >
                  {!calendars.some(
                    (c) => c.id === state.settings.calendarId,
                  ) && (
                    <option value={state.settings.calendarId} disabled>
                      {state.settings.calendarName || "Previous calendar"}{" "}
                      (unavailable)
                    </option>
                  )}
                  {calendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <div className="google-holiday-setting">
              <label>
                <input
                  type="checkbox"
                  checked={state.settings.syncHolidays}
                  disabled={busy || loading || mode === "demo"}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    update((s) => {
                      s.settings.syncHolidays = enabled;
                      if (!enabled)
                        s.events = s.events.filter((event) => !event.holiday);
                      audit(
                        s,
                        enabled
                          ? "Enabled holiday sync"
                          : "Disabled holiday sync",
                        "settings",
                      );
                    });
                  }}
                />
                Include Google holiday calendars
              </label>
              <small className="muted">
                {holidays?.length ? holidays.join(", ") + ". " : ""}
                {holidays?.length === 0
                  ? "No visible Google holiday calendars found. "
                  : ""}
                Daylight imports holidays shown in Google Calendar. Holidays
                never block planning time.{" "}
                <a
                  href="https://support.google.com/calendar/answer/13748345"
                  target="_blank"
                  rel="noreferrer"
                >
                  Manage holidays in Google
                </a>
              </small>
            </div>
            <div className="settings-actions">
              <button
                className="button primary"
                onClick={sync}
                disabled={busy || loading || !auth || mode === "demo"}
              >
                <RefreshCw size={14} className={busy ? "spin" : ""} />
                {busy ? "Synchronizing…" : "Sync now"}
              </button>
              <button
                className="text-button danger"
                disabled={busy || loading || !auth || mode === "demo"}
                onClick={() => {
                  if (
                    !confirm(
                      "Disconnect Google? Existing calendar events will be preserved.",
                    )
                  )
                    return;
                  void action(async () => {
                    const r = await api("/api/google/disconnect", {});
                    update((s) => {
                      s.settings.lastSync = null;
                      s.events = [];
                    });
                    setCalendars([]);
                    setHolidays(null);
                    setMessage(
                      r.revoked
                        ? "Disconnected and Google permission revoked."
                        : "Daylight disconnected. Existing events and other saved Google connections were preserved.",
                    );
                  });
                }}
              >
                Disconnect
              </button>
            </div>
            <small className="muted">
              {state.settings.lastSync
                ? "Last complete snapshot: " +
                  new Date(state.settings.lastSync).toLocaleString()
                : "No live calendar data has been verified."}{" "}
              Daylight sends your changes to Google about 10 seconds after your
              last edit and checks Google for new events about once a minute and
              whenever you return to this tab. Use Sync now for a full check.
              Edits made to Daylight events in Google are flagged for review.
            </small>
            <p className="form-hint">
              Event sync covers the last 31 days and next 366 days. Holidays
              cover this year and next. Conflicts preserve both versions. Review
              conflicting event times in Google and Daylight before retrying.
            </p>
          </section>
          <section className="panel">
            <div className="settings-heading">
              <Sparkles size={19} />
              <h2>AI assessments</h2>
              <Badge
                tone={
                  aiCheck
                    ? aiCheck.success
                      ? "sage"
                      : "peach"
                    : health?.aiConfigured
                      ? "lavender"
                      : "neutral"
                }
              >
                {aiCheck
                  ? aiCheck.success
                    ? "Connection verified"
                    : "Connection failed"
                  : health?.aiConfigured
                    ? "Key loaded"
                    : "API key needed"}
              </Badge>
            </div>
            <p>
              {health?.aiConfigured
                ? `${health.aiProvider} · ${health.aiModel}. ${auth ? "AI runs only when you ask." : "Sign in above to enable AI actions."}`
                : "Google Gemini is ready to connect when you add an API key. Local evidence reviews remain available."}
            </p>
            <div className="settings-actions">
              <button
                className="button secondary"
                disabled={
                  !health?.aiConfigured || !auth || mode === "demo" || loading
                }
                onClick={() =>
                  void action(async () => {
                    setAiCheck(null);
                    try {
                      const result = await api("/api/ai/status", {});
                      setAiCheck({
                        success: true,
                        text: `Google accepted the Gemini key for ${result.model}. No content generated.`,
                      });
                    } catch (err) {
                      setAiCheck({
                        success: false,
                        text: (err as Error).message,
                      });
                    }
                  })
                }
              >
                Check Gemini connection
              </button>
            </div>
            {aiCheck && (
              <p
                className={aiCheck.success ? "form-hint" : "error"}
                role={aiCheck.success ? "status" : "alert"}
              >
                {aiCheck.text}
              </p>
            )}
            <small className="muted">
              Structured evidence, versioned instructions, validated responses.
              No automatic rescheduling or milestone approval.
            </small>
          </section>
        </div>
        <section className="panel backup-panel">
          <div className="settings-heading">
            <ShieldCheck size={20} />
            <h2>Your work belongs to you</h2>
          </div>
          <p>
            Export every task, project, outcome, review, and approval. Backups
            contain your personal planning data; keep them somewhere private.
          </p>
          <div className="settings-actions">
            <button
              className="button secondary"
              onClick={() => {
                download("daylight-backup-" + dayKey() + ".json", state);
                notify("Backup exported.");
              }}
            >
              <Download size={15} />
              Export workspace
            </button>
            <label className="button secondary file-button">
              <Upload size={15} />
              Import backup
              <input
                type="file"
                accept="application/json,.json"
                disabled={busy}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    if (file.size > 5_000_000)
                      throw new Error("Backup exceeds the 5 MB import limit.");
                    const raw = JSON.parse(await file.text()),
                      imported = validateReferences(
                        stateSchema.parse(raw.state || raw),
                      );
                    if (
                      !confirm(
                        "Replace this workspace with the imported backup? A backup of the current workspace will download first.",
                      )
                    )
                      return;
                    download(
                      "daylight-before-import-" + Date.now() + ".json",
                      state,
                    );
                    update((s) => {
                      Object.assign(s, imported);
                      s.events = [];
                      s.links = [];
                      s.settings.lastSync = null;
                      audit(
                        s,
                        "Workspace restored from user-selected backup",
                        "workspace",
                      );
                    });
                    notify(
                      "Backup imported. Calendar links were cleared; reconnect and review before syncing.",
                    );
                  } catch (err) {
                    setError(
                      (err as Error).name === "ZodError"
                        ? "This file is not a valid Daylight backup."
                        : (err as Error).message,
                    );
                  }
                  e.target.value = "";
                }}
              />
            </label>
            <button
              className="text-button"
              onClick={() =>
                download("daylight-raw-recovery.json", workspace.exportRaw())
              }
            >
              Export raw recovery copy
            </button>
          </div>
          <small className="muted">
            Import never imports Google credentials. Those stay encrypted on the
            server.
          </small>
        </section>
        <section className="panel">
          <div className="settings-heading">
            <Check size={19} />
            <h2>Recent record changes</h2>
          </div>
          {state.audit.length ? (
            <div className="audit-list">
              {state.audit
                .slice(-8)
                .reverse()
                .map((a) => (
                  <div key={a.id}>
                    <span>{a.action}</span>
                    <small>{new Date(a.at).toLocaleString()}</small>
                  </div>
                ))}
            </div>
          ) : (
            <p>Approvals and record changes will appear here.</p>
          )}
        </section>
      </div>
      {message && (
        <div className="notice settings-message" role="status">
          <Check size={16} />
          {message}
        </div>
      )}
      {error && (
        <div className="error settings-message" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
