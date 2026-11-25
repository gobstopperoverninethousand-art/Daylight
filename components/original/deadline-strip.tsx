"use client";
import { useState } from "react";
import { Flag } from "lucide-react";
import { deadlineEntries } from "@/lib/deadlines";
import { addDays, displayTime, formatDate, type State } from "@/lib/model";
import type { EditorState } from "./editor";

export function DeadlineStrip({
  state,
  today,
  edit,
}: {
  state: State;
  today: string;
  edit: (item: EditorState) => void;
}) {
  const [projectId, setProjectId] = useState("");
  const [kind, setKind] = useState("");
  const [order, setOrder] = useState("date");
  const entries = deadlineEntries(state)
    .filter(
      (entry) =>
        (!projectId || entry.projectId === projectId) &&
        (kind === "high" ? entry.high : !kind || entry.kind === kind),
    )
    .sort(
      (a, b) =>
        (order === "priority" ? Number(b.high) - Number(a.high) : 0) ||
        a.date.localeCompare(b.date) ||
        (a.time || "23:59").localeCompare(b.time || "23:59"),
    );
  return (
    <section
      className="planner-deadlines"
      aria-label="Milestones and deadlines"
    >
      <div className="planner-strip-heading">
        <h2>
          <Flag size={15} aria-hidden="true" /> Milestones and deadlines
        </h2>
        <div className="planner-strip-filters">
          <select
            aria-label="Filter deadlines by project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">All projects</option>
            {state.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter deadlines by type or priority"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">All deadlines</option>
            <option value="milestone">Milestones</option>
            <option value="deadline">Standalone deadlines</option>
            <option value="project">Project deadlines</option>
            <option value="high">High priority</option>
          </select>
          <select
            aria-label="Sort deadlines"
            value={order}
            onChange={(e) => setOrder(e.target.value)}
          >
            <option value="date">Due date</option>
            <option value="priority">Priority first</option>
          </select>
        </div>
      </div>
      {entries.length ? (
        <div
          className="planner-card-row"
          role="region"
          aria-label="Deadline cards"
          tabIndex={0}
        >
          {[
            {
              label: "Overdue",
              items: entries.filter((entry) => !entry.resolved && entry.date < today),
            },
            {
              label: "Due within 7 days",
              items: entries.filter(
                (entry) =>
                  entry.date >= today && entry.date <= addDays(today, 7),
              ),
            },
            {
              label: "Due later",
              items: entries.filter((entry) => entry.date > addDays(today, 7)),
            },
          ]
            .filter((group) => group.items.length)
            .map((group) => (
              <div className="deadline-date-group" key={group.label}>
                <h3>{group.label}</h3>
                <div className="deadline-date-cards">
                  {group.items.map((entry) => (
                    <button
                      className={`planner-item-card deadline-strip-card ${entry.resolved ? "deadline-completed" : ""}`}
                      key={entry.kind + ":" + entry.id}
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
                      <span className="strip-card-date">
                        {formatDate(entry.date, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}
                        {entry.time ? " · " + displayTime(entry.time) : ""}
                      </span>
                      <strong>
                        {entry.resolved ? "✓ " : ""}
                        {entry.title}
                      </strong>
                      <span>
                        {entry.resolved ? "Completed · " : ""}
                        {entry.kind === "milestone"
                          ? "Milestone"
                          : entry.kind === "project"
                            ? "Project deadline"
                            : "Deadline"}
                        {entry.kind !== "project" && entry.projectId
                          ? " · " +
                            (state.projects.find(
                              (p) => p.id === entry.projectId,
                            )?.title || "")
                          : ""}
                      </span>
                      {(entry.high || entry.date <= today) && (
                        <small>
                          {[
                            entry.date < today
                              ? "Past due"
                              : entry.date === today
                                ? "Due today"
                                : "",
                            entry.high ? "High priority" : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
        </div>
      ) : (
        <p className="planner-strip-empty">No deadlines match these filters.</p>
      )}
    </section>
  );
}
