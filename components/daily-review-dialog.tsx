"use client";

import { useState } from "react";
import { evidenceKey } from "@/lib/ai-freshness";
import { assess, makeSnapshot, RULE_VERSION } from "@/lib/engine";
import {
  audit,
  weekday,
  durationLabel,
  uid,
  type Review,
  type State,
} from "@/lib/model";
import { Dialog, Field } from "./ui";
import { CommitmentField, Report, WeeklyProgress } from "./review";

export function DailyReviewDialog({
  state,
  date,
  aiReady,
  api,
  update,
  onClose,
}: {
  state: State;
  date: string;
  aiReady: boolean;
  api: (path: string, body: unknown) => Promise<any>;
  update: (fn: (state: State) => void) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [commitmentKey, setCommitmentKey] = useState("");
  const [focus, setFocus] = useState("");
  const [blocker, setBlocker] = useState("");
  const [accomplishment, setAccomplishment] = useState("");
  const [interpretation, setInterpretation] = useState("");
  const [question, setQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [report, setReport] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sunday = weekday(date) === 0;
  const input = {
    state,
    date,
    focus,
    blocker,
    accomplishment,
    commitmentKey: commitmentKey || undefined,
  };
  async function advance() {
    setBusy(true);
    setError("");
    try {
      if (step === 0) {
        const result = aiReady
          ? await api("/api/review", { ...input, stage: "interpret" })
          : {
              interpretation:
                [
                  focus && "Focus: " + focus,
                  accomplishment,
                  blocker && "Blocker: " + blocker,
                ]
                  .filter(Boolean)
                  .join("\n")
                  .slice(0, 2500) ||
                "No additional progress or obstacles reported.",
            };
        setInterpretation(result.interpretation);
        setQuestion(result.question ?? null);
        setAnswer("");
        setStep(1);
      } else {
        const snapshot = {
          ...makeSnapshot(state, date, focus, blocker, accomplishment),
          confirmed_interpretation: interpretation.trim(),
        };
        const result = aiReady
          ? await api("/api/review", {
              ...input,
              confirmedInterpretation: interpretation.trim(),
              followUp: question
                ? { question, answer: answer.trim() }
                : undefined,
            })
          : { assessment: assess(snapshot), snapshot, version: RULE_VERSION };
        const record: Review = {
          id: uid(),
          date,
          createdAt: new Date().toISOString(),
          source: aiReady ? "ai" : "rules",
          version: result.version,
          inputKey: evidenceKey(state, date, [focus, blocker, accomplishment]),
          focus,
          blocker,
          accomplishment,
          commitmentKey: commitmentKey || undefined,
          commitmentUpdates: result.commitmentUpdates,
          assessment: result.assessment,
          snapshot: result.snapshot,
        };
        update((draft) => {
          draft.reviews.push(record);
          audit(draft, "Daily assessment saved", record.id);
        });
        setReport(record);
        setStep(2);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const sessionCount = Array.isArray(report?.snapshot.sessions)
    ? report.snapshot.sessions.length
    : 0;
  const confirmed = Number(report?.snapshot.confirmed_sessions ?? 0);
  const actualReports = Number(report?.snapshot.actual_time_reports ?? 0);

  return (
    <Dialog
      title={
        [
          "Daily review",
          "Check your answers",
          "Progress report",
          "Weekly progress report",
        ][step]
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="daily-review-flow">
        <div
          className="daily-review-steps"
          role="progressbar"
          aria-label="Daily review step"
          aria-valuemin={1}
          aria-valuemax={sunday ? 4 : 3}
          aria-valuenow={step + 1}
        >
          {(sunday ? [0, 1, 2, 3] : [0, 1, 2]).map((index) => (
            <span key={index} data-reached={index <= step} />
          ))}
        </div>
        {step === 0 && (
          <div className="daily-review-fields">
            <Field label="Focus">
              <select
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                disabled={busy}
              >
                <option value="">Skip</option>
                <option>Focused</option>
                <option>Mixed</option>
                <option>Distracted</option>
              </select>
            </Field>
            <CommitmentField
              state={state}
              value={commitmentKey}
              onChange={setCommitmentKey}
              disabled={busy}
            />
            <Field label="What moved forward, and what’s left?">
              <textarea
                placeholder="Name the deadline or milestone if you can."
                value={accomplishment}
                onChange={(e) => setAccomplishment(e.target.value)}
                maxLength={4000}
                disabled={busy}
              />
            </Field>
            <Field label="Anything blocking your next step?">
              <textarea
                value={blocker}
                onChange={(e) => setBlocker(e.target.value)}
                maxLength={4000}
                disabled={busy}
              />
            </Field>
          </div>
        )}
        {step === 1 && (
          <div className="daily-review-fields">
            <Field
              label={
                aiReady
                  ? "Gemini’s interpretation · edit anything it misunderstood"
                  : "Confirm your account of the day"
              }
            >
              <textarea
                rows={5}
                value={interpretation}
                onChange={(e) => setInterpretation(e.target.value)}
                maxLength={2500}
                disabled={busy}
              />
            </Field>
            {question && (
              <Field label={question}>
                <textarea
                  rows={2}
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder="Optional"
                  maxLength={1500}
                  disabled={busy}
                />
              </Field>
            )}
          </div>
        )}
        {step === 2 && report && (
          <>
            <div className="daily-review-metrics">
              <strong>
                {confirmed} of {sessionCount} sessions reviewed
              </strong>
              {sessionCount > 0 && (
                <progress
                  value={confirmed}
                  max={sessionCount}
                  aria-label="Sessions with a recorded outcome"
                />
              )}
              <span>
                {durationLabel(Number(report.snapshot.planned_minutes ?? 0))}{" "}
                planned
              </span>
              <span>
                {actualReports > 0
                  ? durationLabel(
                      Number(report.snapshot.confirmed_actual_minutes ?? 0),
                    ) + " actual time reported"
                  : "Actual time unreported"}
              </span>
            </div>
            {state.projects
              .filter((project) => project.status === "active")
              .map((project) => {
                const approved = project.milestones.filter(
                  (milestone) => milestone.approved,
                );
                if (!approved.length) return null;
                const done = approved.filter(
                  (milestone) => milestone.completed,
                ).length;
                return (
                  <div className="daily-review-metrics" key={project.id}>
                    <strong>{project.title}</strong>
                    <progress
                      value={done}
                      max={approved.length}
                      aria-label={project.title + " milestone completion"}
                    />
                    <span>
                      {done} of {approved.length} approved milestones complete
                    </span>
                  </div>
                );
              })}
            <Report review={report} />
          </>
        )}
        {step === 3 && <WeeklyProgress state={state} date={date} />}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="dialog-actions">
        {step === 1 && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => {
              setError("");
              setStep(0);
            }}
          >
            Back
          </button>
        )}
        <button
          className="button primary"
          disabled={busy || (step === 1 && !interpretation.trim())}
          onClick={
            step === 2 && sunday
              ? () => setStep(3)
              : step >= 2
                ? onClose
                : () => void advance()
          }
        >
          {busy
            ? "Working…"
            : [
                "Review answers",
                "Confirm and view report",
                sunday ? "See weekly report" : "Done",
                "Done",
              ][step]}
        </button>
      </div>
    </Dialog>
  );
}
