import test from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "@/lib/model";
import { calendarEventIntervals, blocksForDay } from "@/lib/engine";
import {
  DEFAULT_EXPERIENCE,
  EXPERIENCES,
  computeDayTelemetry,
  getExperience,
  isExperienceId,
  isWildExperience,
  resolveExperience,
} from "@/lib/experiences";
import {
  computeFocusSummary,
  findNextOpenSlot,
  groupBlocksByTrack,
  parseTerminalCommand,
  solarAngleDeg,
  solarPoint,
  solarRingWedgePath,
} from "@/lib/wild-planner";
import {
  classifyTaskBuckets,
  computeDeadlineUrgency,
  computeProjectTimelineSpans,
  computeRoutineCadenceSummary,
  formatCountdownLabel,
} from "@/lib/work-view-models";

import {
  buildBlueprintElevationData,
  buildTransitRouteLines,
  computeHabitInkMatrix,
  computeOpenDaySlots,
  computeProjectMetroStations,
  partitionGalleryWings,
} from "@/lib/wild-planner-extra";
import {
  buildArenaBoardSquares,
  buildConstellationDiagram,
  buildSynthRackData,
  buildZineSpreadData,
} from "@/lib/wild-planner-extra2";

test("experience registry provides 19 distinct styles (6 classic + 13 wild)", () => {
  assert.equal(EXPERIENCES.length, 19);
  const ids = new Set(EXPERIENCES.map((item) => item.id));
  assert.equal(ids.size, 19);
  const classic = EXPERIENCES.filter((item) => item.category === "classic");
  const wild = EXPERIENCES.filter((item) => item.category === "wild");
  assert.equal(classic.length, 6);
  assert.equal(wild.length, 13);
  for (const item of EXPERIENCES) {
    assert.ok(item.name.length > 0);
    assert.ok(item.shortName.length > 0);
    assert.ok(item.tagline.length > 0);
    assert.equal(item.swatches.length, 3);
    assert.equal(getExperience(item.id).id, item.id);
    if (item.category === "wild") {
      assert.ok(item.wildModeLabel && item.wildModeLabel.length > 0);
    }
  }
});

test("resolveExperience and isWildExperience handle classic and all 13 wild ids", () => {
  assert.equal(isExperienceId("cockpit"), true);
  assert.equal(isExperienceId("sundial"), true);
  assert.equal(isExperienceId("retro98"), true);
  assert.equal(isExperienceId("transit"), true);
  assert.equal(isExperienceId("blueprint"), true);
  assert.equal(isExperienceId("notebook"), true);
  assert.equal(isExperienceId("gallery"), true);
  assert.equal(isExperienceId("constellation"), true);
  assert.equal(isExperienceId("synth"), true);
  assert.equal(isExperienceId("zine"), true);
  assert.equal(isExperienceId("arena"), true);
  assert.equal(isExperienceId("unknown"), false);
  assert.equal(isWildExperience("broadsheet"), false);
  assert.equal(isWildExperience("terminal"), true);
  assert.equal(isWildExperience("transit"), true);
  assert.equal(isWildExperience("gallery"), true);
  assert.equal(isWildExperience("constellation"), true);
  assert.equal(isWildExperience("arena"), true);
  assert.equal(resolveExperience("bauhaus", "zen"), "bauhaus");
  assert.equal(resolveExperience("invalid", "blueprint"), "blueprint");
  assert.equal(resolveExperience(null, null), DEFAULT_EXPERIENCE);
});

test("computeDayTelemetry calculates real scheduled, open capacity, queue, and due-soon metrics", () => {
  const state = emptyState();
  state.settings.workStart = "09:00";
  state.settings.workEnd = "17:00";
  const date = "2026-11-23";
  state.tasks.push(
    {
      id: "task-1",
      title: "Draft proposal",
      notes: "",
      estimate: 90,
      remaining: 90,
      projectId: null,
      milestoneId: null,
      deadlineId: null,
      importance: "high",
      status: "active",
      createdAt: "2026-11-23T08:00:00.000Z",
      completedAt: null,
    },
    {
      id: "task-2",
      title: "Unscheduled follow-up",
      notes: "",
      estimate: 30,
      remaining: 30,
      projectId: null,
      milestoneId: null,
      deadlineId: null,
      importance: "normal",
      status: "active",
      createdAt: "2026-11-23T08:05:00.000Z",
      completedAt: null,
    },
  );
  state.sessions.push({
    id: "sess-1",
    taskId: "task-1",
    date,
    start: "10:00",
    duration: 90,
    outcome: "pending",
    actualMinutes: null,
    note: "",
    needsReview: false,
  });

  const telemetry = computeDayTelemetry(state, date);
  assert.equal(telemetry.capacityMinutes, 480);
  assert.equal(telemetry.scheduledMinutes, 90);
  assert.equal(telemetry.openMinutes, 390);
  assert.equal(telemetry.activeTasks, 2);
  assert.equal(telemetry.unscheduledTasks, 1);
  assert.equal(telemetry.totalBlocks, 1);
  assert.equal(telemetry.completedBlocks, 0);
  assert.equal(telemetry.nextBlockTitle, "Draft proposal");
});

test("findNextOpenSlot locates conflict-free intervals inside work hours", () => {
  const state = emptyState();
  state.settings.workStart = "09:00";
  state.settings.workEnd = "13:00";
  const date = "2026-11-23";
  state.tasks.push({
    id: "task-1",
    title: "Morning review",
    notes: "",
    estimate: 60,
    remaining: 60,
    projectId: null,
    milestoneId: null,
    deadlineId: null,
    importance: "normal",
    status: "active",
    createdAt: "2026-11-23T08:00:00.000Z",
    completedAt: null,
  });
  state.sessions.push({
    id: "sess-1",
    taskId: "task-1",
    date,
    start: "09:00",
    duration: 120, // 09:00 -> 11:00
    outcome: "pending",
    actualMinutes: null,
    note: "",
    needsReview: false,
  });
  const events = calendarEventIntervals(state);

  assert.equal(findNextOpenSlot(state, date, 60, events), "11:00");
  assert.equal(findNextOpenSlot(state, date, 60, events, 11 * 60 + 20), "11:30");
  assert.equal(findNextOpenSlot(state, date, 150, events), null);
});

test("solar dial geometry places noon at top zenith (270deg) and dawn at left (180deg)", () => {
  assert.equal(solarAngleDeg(0), 90);
  assert.equal(solarAngleDeg(360), 180);
  assert.equal(solarAngleDeg(720), 270);
  assert.equal(solarAngleDeg(1080), 0);

  const noonPt = solarPoint(250, 250, 100, 720);
  assert.equal(noonPt.x, 250);
  assert.equal(noonPt.y, 150);

  const wedge = solarRingWedgePath(250, 250, 120, 180, 540, 660);
  assert.ok(wedge.startsWith("M "));
  assert.ok(wedge.includes(" A 180 180 "));
  assert.ok(wedge.endsWith(" Z"));
});

test("groupBlocksByTrack and computeFocusSummary separate categories and detect active block", () => {
  const state = emptyState();
  const date = "2026-11-23";
  state.projects.push({
    id: "proj-1",
    title: "Q4 Launch",
    outcome: "Launch publicly",
    startingPoint: "Draft ready",
    notes: "",
    deadline: "2026-12-01",
    status: "active",
    milestones: [
      {
        id: "ms-1",
        title: "Design lock",
        date: "2026-11-26",
        reason: "",
        approved: true,
        completed: false,
        dependsOn: [],
        estimate: 120,
      },
    ],
  });
  state.tasks.push(
    {
      id: "t-solo",
      title: "Solo admin",
      notes: "",
      estimate: 30,
      remaining: 30,
      projectId: null,
      milestoneId: null,
      deadlineId: null,
      importance: "normal",
      status: "active",
      createdAt: "2026-11-23T08:00:00.000Z",
      completedAt: null,
    },
    {
      id: "t-proj",
      title: "Ship hero copy",
      notes: "",
      estimate: 60,
      remaining: 60,
      projectId: "proj-1",
      milestoneId: "ms-1",
      deadlineId: null,
      importance: "high",
      status: "active",
      createdAt: "2026-11-23T08:00:00.000Z",
      completedAt: null,
    },
  );
  state.sessions.push(
    {
      id: "s-1",
      taskId: "t-solo",
      date,
      start: "09:00",
      duration: 60,
      outcome: "pending",
      actualMinutes: null,
      note: "",
      needsReview: false,
    },
    {
      id: "s-2",
      taskId: "t-proj",
      date,
      start: "11:00",
      duration: 60,
      outcome: "pending",
      actualMinutes: null,
      note: "",
      needsReview: false,
    },
  );
  const events = calendarEventIntervals(state);
  const blocks = blocksForDay(state, date, events);
  const tracks = groupBlocksByTrack(blocks, state);
  assert.equal(tracks.find((t) => t.key === "tasks")?.blocks.length, 1);
  assert.equal(tracks.find((t) => t.key === "projects")?.blocks.length, 1);

  const summary = computeFocusSummary(state, date, date, 9 * 60 + 30, events);
  assert.equal(summary.activeBlock?.id, "s-1");
  assert.equal(summary.activeProgressPct, 50);
  assert.equal(summary.projectVelocity.length, 1);
  assert.equal(summary.projectVelocity[0]?.nextMilestone, "Design lock");
});

test("parseTerminalCommand handles navigation, search, and quick task creation", () => {
  assert.deepEqual(parseTerminalCommand("today"), { type: "today" });
  assert.deepEqual(parseTerminalCommand("next"), { type: "shift", days: 1 });
  assert.deepEqual(parseTerminalCommand("f2"), { type: "view", view: "tasks" });
  assert.deepEqual(parseTerminalCommand("new Write launch memo"), {
    type: "newTask",
    title: "Write launch memo",
  });
  assert.deepEqual(parseTerminalCommand("/roadmap"), {
    type: "search",
    query: "roadmap",
  });
});

test("classifyTaskBuckets groups urgent, unscheduled, scheduled, missing estimates, and completed tasks", () => {
  const state = emptyState();
  const today = "2026-11-23";
  state.deadlines.push({
    id: "dl-1",
    title: "Exam",
    date: "2026-11-25",
    time: "09:00",
    projectId: null,
    notes: "",
    status: "active",
  });
  state.tasks.push(
    {
      id: "t-urgent",
      title: "Study chapters",
      notes: "",
      estimate: 60,
      remaining: 60,
      projectId: null,
      milestoneId: null,
      deadlineId: "dl-1",
      importance: "normal",
      status: "active",
      createdAt: "2026-11-23T08:00:00Z",
      completedAt: null,
    },
    {
      id: "t-missing",
      title: "Email advisor",
      notes: "",
      estimate: null,
      remaining: null,
      projectId: null,
      milestoneId: null,
      deadlineId: null,
      importance: "high",
      status: "active",
      createdAt: "2026-11-23T08:05:00Z",
      completedAt: null,
    },
    {
      id: "t-done",
      title: "Archive notes",
      notes: "",
      estimate: 15,
      remaining: 0,
      projectId: null,
      milestoneId: null,
      deadlineId: null,
      importance: "normal",
      status: "completed",
      createdAt: "2026-11-22T08:00:00Z",
      completedAt: "2026-11-22T09:00:00Z",
    },
  );
  state.sessions.push({
    id: "s-1",
    taskId: "t-urgent",
    date: today,
    start: "10:00",
    duration: 60,
    outcome: "completed",
    actualMinutes: 60,
    note: "",
    needsReview: false,
  });

  const buckets = classifyTaskBuckets(state, today);
  assert.equal(buckets.entries.length, 3);
  assert.equal(buckets.urgent.length, 2);
  assert.equal(buckets.scheduled.length, 1);
  assert.equal(buckets.unscheduled.length, 1);
  assert.equal(buckets.needsEstimate.length, 1);
  assert.equal(buckets.completed.length, 1);
  assert.equal(buckets.scheduled[0]?.completedSessionCount, 1);
});

test("computeRoutineCadenceSummary, computeDeadlineUrgency, and computeProjectTimelineSpans produce deterministic view models", () => {
  const state = emptyState();
  const today = "2026-11-23"; // Monday (day 1)
  state.routines.push({
    id: "r-1",
    title: "Morning run",
    days: [1, 3, 5],
    start: "07:00",
    duration: 30,
    untimed: false,
    since: "2026-11-01",
    until: null,
    paused: false,
    color: "sage",
  });
  state.routineRecords.push({
    routineId: "r-1",
    date: today,
    outcome: "completed",
    note: "",
  });

  const routines = computeRoutineCadenceSummary(state, today);
  assert.equal(routines.length, 1);
  assert.equal(routines[0]?.todayScheduled, true);
  assert.equal(routines[0]?.todayOutcome, "completed");
  assert.equal(routines[0]?.recentCompleted, 1);
  assert.equal(routines[0]?.daysPerWeek, 3);
  assert.equal(routines[0]?.weeklyMask[0]?.isToday, true);

  state.deadlines.push(
    {
      id: "dl-overdue",
      title: "Late paper",
      date: "2026-11-21",
      time: "",
      projectId: null,
      notes: "",
      status: "active",
    },
    {
      id: "dl-resolved",
      title: "Done form",
      date: "2026-11-20",
      time: "",
      projectId: null,
      notes: "",
      status: "resolved",
    },
  );
  const activeOnly = computeDeadlineUrgency(state, today, false);
  assert.equal(activeOnly.length, 1);
  assert.equal(activeOnly[0]?.band, "overdue");
  assert.equal(formatCountdownLabel(-2, false), "2d overdue");
  assert.equal(formatCountdownLabel(0, false), "Due today");

  state.projects.push({
    id: "p-1",
    title: "Alpha Release",
    outcome: "Ship v1",
    startingPoint: "Prototype",
    notes: "",
    deadline: "2026-12-14",
    status: "active",
    milestones: [
      {
        id: "m-1",
        title: "Spec lock",
        date: "2026-11-30",
        reason: "",
        approved: true,
        completed: true,
        dependsOn: [],
        estimate: 60,
      },
    ],
  });
  const timeline = computeProjectTimelineSpans(state, state.projects, today);
  assert.equal(timeline.spans.length, 1);
  assert.ok(timeline.spans[0]!.endPct > timeline.spans[0]!.startPct);
  assert.equal(timeline.spans[0]?.doneMilestones, 1);
});

test("wild-planner-extra builders compute open slots, transit lines, CAD elevation, habit ink matrix, and gallery wings", () => {
  const state = emptyState();
  state.settings.workStart = "09:00";
  state.settings.workEnd = "18:00";
  const today = "2026-11-23"; // Monday (day 1)

  state.projects.push({
    id: "p-metro",
    title: "Station Signage",
    outcome: "Install signage",
    startingPoint: "Specs written",
    notes: "",
    deadline: "2026-12-10",
    status: "active",
    milestones: [
      {
        id: "m-2",
        title: "Fabricate",
        date: "2026-12-03",
        reason: "",
        approved: true,
        completed: false,
        dependsOn: [],
        estimate: 120,
      },
      {
        id: "m-1",
        title: "Typography",
        date: "2026-11-27",
        reason: "",
        approved: true,
        completed: true,
        dependsOn: [],
        estimate: 90,
      },
    ],
  });

  state.tasks.push(
    {
      id: "t-a",
      title: "Morning sketch",
      notes: "",
      estimate: 60,
      remaining: 60,
      projectId: null,
      milestoneId: null,
      deadlineId: null,
      importance: "high",
      status: "active",
      createdAt: "2026-11-23T08:00:00Z",
      completedAt: null,
    },
    {
      id: "t-b",
      title: "Evening critique",
      notes: "",
      estimate: 60,
      remaining: 60,
      projectId: "p-metro",
      milestoneId: "m-2",
      deadlineId: null,
      importance: "normal",
      status: "active",
      createdAt: "2026-11-23T08:05:00Z",
      completedAt: null,
    },
  );

  state.sessions.push(
    {
      id: "s-morning",
      taskId: "t-a",
      date: today,
      start: "10:00",
      duration: 90, // 10:00 -> 11:30
      outcome: "completed",
      actualMinutes: 90,
      note: "",
      needsReview: false,
    },
    {
      id: "s-evening",
      taskId: "t-b",
      date: today,
      start: "17:15",
      duration: 45, // 17:15 -> 18:00
      outcome: "pending",
      actualMinutes: null,
      note: "",
      needsReview: false,
    },
  );

  state.routines.push({
    id: "r-ink",
    title: "Sketchbook ink",
    days: [1, 3, 5],
    start: "13:00",
    duration: 30,
    untimed: false,
    since: "2026-11-01",
    until: null,
    paused: false,
    color: "sage",
  });
  state.routineRecords.push({
    routineId: "r-ink",
    date: today,
    outcome: "completed",
    note: "",
  });

  const events = calendarEventIntervals(state);
  const blocks = blocksForDay(state, today, events);

  const openSlots = computeOpenDaySlots(state, today, events, 30);
  assert.deepEqual(
    openSlots.map((s) => `${s.startClock}-${s.endClock}`),
    ["09:00-10:00", "11:30-13:00", "13:30-17:15"],
  );

  const lines = buildTransitRouteLines(state, blocks);
  assert.equal(lines.length, 4);
  assert.equal(lines.find((l) => l.key === "tasks")?.stations[0]?.stationCode, "R1-01");
  assert.equal(lines.find((l) => l.key === "projects")?.stations[0]?.stationCode, "A2-01");
  assert.equal(lines.find((l) => l.key === "routines")?.stations[0]?.completed, true);

  const projectStations = computeProjectMetroStations(state.projects[0]!);
  assert.equal(projectStations.length, 3);
  assert.equal(projectStations[0]?.title, "Typography");
  assert.equal(projectStations[1]?.title, "Fabricate");
  assert.equal(projectStations[2]?.isTerminus, true);

  const blueprint = buildBlueprintElevationData(state, blocks, openSlots);
  assert.equal(blueprint.gaps.length, 3);
  assert.equal(blueprint.layers.find((l) => l.key === "tasks")?.bars.length, 1);

  const matrix = computeHabitInkMatrix(state, today, 14);
  assert.equal(matrix.dates.length, 14);
  assert.equal(matrix.dates[13]?.date, today);
  assert.equal(matrix.rows.length, 1);
  assert.equal(matrix.rows[0]?.completedInWindow, 1);
  assert.equal(matrix.rows[0]?.cells[13]?.scheduled, true);
  assert.equal(matrix.rows[0]?.cells[13]?.outcome, "completed");

  const gallery = partitionGalleryWings(blocks, openSlots);
  assert.equal(gallery.wings[0]?.blocks.length, 1); // 10:00 Morning
  assert.equal(gallery.wings[1]?.blocks.length, 1); // 13:00 Afternoon
  assert.equal(gallery.wings[2]?.blocks.length, 1); // 17:15 Evening

  const cosmos = buildConstellationDiagram(state, blocks, openSlots);
  assert.equal(cosmos.stars.length, 3);
  assert.equal(cosmos.stars[0]?.orbit, "inner");
  assert.equal(cosmos.stars[1]?.orbit, "mid");
  assert.equal(cosmos.stars[2]?.orbit, "outer");

  const rack = buildSynthRackData(state, blocks, openSlots);
  assert.equal(rack.steps.length, 16);
  assert.equal(rack.cables.length, 2);
  assert.equal(rack.jacks.length, 3);

  const zine = buildZineSpreadData(state, blocks, [{ task: state.tasks[1]! }]);
  assert.equal(zine.clippings.length, 3);
  assert.equal(zine.completedCount, 2);
  assert.equal(zine.leadClipping?.block.title, "Evening critique");

  const arena = buildArenaBoardSquares(state, blocks);
  assert.equal(arena.length, 16);
  assert.equal(arena[0]?.coord, "A1");
  assert.equal(arena[15]?.coord, "D4");
  assert.equal(arena.find((sq) => sq.hour === 10)?.primaryBlock?.title, "Morning sketch");
});



