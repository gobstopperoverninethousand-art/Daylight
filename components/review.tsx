"use client";
import { DailyReviewDialog } from "./daily-review-dialog";
import { progressDestinations } from "@/lib/progress-update";
import { useState } from "react";
import {
  Sparkles,
  ArrowRight,
  FileText,
  ChevronDown,
  CalendarDays,
  PenLine,
} from "lucide-react";
import {
  State,
  Outcome,
  addDays,
  formatDate,
  Review,
} from "@/lib/model";
import {
  DEFAULT_EXPERIENCE,
  isWildExperience,
  type ExperienceId,
} from "@/lib/experiences";
import { ViewProps, PageHeading } from "./work-views";
import { WildProgressView } from "./wild-work-views";
import { workspaceDay } from "@/lib/ai-freshness";
import { Badge, Empty } from "./ui";

export function Progress({
  state,
  update,
  edit,
  notify,
  setOutcome,
  scheduleTask,
  onNavigatePlanner,
  experience = DEFAULT_EXPERIENCE,
  api,
  aiReady,
  initialDate,
}: {
  state: State;
  update: ViewProps["update"];
  edit: ViewProps["edit"];
  notify: ViewProps["notify"];
  setOutcome: (kind: string, id: string, date: string, value: Outcome) => void;
  scheduleTask?: ViewProps["scheduleTask"];
  onNavigatePlanner?: ViewProps["onNavigatePlanner"];
  experience?: ExperienceId;
  api: (path: string, body?: unknown, method?: string) => Promise<any>;
  aiReady: boolean;
  initialDate?: string;
}) {
  const [date, setDate] = useState(() => initialDate ?? workspaceDay(state)),
    [tab, setTab] = useState<"today" | "history" | "week">("today"),
    [editing, setEditing] = useState(false);

  if (isWildExperience(experience)) {
    return (
      <WildProgressView
        experience={experience}
        state={state}
        update={update}
        edit={edit}
        notify={notify}
        setOutcome={setOutcome}
        scheduleTask={scheduleTask ?? (() => {})}
        onNavigatePlanner={onNavigatePlanner ?? (() => {})}
        api={api}
        aiReady={aiReady}
        initialDate={initialDate}
      />
    );
  }

  const sortedReviews = state.reviews
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const review = sortedReviews.find((r) => r.date === date);

  const dialog = editing && (
    <DailyReviewDialog
      state={state}
      date={date}
      aiReady={aiReady}
      api={api}
      update={update}
      onClose={() => setEditing(false)}
    />
  );

  const toolbar = (
    <div className="review-toolbar">
      <div className="tab-row" role="group" aria-label="Progress views">
        {(
          [
            ["today", experience === "bauhaus" ? "01 Daily review" : "Daily review"],
            ["week", experience === "bauhaus" ? "02 Weekly window" : "Weekly accumulation"],
            ["history", experience === "bauhaus" ? "03 Archive" : "Review history"],
          ] as const
        ).map(([v, l]) => (
          <button
            type="button"
            key={v}
            onClick={() => setTab(v)}
            aria-pressed={tab === v}
            className={tab === v ? "active" : ""}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="review-toolbar-actions">
        <label className="date-picker">
          <CalendarDays size={15} />
          <input
            type="date"
            aria-label="Review date"
            max={workspaceDay(state)}
            value={date}
            onChange={(e) => {
              if (!e.target.value) return;
              setDate(e.target.value);
            }}
          />
        </label>
        <button
          type="button"
          className="button primary"
          onClick={() => setEditing(true)}
        >
          <PenLine size={15} />
          Write or edit progress update
        </button>
      </div>
    </div>
  );

  const content =
    tab === "today" ? (
      review ? (
        <Report review={review} />
      ) : (
        <div className="panel review-empty-panel">
          <Empty
            title={`No confirmed report for ${formatDate(date, { month: "long", day: "numeric" })}`}
            description="Write an update describing what moved forward, blockers, or scope changes to generate a verified daily record."
            label="Write progress update"
            action={() => setEditing(true)}
          />
        </div>
      )
    ) : tab === "history" ? (
      <div className="history-list">
        {sortedReviews.length ? (
          sortedReviews.map((r) => (
            <details key={r.id} className="history-item">
              <summary>
                <span>
                  <FileText size={16} />
                  <strong>
                    {formatDate(r.date, {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </strong>
                  <small className="tabular-num">
                    {new Date(r.createdAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </small>
                </span>
                <Badge tone={r.source === "ai" ? "lavender" : "neutral"}>
                  {r.source === "ai" ? "AI assessment" : "Rules-based"}
                </Badge>
              </summary>
              <Report review={r} />
            </details>
          ))
        ) : (
          <div className="panel">
            <Empty
              title="Your progress story starts here."
              description="Saved reviews will appear here with the evidence used to create them."
              label="Write progress update"
              action={() => setEditing(true)}
            />
          </div>
        )}
      </div>
    ) : (
      <WeeklyProgress state={state} date={date} />
    );

  if (experience === "cockpit") {
    return (
      <div className="classic-work is-cockpit">
        {dialog}
        <PageHeading
          eyebrow="SYSTEM LOGBOOK"
          title="Progress Telemetry"
          subtitle="Select any daily entry in the index or write a confirmed daily log."
        />
        {toolbar}
        <div className="cockpit-master-detail">
          <aside className="cockpit-master-list panel" aria-label="Saved records index">
            <div className="wild-subhead">
              <strong>Recorded Dates</strong>
              <span className="tabular-num">{sortedReviews.length}</span>
            </div>
            {sortedReviews.length ? (
              <div className="cockpit-proj-rows">
                {sortedReviews.map((r) => (
                  <button
                    type="button"
                    key={r.id}
                    className={
                      "project-open " + (r.date === date ? "is-selected" : "")
                    }
                    onClick={() => {
                      setDate(r.date);
                      setTab("today");
                    }}
                  >
                    <div className="cockpit-entry-row">
                      <strong className="tabular-num">{formatDate(r.date)}</strong>
                      <small>{r.source === "ai" ? "AI" : "Manual"}</small>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">No saved daily records yet.</p>
            )}
          </aside>
          <div className="cockpit-detail-canvas">{content}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        "classic-work is-" +
        experience +
        (experience === "zen" ? " zen-centered-sheet" : "")
      }
    >
      {dialog}
      <PageHeading
        eyebrow={
          experience === "broadsheet"
            ? "CHRONICLE & REFLECTION"
            : experience === "bauhaus"
              ? "LOG 05 // REFLECTION"
              : "PROGRESS & REFLECTION"
        }
        title={
          experience === "broadsheet"
            ? "Progress Dispatch"
            : experience === "zen"
              ? "Evening Reflection"
              : "Progress"
        }
        subtitle="Write what moved forward in your own words, verify project connections, and build daily & weekly records."
      />
      {toolbar}
      {content}
    </div>
  );
}

export function Report({ review }: { review: Review }) {
  const a = review.assessment;
  if (
    ["confirmed-progress-v1", "confirmed-progress-v2"].includes(review.version)
  )
    return (
      <article className="report">
        <div className="report-head">
          <span className="report-mark">
            <FileText size={19} />
          </span>
          <div>
            <span className="eyebrow">CONFIRMED DAILY RECORD</span>
            <h2>
              {formatDate(review.date, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </h2>
          </div>
          <Badge tone={review.source === "ai" ? "lavender" : "neutral"}>
            {review.source === "ai" ? "AI assisted" : "Manual"}
          </Badge>
        </div>
        {review.version !== "confirmed-progress-v2" && (
          <p className="report-body-text">{review.accomplishment}</p>
        )}
        {Array.isArray(review.snapshot.verified_updates) && (
          <div className="verified-updates-list">
            {review.snapshot.verified_updates.map(
              (
                item: { key: string; note: string; label?: string },
                index: number,
              ) => (
                <div className="verified-update-item" key={index}>
                  <span className="eyebrow">
                    {item.label || "Daily report"}
                  </span>
                  <p className="report-body-text">{item.note}</p>
                </div>
              ),
            )}
          </div>
        )}
        {typeof review.snapshot.daily_overview === "string" && (
          <section className="next-action">
            <span>TODAY’S OVERALL PROGRESS</span>
            <p className="report-body-text">{review.snapshot.daily_overview}</p>
          </section>
        )}
      </article>
    );

  return (
    <article className="report">
      <div className="report-head">
        <span className="report-mark">
          <Sparkles size={19} />
        </span>
        <div>
          <span className="eyebrow">YOUR DAILY PERSPECTIVE</span>
          <h2>{formatDate(review.date, { month: "long", day: "numeric" })}</h2>
        </div>
        <Badge tone={review.source === "ai" ? "lavender" : "neutral"}>
          {review.source === "ai" ? "AI" : "Rules-based"}
        </Badge>
      </div>
      <Badge
        tone={
          ["at-risk", "blocked"].includes(a.pacing_status)
            ? "peach"
            : a.pacing_status === "on-track"
              ? "sage"
              : "neutral"
        }
      >
        {a.pacing_status.replaceAll("-", " ")}
      </Badge>
      {typeof review.snapshot.earlier_report_changed === "string" && (
        <p className="form-hint" role="status">
          An earlier progress report changed (
          {review.snapshot.earlier_report_changed}). Your answers are preserved;
          this assessment needs refresh.
        </p>
      )}
      <h3 className="report-summary">{a.summary}</h3>
      <div className="report-section">
        <span>TIME USE</span>
        <p>{a.time_use_observation}</p>
      </div>
      <div className="report-section">
        <span>FOCUS · SELF-REPORTED</span>
        <p>{a.focus_observation}</p>
      </div>
      <div className="next-action">
        <span>
          <ArrowRight size={15} />
          YOUR NEXT STEP
        </span>
        <p>{a.next_action}</p>
      </div>
      <details className="report-details">
        <summary>
          Evidence &amp; uncertainty
          <ChevronDown size={15} />
        </summary>
        <h4>Recorded evidence</h4>
        <ul>
          {a.evidence.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
        {a.missing_information.length > 0 && (
          <>
            <h4>Still unknown</h4>
            <ul>
              {a.missing_information.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </>
        )}
        {a.questions_if_needed.length > 0 && (
          <>
            <h4>Useful follow-ups</h4>
            <ul>
              {a.questions_if_needed.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </>
        )}
        <small>
          {review.version} · {new Date(review.createdAt).toLocaleString()}
        </small>
        <details>
          <summary>Structured input snapshot</summary>
          <pre>{JSON.stringify(review.snapshot, null, 2)}</pre>
        </details>
      </details>
    </article>
  );
}

export function WeeklyProgress({
  state,
  date,
}: {
  state: State;
  date: string;
}) {
  const weekStart = addDays(date, -6);
  const reports = state.reviews
    .filter((r) => r.date >= weekStart && r.date <= date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const destinations = new Map(
    progressDestinations(state).map((d) => [d.key, d.label]),
  );
  return (
    <section className="weekly-panel">
      <div className="weekly-header panel">
        <span className="eyebrow">7-DAY WINDOW</span>
        <h2>
          {formatDate(weekStart)} — {formatDate(date)}
        </h2>
        <p>Your confirmed daily updates, accumulated in full.</p>
      </div>
      {reports.length ? (
        <div className="weekly-reports-stack">
          {reports.map((r) => (
            <article key={r.id} className="report">
              <h3>
                {formatDate(r.date, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </h3>
              <p className="report-body-text">
                {typeof r.snapshot.confirmed_interpretation === "string"
                  ? r.snapshot.confirmed_interpretation
                  : r.accomplishment}
              </p>
              {typeof r.snapshot.daily_overview === "string" && (
                <div className="weekly-overview-block">
                  <span className="eyebrow">OVERALL PROGRESS</span>
                  <p className="report-body-text">
                    {r.snapshot.daily_overview}
                  </p>
                </div>
              )}
              {(r.commitmentUpdates ?? []).map((u, i) => (
                <div className="verified-update-item" key={i}>
                  <strong>{destinations.get(u.key) ?? u.key}</strong>
                  <p className="report-body-text">{u.note}</p>
                </div>
              ))}
            </article>
          ))}
        </div>
      ) : (
        <div className="panel">
          <p>No confirmed updates in this period.</p>
        </div>
      )}
    </section>
  );
}
