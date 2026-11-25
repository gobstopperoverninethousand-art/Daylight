import {
  clockMinutes,
  clockTime,
  type State,
  type Task,
} from "./model";
import type { Block } from "./engine";
import { type SwimlaneTrackKey } from "./wild-planner";
import type { OpenDaySlot } from "./wild-planner-extra";

function trackForBlock(block: Block, state: State): SwimlaneTrackKey {
  if (block.kind === "external") return "calendar";
  if (block.kind === "routine") return "routines";
  const sess = state.sessions.find((s) => s.id === block.id);
  const taskId = sess?.taskId ?? block.sourceId;
  const task = state.tasks.find((t) => t.id === taskId);
  if (task?.projectId || block.color === "lavender") return "projects";
  return "tasks";
}

/* ============================================================================
   1. ORBITAL CONSTELLATION (Polar Star Map Math)
   ============================================================================ */
export type OrbitTier = "inner" | "mid" | "outer";

export type ConstellationStar = {
  block: Block;
  track: SwimlaneTrackKey;
  starCode: string;
  orbit: OrbitTier;
  x: number;
  y: number;
  radius: number;
  angleDeg: number;
  completed: boolean;
};

export type ConstellationDockSlot = {
  slot: OpenDaySlot;
  x: number;
  y: number;
  orbit: OrbitTier;
};

export type ConstellationDiagram = {
  center: number;
  rings: { orbit: OrbitTier; radius: number; label: string }[];
  stars: ConstellationStar[];
  docks: ConstellationDockSlot[];
};

const ORBIT_RADIUS: Record<OrbitTier, number> = {
  inner: 84,
  mid: 144,
  outer: 204,
};

function orbitForMinute(minute: number): OrbitTier {
  if (minute < 12 * 60) return "inner";
  if (minute < 17 * 60) return "mid";
  return "outer";
}

function polarToSvg(
  cx: number,
  cy: number,
  radius: number,
  minute: number,
  startMinute: number,
  spanMinutes: number,
): { x: number; y: number; angleDeg: number } {
  const frac = Math.max(
    0,
    Math.min(1, (minute - startMinute) / Math.max(60, spanMinutes)),
  );
  // Sweep clockwise starting from -90deg (12 o'clock) across 320 degrees
  const angleDeg = -90 + frac * 320;
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: Number((cx + radius * Math.cos(rad)).toFixed(2)),
    y: Number((cy + radius * Math.sin(rad)).toFixed(2)),
    angleDeg: Number(angleDeg.toFixed(1)),
  };
}

export function buildConstellationDiagram(
  state: State,
  blocks: Block[],
  openSlots: OpenDaySlot[],
  startHour = 6,
  endHour = 22,
): ConstellationDiagram {
  const center = 250;
  const startMin = startHour * 60;
  const spanMin = Math.max(120, (endHour - startHour) * 60);
  const timed = [...blocks]
    .filter((b) => !b.allDay)
    .sort((a, b) => a.start - b.start);

  const stars: ConstellationStar[] = timed.map((block, idx) => {
    const orbit = orbitForMinute(block.start);
    const pt = polarToSvg(
      center,
      center,
      ORBIT_RADIUS[orbit],
      block.start,
      startMin,
      spanMin,
    );
    const radius = Math.max(5.5, Math.min(13, 4.5 + block.duration / 20));
    return {
      block,
      track: trackForBlock(block, state),
      starCode: `ST-${String(idx + 1).padStart(2, "0")}`,
      orbit,
      x: pt.x,
      y: pt.y,
      radius: Number(radius.toFixed(1)),
      angleDeg: pt.angleDeg,
      completed: block.outcome === "completed",
    };
  });

  const docks: ConstellationDockSlot[] = openSlots.map((slot) => {
    const midMinute = Math.round((slot.startMinute + slot.endMinute) / 2);
    const orbit = orbitForMinute(slot.startMinute);
    const pt = polarToSvg(
      center,
      center,
      ORBIT_RADIUS[orbit],
      midMinute,
      startMin,
      spanMin,
    );
    return {
      slot,
      x: pt.x,
      y: pt.y,
      orbit,
    };
  });

  return {
    center,
    rings: [
      { orbit: "inner", radius: ORBIT_RADIUS.inner, label: "Morning" },
      { orbit: "mid", radius: ORBIT_RADIUS.mid, label: "Afternoon" },
      { orbit: "outer", radius: ORBIT_RADIUS.outer, label: "Evening" },
    ],
    stars,
    docks,
  };
}

/* ============================================================================
   2. MODULAR PATCH RACK (Eurorack Sequencer Data)
   ============================================================================ */
export type SynthStepSlot = {
  hour: number;
  clock: string;
  activeBlocks: {
    block: Block;
    track: SwimlaneTrackKey;
    jackCode: string;
  }[];
};

export type SynthCable = {
  id: string;
  fromIndex: number;
  toIndex: number;
  track: SwimlaneTrackKey;
};

export type SynthRackData = {
  steps: SynthStepSlot[];
  cables: SynthCable[];
  jacks: { slot: OpenDaySlot; jackCode: string }[];
};

export function buildSynthRackData(
  state: State,
  blocks: Block[],
  openSlots: OpenDaySlot[],
  startHour = 6,
  endHour = 21,
): SynthRackData {
  const timed = [...blocks]
    .filter((b) => !b.allDay)
    .sort((a, b) => a.start - b.start);

  const steps: SynthStepSlot[] = [];
  for (let h = startHour; h <= endHour; h++) {
    const hStart = h * 60;
    const hEnd = (h + 1) * 60;
    const activeBlocks = timed
      .filter((b) => b.start < hEnd && b.start + b.duration > hStart)
      .map((b, idx) => ({
        block: b,
        track: trackForBlock(b, state),
        jackCode: `CH${String(h - startHour + 1).padStart(2, "0")}.${idx + 1}`,
      }));
    steps.push({
      hour: h,
      clock: clockTime(h * 60),
      activeBlocks,
    });
  }

  const cables: SynthCable[] = [];
  for (let i = 0; i < timed.length - 1; i++) {
    const cur = timed[i]!;
    const next = timed[i + 1]!;
    const fromIndex = Math.max(
      0,
      Math.min(steps.length - 1, Math.floor(cur.start / 60) - startHour),
    );
    const toIndex = Math.max(
      0,
      Math.min(steps.length - 1, Math.floor(next.start / 60) - startHour),
    );
    cables.push({
      id: `${cur.id}->${next.id}`,
      fromIndex,
      toIndex,
      track: trackForBlock(cur, state),
    });
  }

  const jacks = openSlots.map((slot, idx) => ({
    slot,
    jackCode: `CV-${String(idx + 1).padStart(2, "0")}`,
  }));

  return { steps, cables, jacks };
}

/* ============================================================================
   3. RISOGRAPH ZINE (Editorial Collage Issue Data)
   ============================================================================ */
export type ZineClipping = {
  block: Block;
  track: SwimlaneTrackKey;
  issueNumber: string;
  tiltDeg: number;
  completed: boolean;
};

export type ZineSpreadData = {
  leadClipping: ZineClipping | null;
  clippings: ZineClipping[];
  cutouts: Task[];
  completedCount: number;
};

const TILT_PATTERN = [-0.65, 0.45, -0.35, 0.6, -0.25, 0.5] as const;

export function buildZineSpreadData(
  state: State,
  blocks: Block[],
  queuedTasks: { task: Task; reason?: string }[],
): ZineSpreadData {
  const timed = [...blocks]
    .filter((b) => !b.allDay)
    .sort((a, b) => a.start - b.start);

  const clippings: ZineClipping[] = timed.map((block, idx) => ({
    block,
    track: trackForBlock(block, state),
    issueNumber: `NO.${String(idx + 1).padStart(2, "0")}`,
    tiltDeg: TILT_PATTERN[idx % TILT_PATTERN.length] ?? 0,
    completed: block.outcome === "completed",
  }));

  const leadClipping =
    clippings.find((c) => !c.completed) ?? clippings[0] ?? null;

  return {
    leadClipping,
    clippings,
    cutouts: queuedTasks.map((q) => q.task),
    completedCount: clippings.filter((c) => c.completed).length,
  };
}

/* ============================================================================
   4. TACTICAL BOARD ARENA (4x4 Algebraic Coordinate Matrix A1-D4)
   ============================================================================ */
export type ArenaSquare = {
  coord: string;
  row: number;
  col: number;
  hour: number;
  startClock: string;
  isDarkSquare: boolean;
  primaryBlock: Block | null;
  primaryTrack: SwimlaneTrackKey | null;
  additionalCount: number;
  isWithinWorkHours: boolean;
};

const FILES = ["A", "B", "C", "D"] as const;

export function buildArenaBoardSquares(
  state: State,
  blocks: Block[],
  startHour = 6,
): ArenaSquare[] {
  const workStartM = clockMinutes(state.settings.workStart);
  const workEndM = clockMinutes(state.settings.workEnd);
  const timed = [...blocks]
    .filter((b) => !b.allDay)
    .sort((a, b) => a.start - b.start);

  const squares: ArenaSquare[] = [];
  for (let idx = 0; idx < 16; idx++) {
    const row = Math.floor(idx / 4);
    const col = idx % 4;
    const hour = startHour + idx;
    const hStart = hour * 60;
    const hEnd = (hour + 1) * 60;

    const matching = timed.filter(
      (b) => b.start < hEnd && b.start + b.duration > hStart,
    );
    const primaryBlock = matching[0] ?? null;
    squares.push({
      coord: `${FILES[col]}${row + 1}`,
      row,
      col,
      hour,
      startClock: clockTime(hStart),
      isDarkSquare: (row + col) % 2 === 1,
      primaryBlock,
      primaryTrack: primaryBlock ? trackForBlock(primaryBlock, state) : null,
      additionalCount: Math.max(0, matching.length - 1),
      isWithinWorkHours: hStart >= workStartM && hStart < workEndM,
    });
  }
  return squares;
}
