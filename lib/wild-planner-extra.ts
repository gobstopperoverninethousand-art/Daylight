import {
  addDays,
  clockMinutes,
  clockTime,
  type Outcome,
  type Project,
  type Routine,
  type State,
} from "./model";
import { blocksForDay, type Block, type calendarEventIntervals } from "./engine";
import { groupBlocksByTrack, type SwimlaneTrackKey } from "./wild-planner";

export type OpenDaySlot = {
  startMinute: number;
  endMinute: number;
  startClock: string;
  endClock: string;
  duration: number;
};

/**
 * Finds all contiguous free intervals >= minGapMinutes inside [workStart..workEnd].
 */
export function computeOpenDaySlots(
  state: State,
  date: string,
  events: ReturnType<typeof calendarEventIntervals>,
  minGapMinutes = 30,
): OpenDaySlot[] {
  const workStart = clockMinutes(state.settings.workStart);
  const workEnd = clockMinutes(state.settings.workEnd);
  if (workEnd <= workStart) return [];

  const busy = blocksForDay(state, date, events)
    .filter((b) => !b.allDay)
    .map((b) => ({
      start: Math.max(workStart, b.start),
      end: Math.min(workEnd, b.start + b.duration),
    }))
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: { start: number; end: number }[] = [];
  for (const item of busy) {
    const prev = merged[merged.length - 1];
    if (!prev || item.start > prev.end) {
      merged.push({ ...item });
    } else {
      prev.end = Math.max(prev.end, item.end);
    }
  }

  const open: OpenDaySlot[] = [];
  let cursor = workStart;
  for (const interval of merged) {
    if (interval.start - cursor >= minGapMinutes) {
      open.push({
        startMinute: cursor,
        endMinute: interval.start,
        startClock: clockTime(cursor),
        endClock: clockTime(interval.start),
        duration: interval.start - cursor,
      });
    }
    cursor = Math.max(cursor, interval.end);
  }
  if (workEnd - cursor >= minGapMinutes) {
    open.push({
      startMinute: cursor,
      endMinute: workEnd,
      startClock: clockTime(cursor),
      endClock: clockTime(workEnd),
      duration: workEnd - cursor,
    });
  }
  return open;
}

export type TransitLineCode = "R1" | "A2" | "G3" | "B4";

export type TransitStation = {
  block: Block;
  lineCode: TransitLineCode;
  stationCode: string;
  xPct: number;
  widthPct: number;
  completed: boolean;
};

export type TransitRouteLine = {
  key: SwimlaneTrackKey;
  lineCode: TransitLineCode;
  lineName: string;
  hex: string;
  stations: TransitStation[];
};

const LINE_META: Record<
  SwimlaneTrackKey,
  { lineCode: TransitLineCode; lineName: string; hex: string }
> = {
  tasks: { lineCode: "R1", lineName: "Red Line · Tasks", hex: "#DC2626" },
  projects: { lineCode: "A2", lineName: "Amber Line · Projects", hex: "#D97706" },
  routines: { lineCode: "G3", lineName: "Green Line · Routines", hex: "#059669" },
  calendar: { lineCode: "B4", lineName: "Blue Line · Calendar", hex: "#0284C7" },
};

export function buildTransitRouteLines(
  state: State,
  blocks: Block[],
  startHour = 6,
  endHour = 22,
): TransitRouteLine[] {
  const timed = blocks.filter((b) => !b.allDay);
  const groups = groupBlocksByTrack(timed, state);
  const minStart = startHour * 60;
  const totalSpan = Math.max(60, (endHour - startHour) * 60);

  return groups.map((group) => {
    const meta = LINE_META[group.key];
    const sorted = [...group.blocks].sort((a, b) => a.start - b.start);
    const stations: TransitStation[] = sorted.map((block, idx) => {
      const clampedStart = Math.max(minStart, Math.min(endHour * 60 - 15, block.start));
      const xPct = Number((((clampedStart - minStart) / totalSpan) * 100).toFixed(2));
      const widthPct = Number(
        Math.max(2, Math.min(100 - xPct, (block.duration / totalSpan) * 100)).toFixed(2),
      );
      return {
        block,
        lineCode: meta.lineCode,
        stationCode: `${meta.lineCode}-${String(idx + 1).padStart(2, "0")}`,
        xPct,
        widthPct,
        completed: block.outcome === "completed",
      };
    });
    return {
      key: group.key,
      lineCode: meta.lineCode,
      lineName: meta.lineName,
      hex: meta.hex,
      stations,
    };
  });
}

export type ProjectMetroStation = {
  id: string;
  code: string;
  title: string;
  date: string;
  completed: boolean;
  approved: boolean;
  isTerminus: boolean;
};

export function computeProjectMetroStations(
  project: Project,
): ProjectMetroStation[] {
  const sorted = [...project.milestones].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const stations: ProjectMetroStation[] = sorted.map((m, i) => ({
    id: m.id,
    code: `S${String(i + 1).padStart(2, "0")}`,
    title: m.title,
    date: m.date,
    completed: m.completed,
    approved: m.approved,
    isTerminus: false,
  }));
  stations.push({
    id: `terminus:${project.id}`,
    code: "END",
    title: `Deadline: ${project.title}`,
    date: project.deadline,
    completed: project.status === "completed",
    approved: true,
    isTerminus: true,
  });
  return stations;
}

export type BlueprintBar = {
  id: string;
  specCode: string;
  layer: SwimlaneTrackKey;
  block: Block;
  xPct: number;
  widthPct: number;
};

export type BlueprintGapCaliper = {
  slot: OpenDaySlot;
  gapCode: string;
  xPct: number;
  widthPct: number;
};

export type BlueprintElevation = {
  startHour: number;
  endHour: number;
  layers: { key: SwimlaneTrackKey; label: string; layerCode: string; bars: BlueprintBar[] }[];
  gaps: BlueprintGapCaliper[];
};

const LAYER_LABELS: Record<SwimlaneTrackKey, { label: string; layerCode: string }> = {
  tasks: { label: "Tasks & Specs", layerCode: "L-01" },
  projects: { label: "Project Milestones", layerCode: "L-02" },
  routines: { label: "Recurring Cadence", layerCode: "L-03" },
  calendar: { label: "External Sync", layerCode: "L-04" },
};

export function buildBlueprintElevationData(
  state: State,
  blocks: Block[],
  openSlots: OpenDaySlot[],
): BlueprintElevation {
  const timed = blocks.filter((b) => !b.allDay);
  const workStartH = Math.floor(clockMinutes(state.settings.workStart) / 60);
  const workEndH = Math.ceil(clockMinutes(state.settings.workEnd) / 60);
  const earliestBlockH = timed.length
    ? Math.floor(Math.min(...timed.map((b) => b.start)) / 60)
    : workStartH;
  const latestBlockH = timed.length
    ? Math.ceil(Math.max(...timed.map((b) => b.start + b.duration)) / 60)
    : workEndH;

  const startHour = Math.max(0, Math.min(workStartH, earliestBlockH, 7));
  const endHour = Math.min(24, Math.max(workEndH, latestBlockH, startHour + 8));
  const minStart = startHour * 60;
  const span = Math.max(60, (endHour - startHour) * 60);

  let specIndex = 1;
  const groups = groupBlocksByTrack(timed, state);
  const layers = groups.map((group) => {
    const meta = LAYER_LABELS[group.key];
    const bars: BlueprintBar[] = [...group.blocks]
      .sort((a, b) => a.start - b.start)
      .map((block) => {
        const startC = Math.max(minStart, block.start);
        const endC = Math.min(endHour * 60, block.start + block.duration);
        const xPct = Number((((startC - minStart) / span) * 100).toFixed(2));
        const widthPct = Number(
          Math.max(2.5, ((Math.max(15, endC - startC)) / span) * 100).toFixed(2),
        );
        return {
          id: block.id,
          specCode: `BLK-${String(specIndex++).padStart(2, "0")}`,
          layer: group.key,
          block,
          xPct,
          widthPct,
        };
      });
    return {
      key: group.key,
      label: meta.label,
      layerCode: meta.layerCode,
      bars,
    };
  });

  const gaps: BlueprintGapCaliper[] = openSlots.map((slot, idx) => {
    const startC = Math.max(minStart, slot.startMinute);
    const endC = Math.min(endHour * 60, slot.endMinute);
    const xPct = Number((((startC - minStart) / span) * 100).toFixed(2));
    const widthPct = Number(
      Math.max(2, ((Math.max(15, endC - startC)) / span) * 100).toFixed(2),
    );
    return {
      slot,
      gapCode: `GAP-${String(idx + 1).padStart(2, "0")}`,
      xPct,
      widthPct,
    };
  });

  return { startHour, endHour, layers, gaps };
}

export type HabitInkCell = {
  date: string;
  dayNum: number;
  weekdayChar: string;
  scheduled: boolean;
  outcome: Outcome;
  isToday: boolean;
};

export type HabitInkRow = {
  routine: Routine;
  cells: HabitInkCell[];
  completedInWindow: number;
  scheduledInWindow: number;
};

const WEEKDAY_CHARS = ["S", "M", "T", "W", "T", "F", "S"] as const;

export function computeHabitInkMatrix(
  state: State,
  today: string,
  days = 14,
): { dates: { date: string; dayNum: number; weekdayChar: string; isToday: boolean }[]; rows: HabitInkRow[] } {
  const count = Math.max(1, days);
  const dates = Array.from({ length: count }, (_, idx) => {
    const date = addDays(today, idx - (count - 1));
    const d = new Date(date + "T12:00:00Z");
    return {
      date,
      dayNum: d.getUTCDate(),
      weekdayChar: WEEKDAY_CHARS[d.getUTCDay()] ?? "·",
      isToday: date === today,
    };
  });

  const scheduledMap = new Map<string, Set<string>>();
  for (const d of dates) {
    const dayBlocks = blocksForDay(state, d.date, []);
    const routineSet = new Set(
      dayBlocks.filter((b) => b.kind === "routine").map((b) => b.sourceId),
    );
    scheduledMap.set(d.date, routineSet);
  }

  const recordLookup = new Map<string, Outcome>(
    state.routineRecords.map((rec) => [`${rec.routineId}:${rec.date}`, rec.outcome]),
  );

  const rows: HabitInkRow[] = state.routines
    .filter((r) => !r.deletedAt)
    .map((routine) => {
      let completedInWindow = 0;
      let scheduledInWindow = 0;
      const cells: HabitInkCell[] = dates.map((d) => {
        const scheduled = scheduledMap.get(d.date)?.has(routine.id) ?? false;
        const outcome: Outcome =
          recordLookup.get(`${routine.id}:${d.date}`) ?? "pending";
        if (scheduled) scheduledInWindow += 1;
        if (outcome === "completed") completedInWindow += 1;
        return {
          date: d.date,
          dayNum: d.dayNum,
          weekdayChar: d.weekdayChar,
          scheduled,
          outcome,
          isToday: d.isToday,
        };
      });
      return {
        routine,
        cells,
        completedInWindow,
        scheduledInWindow,
      };
    });

  return { dates, rows };
}

export type GalleryWingId = "morning" | "afternoon" | "evening";

export type GalleryWing = {
  id: GalleryWingId;
  roman: string;
  label: string;
  hoursLabel: string;
  blocks: Block[];
  openSlots: OpenDaySlot[];
};

export function partitionGalleryWings(
  blocks: Block[],
  openSlots: OpenDaySlot[],
): { allDay: Block[]; wings: GalleryWing[] } {
  const allDay = blocks.filter((b) => b.allDay);
  const timed = blocks.filter((b) => !b.allDay).sort((a, b) => a.start - b.start);

  const morningBlocks = timed.filter((b) => b.start < 12 * 60);
  const afternoonBlocks = timed.filter((b) => b.start >= 12 * 60 && b.start < 17 * 60);
  const eveningBlocks = timed.filter((b) => b.start >= 17 * 60);

  const morningSlots = openSlots.filter((s) => s.startMinute < 12 * 60);
  const afternoonSlots = openSlots.filter(
    (s) => s.startMinute >= 12 * 60 && s.startMinute < 17 * 60,
  );
  const eveningSlots = openSlots.filter((s) => s.startMinute >= 17 * 60);

  return {
    allDay,
    wings: [
      {
        id: "morning",
        roman: "I",
        label: "Morning Wing",
        hoursLabel: "Before 12:00",
        blocks: morningBlocks,
        openSlots: morningSlots,
      },
      {
        id: "afternoon",
        roman: "II",
        label: "Afternoon Hall",
        hoursLabel: "12:00 – 17:00",
        blocks: afternoonBlocks,
        openSlots: afternoonSlots,
      },
      {
        id: "evening",
        roman: "III",
        label: "Evening Salon",
        hoursLabel: "17:00 onward",
        blocks: eveningBlocks,
        openSlots: eveningSlots,
      },
    ],
  };
}
