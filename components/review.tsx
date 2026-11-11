"use client";
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
  dayKey,
  addDays,
  formatDate,
  durationLabel,
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
import { PageHeading, ViewProps } from "./work-views";
import { evidenceKey } from "@/lib/ai-freshness";
import { Badge, Field, OutcomeSelect, Empty, SectionHead } from "./ui";
export function Progress({
  state,
  update,
  edit,
  notify,
  setOutcome,
  api,
  aiReady,
}: {
  state: State;
  update: ViewProps["update"];
  edit: ViewProps["edit"];
  notify: ViewProps["notify"];
  setOutcome: (kind: string, id: string, date: string, value: Outcome) => void;
  api: (path: string, body?: unknown, method?: string) => Promise<any>;
  aiReady: boolean;
}) {
  const [date, setDate] = useState(dayKey()),
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
  async function generate(useAI: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const snapshot = makeSnapshot(
        state,
        date,
        focus,
        blocker,
        accomplishment,
      );
      const result = useAI
        ? await api("/api/review", {
            state,
            date,
            focus,
            blocker,
            accomplishment,
          })
        : { assessment: assess(snapshot), snapshot, version: RULE_VERSION };
      const record: Review = {
        id: uid(),
        date,
        createdAt: new Date().toISOString(),
        source: useAI ? "ai" : "rules",
        version: result.version,
        inputKey,
        focus,
        blocker,
        accomplishment,
        assessment: result.assessment,
        snapshot: result.snapshot,
      };
      update((s) => {
        s.reviews.push(record);
        audit(
          s,
          "Daily " + (useAI ? "AI" : "rules-based") + " assessment saved",
          record.id,
        );
      });
      notify("Review saved. Tomorrow’s planning can use this evidence.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const weekStart = addDays(date, -6),
    weekReviews = state.reviews.filter(
      (r) => r.date >= weekStart && r.date <= date,
    ),
    weekSessions = state.sessions.filter(
      (s) => s.date >= weekStart && s.date <= date,
    );
  return (
    <>
      <PageHeading
        eyebrow="NOTICE WHAT MOVED FORWARD"
        title="A moment to take stock."
        subtitle="A few honest signals. A clearer next step. Then let the day be done."
      />
      <div className="review-toolbar">
        <div className="tab-row">
          {(
            [
              ["today", "Daily review"],
              ["week", "Seven-day summary"],
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
            max={dayKey()}
            value={date}
            onChange={(e) => {
              if (!e.target.value) return;
              setAnswers({});
              setDate(e.target.value);
            }}
          />
        </label>
      </div>
      {tab === "today" ? (
        <div className="review-layout">
          <div>
            <section className="panel review-evidence">
              <SectionHead
                title="The day, as recorded"
                subtitle={formatDate(date, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              />
              <div className="review-counts">
                <div>
                  <strong>{sessions.length}</strong>
                  <span>planned sessions</span>
                </div>
                <div>
                  <strong>{confirmed}</strong>
                  <span>confirmed outcomes</span>
                </div>
                <div>
                  <strong>{completed}</strong>
                  <span>completed sessions</span>
                </div>
              </div>
              {sessions.length ? (
                <div className="review-sessions">
                  {sessions.map((s) => (
                    <div className="review-session" key={s.id}>
                      <div>
                        <button
                          className="plain"
                          onClick={() => edit({ kind: "session", id: s.id })}
                        >
                          <strong>
                            {state.tasks.find((t) => t.id === s.taskId)?.title}
                          </strong>
                        </button>
                        <small>
                          {durationLabel(s.duration)} planned ·{" "}
                          {s.actualMinutes === null
                            ? "actual time unknown"
                            : durationLabel(s.actualMinutes) + " self-reported"}
                        </small>
                        {s.note && <p>{s.note}</p>}
                      </div>
                      <OutcomeSelect
                        value={s.outcome}
                        onChange={(v) =>
                          setOutcome("session", s.id, date, v as Outcome)
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="inline-empty">
                  No sessions scheduled on this day. You can still record a
                  brief update.
                </div>
              )}
              <p className="form-hint">
                Scheduled time is a plan. Only your confirmed outcomes are
                evidence of what happened.
              </p>
            </section>
            <section className="panel quick-check">
              <SectionHead
                title="Anything the records missed?"
                subtitle="Optional. Skip what doesn’t help today’s assessment."
              />
              <div className="form-grid">
                <Field label="Focus?">
                  <select
                    value={focus}
                    onChange={(e) => setFocus(e.target.value)}
                  >
                    <option value="">Not reported</option>
                    <option>Focused</option>
                    <option>Mixed</option>
                    <option>Distracted</option>
                  </select>
                </Field>
                <Field
                  label={needsBlocker ? "Main blocker?" : "Blocker · if any"}
                >
                  <select
                    value={
                      [
                        "",
                        "Technical issue",
                        "Waiting on someone",
                        "Time ran short",
                        "Unclear next step",
                      ].includes(blocker)
                        ? blocker
                        : "Other"
                    }
                    onChange={(e) =>
                      setBlocker(
                        e.target.value === "Other" ? "Other" : e.target.value,
                      )
                    }
                  >
                    <option value="">None reported</option>
                    <option>Technical issue</option>
                    <option>Waiting on someone</option>
                    <option>Time ran short</option>
                    <option>Unclear next step</option>
                    <option>Other</option>
                  </select>
                </Field>
              </div>
              {blocker === "Other" && (
                <Field label="One sentence · optional">
                  <input
                    placeholder="What got in the way?"
                    onBlur={(e) => e.target.value && setBlocker(e.target.value)}
                    maxLength={4000}
                  />
                </Field>
              )}
              <Field label="What changed?">
                <input
                  placeholder="A concrete accomplishment or important update…"
                  maxLength={4000}
                  value={accomplishment}
                  onChange={(e) => setAccomplishment(e.target.value)}
                />
              </Field>
              {stale && (
                <p className="form-hint" role="status">
                  <Badge tone="peach">Needs refresh</Badge> The saved review is
                  still here. Refresh when you’re ready to use the new evidence.
                </p>
              )}
              <div className="review-generate">
                <button
                  className="button primary"
                  onClick={() => generate(aiReady)}
                  disabled={busy}
                >
                  <Sparkles size={16} />
                  {busy
                    ? "Reviewing your day…"
                    : aiReady
                      ? review
                        ? "Refresh review with AI"
                        : "Review my day with AI"
                      : review
                        ? "Refresh local review"
                        : "Create evidence review"}
                </button>
                {aiReady && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => generate(false)}
                  >
                    Use local rules
                  </button>
                )}
              </div>
              <small className="muted">
                {aiReady
                  ? "This sends the day’s structured records to your configured AI provider."
                  : "AI is not connected. The local review uses transparent calculations and recorded evidence."}{" "}
                {review ? "Earlier versions remain in history." : ""}
              </small>
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
            </section>
          </div>
          <aside>
            {review ? (
              <Report review={review} />
            ) : (
              <div className="review-placeholder">
                <div className="report-illustration">
                  <span className="sun-doodle">☼</span>
                  <div>
                    <i />
                    <i />
                    <i />
                  </div>
                  <Check size={20} />
                </div>
                <h2>Progress deserves perspective.</h2>
                <p>
                  Your daily review will connect what happened with what comes
                  next.
                </p>
                <div>
                  <Check size={14} />
                  Meaningful work, not a productivity score
                </div>
                <div>
                  <Check size={14} />
                  Clear evidence and honest uncertainty
                </div>
                <div>
                  <Check size={14} />
                  One practical next step
                </div>
              </div>
            )}
          </aside>
        </div>
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
        <>
          <div className="panel weekly-panel">
            <span className="eyebrow">
              {formatDate(weekStart)} — {formatDate(date)} · ON-DEMAND SUMMARY
            </span>
            <h2>A week of small steps.</h2>
            <div className="review-counts">
              <div>
                <strong>
                  {weekSessions.filter((s) => s.outcome !== "pending").length}
                </strong>
                <span>confirmed session outcomes</span>
              </div>
              <div>
                <strong>
                  {state.tasks.filter(
                    (t) =>
                      t.completedAt &&
                      t.completedAt.slice(0, 10) >= weekStart &&
                      t.completedAt.slice(0, 10) <= date,
                  ).length +
                    state.routineRecords.filter(
                      (r) =>
                        r.date >= weekStart &&
                        r.date <= date &&
                        r.outcome === "completed",
                    ).length}
                </strong>
                <span>tasks and routines completed</span>
              </div>
              <div>
                <strong>{new Set(weekReviews.map((r) => r.date)).size}</strong>
                <span>days reviewed</span>
              </div>
            </div>
            <p>
              {weekSessions.filter((s) => s.outcome === "blocked").length}{" "}
              blocked sessions ·{" "}
              {weekSessions.filter((s) => s.outcome === "pending").length}{" "}
              unconfirmed sessions. Planned duration has not been counted as
              actual work.
            </p>
            <p>
              {
                state.routineRecords.filter(
                  (r) =>
                    r.date >= weekStart &&
                    r.date <= date &&
                    r.outcome === "completed",
                ).length
              }{" "}
              routine occurrences confirmed completed.
            </p>
          </div>
          <div className="weekly-projects">
            {state.projects
              .filter((p) => p.status === "active")
              .map((p) => (
                <div className="panel" key={p.id}>
                  <Badge>{projectHealth(state, p, date).label}</Badge>
                  <h3>{p.title}</h3>
                  <p>{projectHealth(state, p, date).reason}</p>
                </div>
              ))}
          </div>
        </>
      )}
    </>
  );
}
function Report({ review }: { review: Review }) {
  const a = review.assessment;
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
