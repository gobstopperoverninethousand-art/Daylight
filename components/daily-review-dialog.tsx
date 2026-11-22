"use client";
import { useState, useEffect, useRef } from "react";
import { Dialog, Field } from "./ui";
import { type State, type Review, uid, audit, formatDate } from "@/lib/model";
import { workspaceDay } from "@/lib/ai-freshness";
import {
  confirmReviewReplacement,
  reviewContextBefore,
  saveDatedReview,
} from "@/lib/review-history";
import {
  progressDestinations,
  projectForKeys,
  interpretationSchema,
} from "@/lib/progress-update";
import { Report } from "./review";
export function DailyReviewDialog({
  state,
  date: initialDate,
  aiReady,
  api,
  update,
  onClose,
}: {
  state: State;
  date: string;
  aiReady: boolean;
  api: (path: string, body: unknown) => Promise<any>;
  update: (fn: (s: State) => void) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(initialDate);
  const [raw, setRaw] = useState(
    state.reviews.find((r) => r.date === initialDate)?.accomplishment ?? "",
  );
  const [interpretation, setInterpretation] = useState("");
  const [updates, setUpdates] = useState<
    { keys: string[]; note: string; projectId: string }[]
  >([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Review | null>(null);
  const destinations = updates.map((update) =>
    progressDestinations(state, date, update.projectId),
  );
  const source = JSON.stringify({ date, updates });
  const [overviewSource, setOverviewSource] = useState("");
  const [overviewError, setOverviewError] = useState("");
  const [retry, setRetry] = useState(0);
  const apiRef = useRef(api);
  apiRef.current = api;
  const stateRef = useRef(state);
  stateRef.current = state;
  const overviewCurrent = overviewSource === source;
  useEffect(() => {
    if (step !== 1 || overviewSource === source) return;
    let cancelled = false;
    setOverviewError("");
    if (!updates.length || updates.some((update) => !update.note.trim()))
      return;
    const timer = setTimeout(async () => {
      try {
        const result = aiReady
          ? await apiRef.current("/api/review", {
              mode: "overview",
              state: stateRef.current,
              date,
              updates,
            })
          : { overview: updates.map((update) => update.note.trim()).join(" ") };
        if (!cancelled) {
          setInterpretation(result.overview);
          setOverviewSource(source);
        }
      } catch (error) {
        if (!cancelled) setOverviewError((error as Error).message);
      }
    }, 3000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source, step, aiReady, retry, overviewSource]);
  async function interpret(refine = false) {
    setBusy(true);
    setError("");
    try {
      const result = aiReady
        ? interpretationSchema.parse(
            await api("/api/review", {
              state: reviewContextBefore(state, date),
              date,
              accomplishment: refine
                ? updates.map((u) => u.note).join("\n\n")
                : raw,
              ...(refine
                ? {
                    confirmedInterpretation: updates
                      .map((u) => u.note)
                      .join("\n\n"),
                    followUps: questions.map((question, i) => ({
                      question,
                      answer: answers[i] ?? "",
                    })),
                  }
                : {}),
            }),
          )
        : { overview: raw, questions: [], updates: [{ keys: [], note: raw }] };
      const organized = result.updates.map((update) => ({
        ...update,
        projectId: projectForKeys(state, update.keys),
      }));
      setInterpretation(result.overview);
      setOverviewSource(JSON.stringify({ date, updates: organized }));
      setUpdates(organized);
      setQuestions(refine ? [] : result.questions);
      setAnswers([]);
      setStep(1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function save() {
    setError("");
    try {
      if (!overviewCurrent)
        throw Error("Wait for the overview to update before saving.");
      const expected = confirmReviewReplacement(state, date);
      if (expected === null) return;
      const account = updates.map((u) => u.note.trim()).join("\n\n");
      if (
        !account ||
        !interpretation.trim() ||
        updates.some((u) => !u.note.trim())
      )
        throw Error("Check the account and each update before saving.");
      const keys = new Set(
        destinations.flatMap((list) => list.map((d) => d.key)),
      );
      if (updates.some((u) => u.keys.some((key) => !keys.has(key))))
        throw Error("A destination changed. Check the connections.");
      const record: Review = {
        id: uid(),
        date,
        createdAt: new Date().toISOString(),
        source: aiReady ? "ai" : "rules",
        version: "confirmed-progress-v2",
        focus: "",
        blocker: "",
        accomplishment: account,
        commitmentUpdates: updates.flatMap((u) =>
          [...new Set(u.keys)].map((key) => ({ key, note: u.note.trim() })),
        ),
        assessment: {
          pacing_status: "insufficient-information",
          summary: "",
          time_use_observation: "",
          focus_observation: "",
          evidence: [],
          missing_information: [],
          next_action: "",
          questions_if_needed: [],
        },
        snapshot: {
          confirmed_interpretation: account,
          daily_overview: interpretation.trim(),
          verified_updates: updates.map((u, index) => ({
            ...u,
            label:
              u.keys
                .map(
                  (key) =>
                    destinations[index].find((d) => d.key === key)?.label ??
                    key,
                )
                .join(" · ") || "Daily report",
            note: u.note.trim(),
          })),
        },
      };
      update((s) => {
        saveDatedReview(s, record, expected);
        audit(s, "Confirmed progress update saved", record.id);
      });
      setRaw("");
      setAnswers([]);
      setSaved(record);
      setStep(2);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Dialog
      wide
      closeOnly
      title={
        step === 0
          ? "Progress update"
          : step === 1
            ? "Verify your update and connections"
            : "Saved progress report"
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {step === 0 && (
        <>
          <Field label="Report date">
            <input
              type="date"
              max={workspaceDay(state)}
              value={date}
              onChange={(e) => {
                if (e.target.value) setDate(e.target.value);
              }}
            />
          </Field>
          <Field label="What moved forward, what remains, and what else matters?">
            <textarea
              rows={8}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
          </Field>
          <p className="form-hint">
            Describe what you worked on, finished, or left unfinished, and how
            it went. Mention work that was easier, harder, better, or less
            successful than expected; changed scope or estimates; blockers or
            dependencies; and anything postponed and why. Include approaching
            deadlines, changed requirements, or limited future availability. If
            you made enough progress to leave something alone for a while, say
            so. Name the task, milestone, deadline or project when you can. You
            may discuss several pieces of work and miscellaneous context in one
            update. These are optional suggestions, not questions you must all
            answer.
          </p>
        </>
      )}
      {step === 1 && (
        <>
          <p className="report-date-badge">Report date · {formatDate(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
          <p className="form-hint">
            Edit each organized update below. Its final text saves to every
            selected destination and to the daily and weekly reports. The
            overview is separate and saves only to daily and weekly reports.
          </p>
          {updates.map((u, i) => (
            <section className="organized-update" key={i}>
              <div className="update-left">
              <Field label={`Update ${i + 1}`}>
                <textarea
                  rows={5}
                  value={u.note}
                  onChange={(e) =>
                    setUpdates((old) =>
                      old.map((v, j) =>
                        i === j ? { ...v, note: e.target.value } : v,
                      ),
                    )
                  }
                />
              </Field>
              <p className="form-hint">
                {u.keys.length
                  ? "The edited text will also be saved to this milestone or deadline."
                  : "No project destination selected; retained in daily and weekly reports."}
              </p>
              <button className="button secondary small" onClick={() => setUpdates(old => old.map((v, j) => i === j ? { ...v, keys: [] } : v))}>Clear destinations</button>
              </div>
              <div className="update-right">
              <Field label="Project">
                <select
                  value={u.projectId}
                  onChange={(e) =>
                    setUpdates((old) =>
                      old.map((v, j) =>
                        i === j
                          ? { ...v, projectId: e.target.value, keys: [] }
                          : v,
                      ),
                    )
                  }
                >
                  <option value="">Standalone</option>
                  {state.projects
                    .filter((project) => project.status !== "completed")
                    .map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.title}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Save this edited update to">
                <select
                  value={u.keys[0] ?? ""}
                  onChange={(e) =>
                    setUpdates((old) =>
                      old.map((v, j) =>
                        i === j
                          ? {
                              ...v,
                              keys: e.target.value ? [e.target.value] : [],
                            }
                          : v,
                      ),
                    )
                  }
                >
                  <option value="">Daily and weekly reports only</option>
                  {destinations[i].map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </Field>
              <button
                className="button secondary small"
                onClick={() =>
                  setUpdates((old) => old.filter((_, j) => i !== j))
                }
              >
                Remove update
              </button>
              </div>
            </section>
          ))}
          <button
            className="button secondary small"
            onClick={() =>
              setUpdates((old) => [
                ...old,
                { keys: [], note: "", projectId: "" },
              ])
            }
          >
            Add update
          </button>
          <Field label="Today's overall progress · daily and weekly reports only">
            <p
              className={`overview-status ${overviewCurrent ? "current" : "pending"}`}
              role="status"
            >
              {overviewCurrent
                ? "✓ Overview up to date"
                : "◷ Updating overview"}
            </p>
            <p className="progress-overview" style={{ whiteSpace: "pre-wrap" }}>
              {overviewCurrent
                ? interpretation
                : "Updating overview from your edited sections…"}
            </p>
          </Field>
          <p className="form-hint">
            Edit your update sections once; the overview refreshes
            automatically. It saves only to daily and weekly reports.
          </p>
          {overviewError && (
            <p className="error" role="alert">
              {overviewError}{" "}
              <button
                className="button secondary small"
                onClick={() => setRetry((value) => value + 1)}
              >
                Retry overview
              </button>
            </p>
          )}
          {questions.map((q, i) => (
            <Field key={i} label={q}>
              <textarea
                value={answers[i] ?? ""}
                onChange={(e) =>
                  setAnswers((old) => {
                    const next = [...old];
                    next[i] = e.target.value;
                    return next;
                  })
                }
              />
            </Field>
          ))}
          {answers.some((a) => a.trim()) && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => interpret(true)}
            >
              Incorporate answers and review again
            </button>
          )}
        </>
      )}
      {step === 2 && saved && <Report review={saved} />}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        {step === 1 && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => setStep(0)}
          >
            Back
          </button>
        )}
        <button
          className="button primary"
          disabled={
            busy ||
            (!raw.trim() && step === 0) ||
            (step === 1 &&
              (!overviewCurrent ||
                !updates.length ||
                updates.some((update) => !update.note.trim()) ||
                !interpretation.trim() ||
                answers.some((a) => a.trim())))
          }
          onClick={() =>
            step === 0 ? void interpret() : step === 1 ? save() : onClose()
          }
        >
          {busy
            ? "Working…"
            : step === 0
              ? "Interpret update"
              : step === 1
                ? "Confirm and save"
                : "Done"}
        </button>
      </div>
    </Dialog>
  );
}
