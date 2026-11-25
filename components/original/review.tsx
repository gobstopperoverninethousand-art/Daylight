"use client";
import {
  confirmReviewReplacement,
  reviewContextBefore,
  saveDatedReview,
} from "@/lib/review-history";
import { DailyReviewDialog } from "./daily-review-dialog";
import { progressDestinations } from "@/lib/progress-update";
import { useState } from "react";
import {
  Sparkles,
  Check,
  ArrowRight,
  Clock3,
  FileText,
  ChevronDown,
  CalendarDays,
} from "lucide-react";
import {
  State,
  Outcome,
  addDays,
  formatDate,
  durationLabel,
  displayTime,
  uid,
  Review,
  audit,
} from "@/lib/model";
import {
  makeSnapshot,
  assess,
  RULE_VERSION,
  projectHealth,
} from "@/lib/engine";
import { ViewProps } from "./work-views";
import { deadlineEntries } from "@/lib/deadlines";
import { evidenceKey, workspaceDay } from "@/lib/ai-freshness";
import { Badge, Field, OutcomeSelect, Empty, SectionHead } from "./ui";
export function Progress({
  state,
  update,
  edit,
  notify,
  setOutcome,
  api,
  aiReady,
  initialDate,
}: {
  state: State;
  update: ViewProps["update"];
  edit: ViewProps["edit"];
  notify: ViewProps["notify"];
  setOutcome: (kind: string, id: string, date: string, value: Outcome) => void;
  api: (path: string, body?: unknown, method?: string) => Promise<any>;
  aiReady: boolean;
  initialDate?: string;
}) {
  const [commitmentKey, setCommitmentKey] = useState("");
  const [date, setDate] = useState(() => initialDate ?? workspaceDay(state)),
    [answers, setAnswers] = useState<{
      focus?: string;
      blocker?: string;
      accomplishment?: string;
    }>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [tab, setTab] = useState<"today" | "history" | "week">("today");
  const sessions = state.sessions.filter((s) => s.date === date),
    review = state.reviews
      .filter((r) => r.date === date)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0],
    needsBlocker = sessions.some((s) => s.outcome === "blocked" && !s.note);
  const focus = answers.focus ?? review?.focus ?? "";
  const blocker = answers.blocker ?? review?.blocker ?? "";
  const accomplishment = answers.accomplishment ?? review?.accomplishment ?? "";
  const setFocus = (focus: string) => setAnswers((a) => ({ ...a, focus }));
  const setBlocker = (blocker: string) =>
    setAnswers((a) => ({ ...a, blocker }));
  const setAccomplishment = (accomplishment: string) =>
    setAnswers((a) => ({ ...a, accomplishment }));
  const inputKey = evidenceKey(state, date, [focus, blocker, accomplishment]);
  const stale = review && review.inputKey !== inputKey;
  const completed = sessions.filter((s) => s.outcome === "completed").length,
    confirmed = sessions.filter((s) => s.outcome !== "pending").length;
  const [editing, setEditing] = useState(false);
  async function generate(_useAI: boolean) {
    setEditing(true);
  }
  return (
    <>
      {editing && (
        <DailyReviewDialog
          state={state}
          date={date}
          aiReady={aiReady}
          api={api}
          update={update}
          onClose={() => setEditing(false)}
        />
      )}
      <button className="button primary" onClick={() => setEditing(true)}>
        Write or edit progress update
      </button>
      <div className="review-toolbar">
        <div className="tab-row">
          {(
            [
              ["today", "Daily review"],
              ["week", "Weekly accumulation"],
              ["history", "Review history"],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              onClick={() => setTab(v)}
              className={tab === v ? "active" : ""}
            >
              {l}
            </button>
          ))}
        </div>
        <label className="date-picker">
          <CalendarDays size={16} />
          <input
            type="date"
            aria-label="Review date"
            max={workspaceDay(state)}
            value={date}
            onChange={(e) => {
              if (!e.target.value) return;
              setAnswers({});
              setCommitmentKey("");
              setDate(e.target.value);
            }}
          />
        </label>
      </div>
      {tab === "today" ? (
        review ? (
          <Report review={review} />
        ) : (
          <p>
            No confirmed report for this date. Write an update to get started.
          </p>
        )
      ) : tab === "history" ? (
        <div className="history-list">
          {state.reviews.length ? (
            state.reviews
              .slice()
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((r) => (
                <details key={r.id} className="history-item">
                  <summary>
                    <span>
                      <FileText size={17} />
                      <strong>
                        {formatDate(r.date, {
                          month: "long",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </strong>
                      <small>
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
            <Empty
              title="Your progress story starts here."
              description="Saved reviews will appear here with the evidence used to create them."
            />
          )}
        </div>
      ) : (
        <WeeklyProgress state={state} date={date} />
      )}
    </>
  );
}
export function Report({ review }: { review: Review }) {
  const a = review.assessment;
  if (
    ["confirmed-progress-v1", "confirmed-progress-v2"].includes(review.version)
  )
    return (
      <article className="report">
        <h2>{formatDate(review.date, { month: "long", day: "numeric" })}</h2>
        {review.version !== "confirmed-progress-v2" && (
          <p style={{ whiteSpace: "pre-wrap" }}>{review.accomplishment}</p>
        )}
        {Array.isArray(review.snapshot.verified_updates) &&
          review.snapshot.verified_updates.map(
            (
              item: { key: string; note: string; label?: string },
              index: number,
            ) => (
              <div key={index}>
                <small>{item.label || "Daily report"}</small>
                <p style={{ whiteSpace: "pre-wrap" }}>{item.note}</p>
              </div>
            ),
          )}
        {typeof review.snapshot.daily_overview === "string" && (
          <section>
            <h3>Today’s overall progress</h3>
            <p style={{ whiteSpace: "pre-wrap" }}>
              {review.snapshot.daily_overview}
            </p>
          </section>
        )}
      </article>
    );
  return (
    <article className="report">
      <div className="report-head">
        <span className="report-mark">
          <Sparkles size={21} />
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
          Evidence & uncertainty
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
      <h2>
        Weekly progress · {formatDate(weekStart)} — {formatDate(date)}
      </h2>
      <p>Your confirmed daily updates, accumulated in full.</p>
      {reports.length ? (
        reports.map((r) => (
          <article key={r.id} className="report">
            <h3>{formatDate(r.date)}</h3>
            <p style={{ whiteSpace: "pre-wrap" }}>
              {typeof r.snapshot.confirmed_interpretation === "string"
                ? r.snapshot.confirmed_interpretation
                : r.accomplishment}
            </p>
            {typeof r.snapshot.daily_overview === "string" && (
              <>
                <h4>Overall progress</h4>
                <p style={{ whiteSpace: "pre-wrap" }}>
                  {r.snapshot.daily_overview}
                </p>
              </>
            )}
            {(r.commitmentUpdates ?? []).map((u, i) => (
              <div key={i}>
                <strong>{destinations.get(u.key) ?? u.key}</strong>
                <p style={{ whiteSpace: "pre-wrap" }}>{u.note}</p>
              </div>
            ))}
          </article>
        ))
      ) : (
        <p>No confirmed updates in this period.</p>
      )}
    </section>
  );
}
