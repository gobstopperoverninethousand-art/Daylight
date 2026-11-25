import { clockMinutes, dayKey, type State } from "./model";
import { blocksForDay, calendarEventIntervals } from "./engine";
import { deadlineEntries } from "./deadlines";

export const EXPERIENCE_IDS = [
  "original",
  "broadsheet",
  "cockpit",
  "bauhaus",
  "flow",
  "zen",
  "sundial",
  "timeline",
  "terminal",
  "retro98",
  "mission",
  "transit",
  "blueprint",
  "notebook",
  "gallery",
  "constellation",
  "synth",
  "zine",
  "arena",
] as const;

export type ExperienceId = (typeof EXPERIENCE_IDS)[number];

export type ExperienceCategory = "classic" | "wild";
export type ShellMode = "top" | "rail" | "command" | "taskbar";

export const DEFAULT_EXPERIENCE: ExperienceId = "original";
export const EXPERIENCE_STORAGE_KEY = "daylight:experience";

export type ExperienceMeta = {
  id: ExperienceId;
  name: string;
  shortName: string;
  category: ExperienceCategory;
  tagline: string;
  layoutSummary: string;
  typography: string;
  swatches: [string, string, string];
  dark: boolean;
  navLayout: "top" | "rail";
  shellMode: ShellMode;
  wildModeLabel?: string;
};

export const EXPERIENCES: readonly ExperienceMeta[] = [
  { id: "original", name: "Original Daylight", shortName: "Original", category: "classic", tagline: "The original Daylight workspace.", layoutSummary: "Original sidebar, calendar, and work views", typography: "DM Sans", swatches: ["#f6f6f2", "#222920", "#527044"], dark: false, navLayout: "rail", shellMode: "rail" },
  {
    id: "broadsheet",
    name: "Editorial Broadsheet",
    shortName: "Broadsheet",
    category: "classic",
    tagline: "Newspaper almanac with serif masthead and morning dispatch.",
    layoutSummary: "Top masthead · Front-page dispatch · Ruled calendar spread",
    typography: "Fraunces + DM Sans",
    swatches: ["#FAF7F0", "#171614", "#B83A1B"],
    dark: false,
    navLayout: "top",
    shellMode: "top",
  },
  {
    id: "cockpit",
    name: "Midnight Cockpit",
    shortName: "Cockpit",
    category: "classic",
    tagline: "Obsidian dark workspace with live capacity strip and command rail.",
    layoutSummary: "Command rail · Capacity telemetry · High-contrast time grid",
    typography: "Plus Jakarta Sans + JetBrains Mono",
    swatches: ["#0B0E14", "#151B26", "#F59E0B"],
    dark: true,
    navLayout: "rail",
    shellMode: "rail",
  },
  {
    id: "bauhaus",
    name: "Bauhaus Studio",
    shortName: "Bauhaus",
    category: "classic",
    tagline: "Swiss architectural grid, stark ink rules, and primary color blocks.",
    layoutSummary: "Numbered top ribbon · 2px Swiss grid · Color-coded schedule",
    typography: "Outfit + JetBrains Mono",
    swatches: ["#FFFFFF", "#1B4DFF", "#E13B22"],
    dark: false,
    navLayout: "top",
    shellMode: "top",
  },
  {
    id: "flow",
    name: "Kanban Flow",
    shortName: "Flow",
    category: "classic",
    tagline: "Three-column spatial workbench pairing backlog, grid, and execution.",
    layoutSummary: "Left backlog · Center calendar · Right Today execution stream",
    typography: "Bricolage Grotesque + DM Sans",
    swatches: ["#F4F6F9", "#FFFFFF", "#4F46E5"],
    dark: false,
    navLayout: "top",
    shellMode: "top",
  },
  {
    id: "zen",
    name: "Zen Paper",
    shortName: "Zen",
    category: "classic",
    tagline: "Calm Japanese techo minimalism on warm washi with notebook rail.",
    layoutSummary: "Airy centered canvas · Morning horizon · Ruled notebook rail",
    typography: "Fraunces + Plus Jakarta Sans",
    swatches: ["#F7F4ED", "#2B4162", "#4A6B53"],
    dark: false,
    navLayout: "top",
    shellMode: "top",
  },
  {
    id: "sundial",
    name: "Solar Dial",
    shortName: "Sundial",
    category: "wild",
    tagline: "Circular 24-hour orbital clockface with live solar hand and arc wedges.",
    layoutSummary: "Orbital SVG clock · Daylight window arc · 1-click slot snapping",
    typography: "Outfit + JetBrains Mono",
    swatches: ["#090D16", "#162038", "#F5B74F"],
    dark: true,
    navLayout: "top",
    shellMode: "top",
    wildModeLabel: "Dial",
  },
  {
    id: "timeline",
    name: "Studio Tape",
    shortName: "Tape",
    category: "wild",
    tagline: "Horizontal DAW multi-track timeline running left-to-right across lanes.",
    layoutSummary: "Horizontal hour ruler · 4 category swimlanes · Bottom clip rack",
    typography: "Bricolage Grotesque + JetBrains Mono",
    swatches: ["#141518", "#202227", "#FF5A36"],
    dark: true,
    navLayout: "top",
    shellMode: "top",
    wildModeLabel: "Tape",
  },
  {
    id: "terminal",
    name: "CRT Phosphor Console",
    shortName: "Terminal",
    category: "wild",
    tagline: "Zero-radius phosphor terminal with live CLI prompt and ASCII Gantt matrix.",
    layoutSummary: "CLI prompt bar · Function-key nav · Tabular phosphor ledger",
    typography: "JetBrains Mono",
    swatches: ["#050906", "#0D1A10", "#4ADE80"],
    dark: true,
    navLayout: "top",
    shellMode: "command",
    wildModeLabel: "Console",
  },
  {
    id: "retro98",
    name: "Daylight 98 Desktop",
    shortName: "Desktop 98",
    category: "wild",
    tagline: "Tactile beveled 1998 desktop OS with multi-window frames and Start taskbar.",
    layoutSummary: "Bottom Start taskbar · Beveled .exe windows · Classic tray clock",
    typography: "DM Sans + JetBrains Mono",
    swatches: ["#008080", "#C0C0C0", "#000080"],
    dark: false,
    navLayout: "top",
    shellMode: "taskbar",
    wildModeLabel: "Desktop",
  },
  {
    id: "mission",
    name: "Focus Deck",
    shortName: "Deck",
    category: "wild",
    tagline: "Spatial Now-Focusing stage paired with Today/Tomorrow twin horizon.",
    layoutSummary: "Active focus ring · Twin-day river · Project velocity & deadline radar",
    typography: "Bricolage Grotesque + DM Sans",
    swatches: ["#F5F4F0", "#141414", "#FF4D1C"],
    dark: false,
    navLayout: "top",
    shellMode: "top",
    wildModeLabel: "Deck",
  },
  {
    id: "transit",
    name: "Metro Transit Diagram",
    shortName: "Transit",
    category: "wild",
    tagline: "Vignelli/Beck metro network turning daily blocks & milestones into route lines.",
    layoutSummary: "SVG transit lines · Interchange boarding stops · Multi-stop project routes",
    typography: "Plus Jakarta Sans + JetBrains Mono",
    swatches: ["#F7F5EE", "#DC2626", "#0284C7"],
    dark: false,
    navLayout: "top",
    shellMode: "top",
    wildModeLabel: "Transit",
  },
  {
    id: "blueprint",
    name: "CAD Drafting Sheet",
    shortName: "Blueprint",
    category: "wild",
    tagline: "Prussian cyanotype architectural table with elevation dimensions & coordinate grid.",
    layoutSummary: "Architectural cyanotype · Elevation bars · Open-gap dimension calipers",
    typography: "Plus Jakarta Sans + JetBrains Mono",
    swatches: ["#081B33", "#102A4C", "#FBBF24"],
    dark: true,
    navLayout: "top",
    shellMode: "top",
    wildModeLabel: "Sheet",
  },
  {
    id: "notebook",
    name: "Dot-Grid Journal",
    shortName: "Dot-Grid",
    category: "wild",
    tagline: "Fountain-pen bullet journal on dotted cotton paper with 14-day habit ink grid.",
    layoutSummary: "Two-page rapid log · Ink signifiers (• × →) · 14-day habit ink matrix",
    typography: "Fraunces + DM Sans",
    swatches: ["#FBF8F1", "#1E293B", "#B91C1C"],
    dark: false,
    navLayout: "top",
    shellMode: "top",
    wildModeLabel: "Spread",
  },
  {
    id: "gallery",
    name: "Museum Exhibition",
    shortName: "Exhibition",
    category: "wild",
    tagline: "Curatorial archive on warm limestone with spatial wing plinths and accession placards.",
    layoutSummary: "3-wing floorplan · Numbered plinths · Curatorial catalogue & wall plaques",
    typography: "Fraunces + Plus Jakarta Sans",
    swatches: ["#F3EFE7", "#191816", "#881337"],
    dark: false,
    navLayout: "top",
    shellMode: "top",
    wildModeLabel: "Gallery",
  },
  {
    id: "constellation",
    name: "Orbital Constellation",
    shortName: "Cosmos",
    category: "wild",
    tagline: "Astronomical polar star map charting blocks across Morning, Afternoon, and Evening orbits.",
    layoutSummary: "Polar star chart · Azimuth docking rings · Ephemeris inspector",
    typography: "Plus Jakarta Sans + JetBrains Mono",
    swatches: ["#060913", "#131C33", "#F6C453"],
    dark: true,
    navLayout: "top",
    shellMode: "top",
    wildModeLabel: "Orbit",
  },
  {
    id: "synth",
    name: "Modular Patch Rack",
    shortName: "Modular",
    category: "wild",
    tagline: "Anodized Eurorack 16-step sequencer patching hourly time modules and CV jacks.",
    layoutSummary: "16-hour step rack · Patch cable routing · Oscillator queue",
    typography: "Outfit + JetBrains Mono",
    swatches: ["#16171B", "#262830", "#F59E0B"],
    dark: true,
    navLayout: "top",
    shellMode: "top",
    wildModeLabel: "Patch",
  },
  {
    id: "zine",
    name: "Risograph Tear Sheet",
    shortName: "Riso Zine",
    category: "wild",
    tagline: "Two-ink fluorescent pink and cobalt risograph collage issue with cut-paper clippings.",
    layoutSummary: "Cover story block · Riso proof clippings · Issue colophon",
    typography: "Fraunces + JetBrains Mono",
    swatches: ["#F6F2E9", "#E11D48", "#1D4ED8"],
    dark: false,
    navLayout: "top",
    shellMode: "top",
    wildModeLabel: "Zine",
  },
  {
    id: "arena",
    name: "Tactical Board Arena",
    shortName: "Arena",
    category: "wild",
    tagline: "Tournament felt and ivory 4x4 coordinate board placing day blocks across A1–D4 hours.",
    layoutSummary: "4x4 A1–D4 board · Piece reserve bench · Algebraic move log",
    typography: "Fraunces + DM Sans",
    swatches: ["#0F3D2E", "#F9F6EE", "#D97706"],
    dark: true,
    navLayout: "top",
    shellMode: "top",
    wildModeLabel: "Board",
  },
] as const;

export function isExperienceId(value: string | null | undefined): value is ExperienceId {
  return !!value && (EXPERIENCE_IDS as readonly string[]).includes(value);
}

export function isWildExperience(id: ExperienceId): boolean {
  return getExperience(id).category === "wild";
}

export function getExperience(id: ExperienceId): ExperienceMeta {
  return EXPERIENCES.find((item) => item.id === id) ?? EXPERIENCES[0];
}

export function resolveExperience(
  searchStyle?: string | null,
  storedStyle?: string | null,
): ExperienceId {
  if (isExperienceId(searchStyle)) return searchStyle;
  if (isExperienceId(storedStyle)) return storedStyle;
  return DEFAULT_EXPERIENCE;
}

export type DayTelemetry = {
  date: string;
  scheduledMinutes: number;
  capacityMinutes: number;
  openMinutes: number;
  completedBlocks: number;
  totalBlocks: number;
  activeTasks: number;
  unscheduledTasks: number;
  dueSoonCount: number;
  nextBlockTitle: string | null;
};

export function computeDayTelemetry(state: State, date: string): DayTelemetry {
  const events = calendarEventIntervals(state);
  const blocks = blocksForDay(state, date, events);
  const timedBlocks = blocks.filter((b) => !b.allDay);
  const scheduledMinutes = timedBlocks.reduce((sum, b) => sum + b.duration, 0);
  const windowMinutes = Math.max(
    0,
    clockMinutes(state.settings.workEnd) - clockMinutes(state.settings.workStart),
  );
  const openMinutes = Math.max(0, windowMinutes - scheduledMinutes);

  const actionableBlocks = blocks.filter((b) => b.kind !== "external");
  const completedBlocks = actionableBlocks.filter(
    (b) => b.outcome === "completed",
  ).length;

  const activeTasks = state.tasks.filter(
    (t) => t.status === "active" && !t.deletedProject,
  );
  const scheduledTaskSet = new Set(state.sessions.map((s) => s.taskId));
  const unscheduledTasks = activeTasks.filter(
    (t) => !scheduledTaskSet.has(t.id),
  ).length;

  const today = dayKey();
  const dueSoonLimit = (() => {
    const base = new Date(today + "T12:00:00Z");
    base.setUTCDate(base.getUTCDate() + 7);
    return base.toISOString().slice(0, 10);
  })();
  const dueSoonCount = deadlineEntries(state).filter(
    (entry) => !entry.resolved && entry.date <= dueSoonLimit,
  ).length;

  const nextBlock = timedBlocks
    .filter((b) => b.outcome !== "completed")
    .sort((a, b) => a.start - b.start)[0];

  return {
    date,
    scheduledMinutes,
    capacityMinutes: windowMinutes,
    openMinutes,
    completedBlocks,
    totalBlocks: actionableBlocks.length,
    activeTasks: activeTasks.length,
    unscheduledTasks,
    dueSoonCount,
    nextBlockTitle: nextBlock?.title ?? null,
  };
}
