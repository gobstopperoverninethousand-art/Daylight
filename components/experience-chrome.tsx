"use client";
import {
  Check,
  Clock3,
  Plus,
  Search,
  CalendarDays,
  Flag,
} from "lucide-react";
import {
  clockTime,
  displayTime,
  durationLabel,
  formatDate,
  hoursLabel,
  type Outcome,
  type State,
} from "@/lib/model";
import { blocksForDay, calendarEventIntervals } from "@/lib/engine";
import { deadlineEntries } from "@/lib/deadlines";
import { computeDayTelemetry, type ExperienceId } from "@/lib/experiences";
import type { EditorState } from "./editor";

export function ExperiencePlannerHeader({
  experience,
  state,
  date,
  edit,
  onSearch,
  onLoadDemo,
  isDemo,
}: {
  experience: ExperienceId;
  state: State;
  date: string;
  edit: (item: EditorState) => void;
  onSearch: () => void;
  onLoadDemo: () => void;
  isDemo: boolean;
}) {
  const telemetry = computeDayTelemetry(state, date);
  const fullDate = formatDate(date, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const utilization =
    telemetry.capacityMinutes > 0
      ? Math.min(
          100,
          Math.round(
            (telemetry.scheduledMinutes / telemetry.capacityMinutes) * 100,
          ),
        )
      : 0;
  const isEmpty =
    state.tasks.length +
      state.projects.length +
      state.routines.length +
      state.deadlines.length ===
    0;

  if (experience === "broadsheet") {
    return (
      <section
        className="exp-banner exp-broadsheet-dispatch"
        aria-label="Daily dispatch"
      >
        <div className="exp-dispatch-lead">
          <span className="exp-kicker">Daily Dispatch · {fullDate}</span>
          <h2>
            {telemetry.nextBlockTitle
              ? `Next scheduled: ${telemetry.nextBlockTitle}`
              : isEmpty
                ? "The page is clear for your first plan."
                : "Your schedule is open for focused work."}
          </h2>
        </div>
        <dl className="exp-metrics-row tabular-num">
          <div>
            <dt>Scheduled</dt>
            <dd>{hoursLabel(telemetry.scheduledMinutes)}</dd>
          </div>
          <div>
            <dt>Open window</dt>
            <dd>{hoursLabel(telemetry.openMinutes)}</dd>
          </div>
          <div>
            <dt>Unscheduled</dt>
            <dd>{telemetry.unscheduledTasks}</dd>
          </div>
          <div>
            <dt>Due within 7d</dt>
            <dd>{telemetry.dueSoonCount}</dd>
          </div>
        </dl>
        <div className="exp-dispatch-actions">
          <button
            type="button"
            className="button primary small"
            onClick={() => edit({ kind: "task" })}
          >
            <Plus size={14} />
            New task
          </button>
          {isEmpty && !isDemo && (
            <button
              type="button"
              className="button secondary small"
              onClick={onLoadDemo}
            >
              Load example
            </button>
          )}
        </div>
      </section>
    );
  }

  if (experience === "cockpit") {
    return (
      <section
        className="exp-banner exp-cockpit-telemetry"
        aria-label="Day capacity summary"
      >
        <div className="exp-cockpit-primary">
          <div className="exp-cockpit-title-row">
            <span className="exp-kicker">Focus Capacity · {fullDate}</span>
            <strong className="tabular-num">
              {hoursLabel(telemetry.scheduledMinutes)} /{" "}
              {hoursLabel(telemetry.capacityMinutes)} booked ({utilization}%)
            </strong>
          </div>
          <div
            className="exp-capacity-bar"
            role="progressbar"
            aria-valuenow={utilization}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Scheduled capacity"
          >
            <span style={{ width: `${utilization}%` }} />
          </div>
        </div>
        <dl className="exp-metrics-row tabular-num">
          <div>
            <dt>Open</dt>
            <dd>{hoursLabel(telemetry.openMinutes)}</dd>
          </div>
          <div>
            <dt>Queue</dt>
            <dd>{telemetry.unscheduledTasks}</dd>
          </div>
          <div>
            <dt>Completed</dt>
            <dd>
              {telemetry.completedBlocks}/{telemetry.totalBlocks}
            </dd>
          </div>
          <div>
            <dt>Due 7d</dt>
            <dd>{telemetry.dueSoonCount}</dd>
          </div>
        </dl>
        <div className="exp-dispatch-actions">
          <button
            type="button"
            className="button secondary small"
            onClick={onSearch}
          >
            <Search size={13} />
            Command ⌘K
          </button>
          <button
            type="button"
            className="button primary small"
            onClick={() => edit({ kind: "session", date })}
          >
            <Plus size={13} />
            Book block
          </button>
        </div>
      </section>
    );
  }

  if (experience === "bauhaus") {
    return (
      <section
        className="exp-banner exp-bauhaus-ribbon"
        aria-label="Daily schedule metrics"
      >
        <div className="exp-bauhaus-date">
          <span>DAY INDEX</span>
          <strong>{fullDate}</strong>
        </div>
        <div className="exp-bauhaus-kpis tabular-num">
          <div className="exp-bauhaus-cell is-blue">
            <span>01 SCHEDULED</span>
            <strong>{hoursLabel(telemetry.scheduledMinutes)}</strong>
          </div>
          <div className="exp-bauhaus-cell is-yellow">
            <span>02 QUEUE</span>
            <strong>
              {telemetry.unscheduledTasks}{" "}
              {telemetry.unscheduledTasks === 1 ? "task" : "tasks"}
            </strong>
          </div>
          <div className="exp-bauhaus-cell is-red">
            <span>03 DEADLINES</span>
            <strong>{telemetry.dueSoonCount} due</strong>
          </div>
          <div className="exp-bauhaus-cell">
            <span>04 DONE</span>
            <strong>
              {telemetry.completedBlocks}/{telemetry.totalBlocks}
            </strong>
          </div>
        </div>
      </section>
    );
  }

  if (experience === "flow") {
    return (
      <section
        className="exp-banner exp-flow-strip"
        aria-label="Workflow status"
      >
        <div className="exp-flow-title">
          <span className="exp-kicker">Today’s Flow · {fullDate}</span>
          <p>
            Drag tasks from the left backlog onto the center grid, then check off
            blocks in the right stream.
          </p>
        </div>
        <div className="exp-metrics-row tabular-num">
          <div>
            <dt>Backlog</dt>
            <dd>{telemetry.unscheduledTasks}</dd>
          </div>
          <div>
            <dt>Time booked</dt>
            <dd>{hoursLabel(telemetry.scheduledMinutes)}</dd>
          </div>
          <div>
            <dt>Done today</dt>
            <dd>
              {telemetry.completedBlocks}/{telemetry.totalBlocks}
            </dd>
          </div>
        </div>
      </section>
    );
  }

  // "zen"
  return (
    <section
      className="exp-banner exp-zen-horizon"
      aria-label="Morning horizon"
    >
      <div>
        <span className="exp-kicker">{fullDate}</span>
        <h2>
          {telemetry.nextBlockTitle
            ? `Current focus: ${telemetry.nextBlockTitle}`
            : "Quiet space for deliberate work."}
        </h2>
      </div>
      <div className="exp-zen-summary tabular-num">
        <span>{hoursLabel(telemetry.scheduledMinutes)} planned</span>
        <span aria-hidden="true">·</span>
        <span>{hoursLabel(telemetry.openMinutes)} unscheduled</span>
        <span aria-hidden="true">·</span>
        <span>
          {telemetry.dueSoonCount} upcoming{" "}
          {telemetry.dueSoonCount === 1 ? "deadline" : "deadlines"}
        </span>
        {isEmpty && !isDemo && (
          <>
            <span aria-hidden="true">·</span>
            <button type="button" className="text-button" onClick={onLoadDemo}>
              Explore example
            </button>
          </>
        )}
      </div>
    </section>
  );
}

export function TodayExecutionStream({
  state,
  date,
  edit,
  setOutcome,
  openGoogleEvent,
}: {
  state: State;
  date: string;
  edit: (item: EditorState) => void;
  setOutcome: (kind: string, id: string, date: string, value: Outcome) => void;
  openGoogleEvent: (id: string) => void;
}) {
  const events = calendarEventIntervals(state);
  const dayBlocks = blocksForDay(state, date, events).sort(
    (a, b) => a.start - b.start,
  );
  const dueSoon = deadlineEntries(state)
    .filter((entry) => !entry.resolved && entry.date >= date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 4);

  const completedCount = dayBlocks.filter(
    (b) => b.kind !== "external" && b.outcome === "completed",
  ).length;
  const actionableCount = dayBlocks.filter((b) => b.kind !== "external").length;

  return (
    <aside
      className="flow-execution-stream"
      aria-label="Today execution stream"
    >
      <div className="flow-stream-head">
        <div>
          <h2>Today stream</h2>
          <p className="tabular-num">
            {formatDate(date, { weekday: "short", month: "short", day: "numeric" })}
            {" · "}
            {completedCount}/{actionableCount} complete
          </p>
        </div>
        <button
          type="button"
          className="button secondary small"
          onClick={() => edit({ kind: "session", date })}
        >
          <Plus size={13} />
          Session
        </button>
      </div>

      {dayBlocks.length ? (
        <div className="flow-stream-list">
          {dayBlocks.map((block) => {
            const isExternal = block.kind === "external";
            const done = block.outcome === "completed";
            return (
              <article
                key={block.id}
                className={`flow-stream-item ${block.color} ${done ? "is-done" : ""}`}
              >
                {!isExternal ? (
                  <button
                    type="button"
                    className={"task-check " + (done ? "checked" : "")}
                    aria-label={`Mark ${block.title} ${done ? "not recorded" : "completed"}`}
                    onClick={() =>
                      setOutcome(
                        block.kind,
                        block.sourceId,
                        date,
                        done ? "pending" : "completed",
                      )
                    }
                  >
                    {done && <Check size={12} />}
                  </button>
                ) : (
                  <span className="flow-stream-dot" aria-hidden="true">
                    <CalendarDays size={13} />
                  </span>
                )}
                <button
                  type="button"
                  className="plain flow-stream-item-main"
                  onClick={() =>
                    isExternal
                      ? openGoogleEvent(block.sourceId)
                      : edit(
                          block.kind === "routine"
                            ? { kind: "occurrence", id: block.sourceId, date }
                            : { kind: "session", id: block.id },
                        )
                  }
                >
                  <strong className={done ? "strike" : ""}>{block.title}</strong>
                  <small className="tabular-num">
                    {block.allDay
                      ? "All day"
                      : `${displayTime(clockTime(block.start))} · ${durationLabel(block.duration)}`}
                    {block.kind === "routine" ? " · Routine" : ""}
                  </small>
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="flow-stream-empty">
          <Clock3 size={18} aria-hidden="true" />
          <p>No blocks scheduled for this day yet.</p>
          <button
            type="button"
            className="button secondary small"
            onClick={() => edit({ kind: "session", date })}
          >
            Schedule a session
          </button>
        </div>
      )}

      <div className="flow-stream-deadlines">
        <div className="flow-stream-subhead">
          <Flag size={13} aria-hidden="true" />
          <span>Upcoming deadlines</span>
        </div>
        {dueSoon.length ? (
          <div className="flow-deadline-list">
            {dueSoon.map((entry) => (
              <button
                type="button"
                key={entry.kind + ":" + entry.id}
                className="flow-deadline-row"
                onClick={() =>
                  edit({
                    kind: entry.kind,
                    id: entry.id,
                    projectId:
                      entry.kind === "milestone"
                        ? (entry.projectId ?? undefined)
                        : undefined,
                  })
                }
              >
                <span>{entry.title}</span>
                <small className="tabular-num">
                  {formatDate(entry.date, { month: "short", day: "numeric" })}
                </small>
              </button>
            ))}
          </div>
        ) : (
          <p className="flow-stream-muted">No upcoming deadlines.</p>
        )}
      </div>
    </aside>
  );
}
