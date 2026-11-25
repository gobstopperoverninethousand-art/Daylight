"use client";
import { useId } from "react";
import { formatDate, type Project } from "@/lib/model";

const nodeWidth = 180;
const nodeHeight = 82;
const columnStep = 232;
const rowStep = 100;
const inset = 8;

export function MilestoneFlow({
  milestones,
  onSelect,
}: {
  milestones: Project["milestones"];
  onSelect: (id: string) => void;
}) {
  const arrow = useId();
  const byId = new Map(
    milestones.map((milestone) => [milestone.id, milestone]),
  );
  const depths = new Map<string, number>();
  function depth(id: string): number {
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    const dependencies = byId.get(id)?.dependsOn ?? [];
    const level = Math.max(
      0,
      ...dependencies.map((parent) => depth(parent) + 1),
    );
    depths.set(id, level);
    return level;
  }
  const rows = new Map<number, number>();
  const nodes = [...milestones]
    .sort(
      (a, b) =>
        depth(a.id) - depth(b.id) ||
        a.date.localeCompare(b.date) ||
        a.title.localeCompare(b.title),
    )
    .map((milestone) => {
      const level = depth(milestone.id);
      const row = rows.get(level) ?? 0;
      rows.set(level, row + 1);
      return {
        milestone,
        x: inset + level * columnStep,
        y: inset + row * rowStep,
      };
    });
  const positions = new Map(nodes.map((node) => [node.milestone.id, node]));
  const width = Math.max(...nodes.map((node) => node.x)) + nodeWidth + inset;
  const height = Math.max(...nodes.map((node) => node.y)) + nodeHeight + inset;
  return (
    <div
      className="milestone-flow"
      tabIndex={0}
      role="region"
      aria-label="Milestone dependency flow"
    >
      <div className="milestone-flow-canvas" style={{ width, height }}>
        <svg width={width} height={height} aria-hidden="true">
          <defs>
            <marker
              id={arrow}
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3.5"
              orient="auto"
            >
              <path d="M0 0L7 3.5L0 7Z" fill="currentColor" />
            </marker>
          </defs>
          {nodes.flatMap(({ milestone, x, y }) =>
            milestone.dependsOn.map((id) => {
              const parent = positions.get(id);
              if (!parent) return null;
              const fromX = parent.x + nodeWidth,
                fromY = parent.y + nodeHeight / 2;
              const toX = x - 3,
                toY = y + nodeHeight / 2;
              const mid = (fromX + toX) / 2;
              return (
                <path
                  key={id + ":" + milestone.id}
                  d={`M ${fromX} ${fromY} C ${mid} ${fromY}, ${mid} ${toY}, ${toX} ${toY}`}
                  fill="none"
                  stroke="currentColor"
                  markerEnd={`url(#${arrow})`}
                />
              );
            }),
          )}
        </svg>
        {nodes.map(({ milestone, x, y }) => {
          const status = milestone.completed
            ? "Done"
            : milestone.approved
              ? "Approved"
              : "Draft";
          const date = formatDate(milestone.date, {
            month: "short",
            day: "numeric",
          });
          const dependencies = milestone.dependsOn
            .map((id) => byId.get(id)?.title)
            .filter(Boolean);
          const label = `${milestone.title}, ${date}, ${status}${dependencies.length ? ", after " + dependencies.join(", ") : ""}`;
          return (
            <button
              key={milestone.id}
              className="milestone-flow-node"
              data-status={status}
              style={{ left: x, top: y, width: nodeWidth, height: nodeHeight }}
              aria-label={label}
              title={label}
              onClick={() => onSelect(milestone.id)}
            >
              <small>
                {date} · {status}
              </small>
              <strong>{milestone.title}</strong>
            </button>
          );
        })}
      </div>
    </div>
  );
}
