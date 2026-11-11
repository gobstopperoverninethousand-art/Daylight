"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  Sunrise,
  CalendarDays,
  CheckSquare2,
  FolderOpen,
  Flag,
  Repeat2,
  ChartNoAxesCombined,
  Settings2,
  Plus,
  Search,
  ChevronDown,
  ArrowUpRight,
  Sun,
  Menu,
  X,
  Cloud,
  HardDrive,
  RefreshCw,
  Sparkles,
  ArrowRight,
  Check,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useWorkspace } from "@/lib/use-workspace";
import {
  State,
  Outcome,
  dayKey,
  clockMinutes,
  defaultSessionDuration,
  uid,
  audit,
  assessmentSchema,
  stateSchema,
} from "@/lib/model";
import { Editor, EditorState } from "./editor";
import { Planner } from "./calendar";
import { GoogleEventDetails } from "./google-event-details";
import { timeEditorValues } from "@/lib/google-event-edit";
import type {
  EventDrop,
  EventTime,
  GoogleEventInfo,
  ImportedEvent,
} from "@/lib/google-event-edit";
import { makeSnapshot } from "@/lib/engine";
import {
  evidenceKey,
  priorityResultSchema,
  projectDraftKey,
  workspaceDay,
} from "@/lib/ai-freshness";
import { Tasks, Deadlines, Routines, Projects } from "./work-views";
import { Progress } from "./review";
import { Settings, Health, download } from "./settings";
import { IconButton, Dialog, Badge, Field } from "./ui";
type SyncMode = "full" | "push" | "pull";
type View =
  | "planner"
  | "tasks"
  | "projects"
  | "deadlines"
  | "routines"
  | "progress"
  | "settings";
function googleSyncFingerprint(s: State) {
  return JSON.stringify({
    settings: {
      calendarId: s.settings.calendarId,
      syncHolidays: s.settings.syncHolidays,
      timezone: s.settings.timezone,
    },
    tasks: s.tasks,
    sessions: s.sessions,
    routines: s.routines,
    exceptions: s.exceptions,
    deadlines: s.deadlines,
    projects: s.projects,
  });
}
const nav = [
  { id: "planner", label: "Planner", icon: CalendarDays },
  { id: "tasks", label: "Tasks", icon: CheckSquare2 },
  { id: "projects", label: "Projects", icon: FolderOpen },
  { id: "deadlines", label: "Deadlines", icon: Flag },
  { id: "routines", label: "Routines", icon: Repeat2 },
  { id: "progress", label: "Progress", icon: ChartNoAxesCombined },
] as const;
export default function Daylight() {
  const workspace = useWorkspace();
  const { state, ready, update, auth, mode, status, error } = workspace;
  const [view, setView] = useState<View>("planner"),
    [date, setDate] = useState(dayKey()),
    [modal, setModal] = useState<EditorState | null>(null),
    [googleSelection, setGoogleSelection] = useState<{
      id: string;
      request: number;
      info?: GoogleEventInfo;
      infoLoading?: boolean;
      infoError?: string;
    } | null>(null),
    [toast, setToast] = useState(""),
    [mobile, setMobile] = useState(false),
    [quick, setQuick] = useState(false),
    [health, setHealth] = useState<Health | null>(null),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState<string | null>(null),
    [conflicts, setConflicts] = useState<
      { title: string; reason: string; url?: string }[] | null
    >(null),
    [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const autoSyncBaseline = useRef<string | null>(null);
  const autoSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failedSync = useRef<string | null>(null);
  const busyNow = useRef(false);
  const syncing = useRef(false);
  const actionEpoch = useRef(0);
  const lastPull = useRef(0);
  const latestState = useRef(state);
  const runSyncRef = useRef<(m?: SyncMode) => Promise<void>>(async () => {});
  const [syncProblem, setSyncProblem] = useState<{
    message: string;
    conflicts?: { title: string; reason: string; url?: string }[];
  } | null>(null);
  const [taskDrafts, setTaskDrafts] = useState<{
    projectId: string;
    milestoneId: string;
    version: string;
    tasks: { title: string; notes: string }[];
  } | null>(null);
  const latestMode = useRef(mode);
  latestMode.current = mode;
  latestState.current = state;
  busyNow.current = busy;
  const detailsRequest = useRef(0);
  const planningDay = workspaceDay(state);
  const savedPriorityRun = state.aiRuns.findLast(
    (run) => run.kind === "priorities",
  );
  const savedPriorities = priorityResultSchema.safeParse(
    savedPriorityRun?.output,
  );
  const priorityInput = evidenceKey(state, planningDay);
  const aiPriorities = savedPriorities.success
    ? {
        ...savedPriorities.data,
        stale: savedPriorityRun?.inputKey !== priorityInput,
        createdAt: savedPriorityRun!.createdAt,
      }
    : null;
  const notify = useCallback((text: string) => setToast(text), []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => {});
    const query = new URLSearchParams(window.location.search);
    if (query.has("google")) {
      setView("settings");
      setToast(
        query.get("google") === "connected"
          ? "Google Calendar connected. Choose a calendar and sync when ready."
          : "Google connection was not completed. Check OAuth configuration and try again.",
      );
      history.replaceState({}, "", window.location.pathname);
    }
    const keyboard = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearch("");
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, []);
  const change = (fn: (s: State) => void) => {
    try {
      update(fn);
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const edit = (m: EditorState) => {
    setModal(m);
    setQuick(false);
  };
  async function api(
    path: string,
    body?: unknown,
    method = "POST",
    timeoutMs = 120000,
  ) {
    if (mode === "demo")
      throw new Error(
        "Exit the sample workspace before using a live integration.",
      );
    if (!auth)
      throw new Error("Sign in under Settings to use this integration.");
    const token = await workspace.token();
    let res: Response;
    try {
      res = await fetch(path, {
        method,
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(timeoutMs),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      throw new Error(
        (e as Error).name === "TimeoutError"
          ? "Daylight stopped waiting after " +
              Math.round(timeoutMs / 1000) +
              " seconds. Your records are unchanged. Try again."
          : "Could not reach Daylight's server. Check that it is running.",
      );
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed.");
    return data;
  }
  // full: verify every linked event (Sync now). push: write what changed, then
  // import. pull: import only, quietly, so Google edits appear on their own.
  async function runSync(syncMode: SyncMode = "full") {
    if (busyNow.current || syncing.current || mode === "demo" || !auth) return;
    const quiet = syncMode === "pull";
    const startedMode = latestMode.current;
    const epoch = actionEpoch.current;
    const sent = latestState.current;
    syncing.current = true;
    if (!quiet) setBusy(true);
    try {
      const r = await api(
        "/api/google/sync",
        { state: sent, mode: syncMode },
        "POST",
        syncMode === "pull" ? 60000 : 180000,
      );
      if (latestMode.current !== startedMode) return;
      if (quiet) {
        // Skip if the user did something meanwhile or nothing changed.
        if (actionEpoch.current !== epoch) return;
        if (r.conflicts?.length) {
          setSyncProblem({
            message: `${r.conflicts.length} calendar change${r.conflicts.length === 1 ? "" : "s"} need review.`,
            conflicts: r.conflicts,
          });
        } else setSyncProblem(null);
        if (
          JSON.stringify(r.events) ===
          JSON.stringify(latestState.current.events)
        )
          return;
        update((s) => {
          s.events = r.events;
        });
        return;
      }
      const quietWrite =
        syncMode === "push" && !r.written && !r.conflicts.length;
      update((s) => {
        s.links = r.links;
        s.events = r.events;
        s.settings.lastSync = r.conflicts.length ? null : r.lastSync;
        if (!quietWrite)
          audit(
            s,
            `Google sync: ${r.written} writes, ${r.conflicts.length} conflicts`,
            "calendar",
          );
      });
      autoSyncBaseline.current = googleSyncFingerprint(sent);
      failedSync.current = null;
      setSyncProblem(
        r.conflicts.length
          ? {
              message: `${r.conflicts.length} calendar change${r.conflicts.length === 1 ? "" : "s"} need review.`,
              conflicts: r.conflicts,
            }
          : null,
      );
      setConflicts(r.conflicts.length ? r.conflicts : null);
      if (syncMode === "full") {
        notify(
          r.conflicts.length
            ? `Sync needs review: ${r.conflicts.length} conflict(s).`
            : `Calendar synchronized. ${r.written} change(s), ${r.events.length} imported events.`,
        );
      }
    } catch (e) {
      if (quiet) return;
      failedSync.current = googleSyncFingerprint(sent);
      const message = (e as Error).message;
      setSyncProblem({ message: "Google Calendar sync failed. " + message });
      if (syncMode === "full") notify(message);
    } finally {
      syncing.current = false;
      if (!quiet) setBusy(false);
    }
  }
  runSyncRef.current = runSync;
  const sync = () => void runSync("full");
  useEffect(() => {
    if (busy) actionEpoch.current++;
  }, [busy]);
  // Once Google has synced successfully, keep both sides current.
  const userId = auth?.user.id;
  const googleLinked = !!state.settings.lastSync || state.links.length > 0;
  useEffect(() => {
    if (!ready || !userId || mode === "demo") return;
    const fingerprint = googleSyncFingerprint(state);
    if (autoSyncBaseline.current === null) {
      autoSyncBaseline.current = fingerprint;
      return;
    }
    if (
      !googleLinked ||
      fingerprint === autoSyncBaseline.current ||
      fingerprint === failedSync.current
    )
      return;
    if (autoSyncTimer.current) clearTimeout(autoSyncTimer.current);
    autoSyncTimer.current = setTimeout(() => {
      autoSyncTimer.current = null;
      if (busyNow.current || syncing.current) {
        // Try again shortly rather than dropping the change.
        autoSyncTimer.current = setTimeout(
          () => void runSyncRef.current("push"),
          3000,
        );
        return;
      }
      void runSyncRef.current("push");
    }, 3000);
    return () => {
      if (autoSyncTimer.current) clearTimeout(autoSyncTimer.current);
    };
  }, [state, ready, userId, mode, googleLinked]);
  useEffect(() => {
    if (!ready || !userId || mode === "demo" || !googleLinked) return;
    const tick = (force = false) => {
      if (
        document.visibilityState === "hidden" ||
        busyNow.current ||
        syncing.current
      )
        return;
      if (!force && Date.now() - lastPull.current < 20000) return;
      lastPull.current = Date.now();
      const dirty =
        googleSyncFingerprint(latestState.current) !== autoSyncBaseline.current;
      // Unsynced edits (including after a failure) are retried here too.
      void runSyncRef.current(dirty ? "push" : "pull");
    };
    // Catch up on anything that changed while Daylight was closed.
    const first = setTimeout(() => {
      lastPull.current = Date.now();
      void runSyncRef.current("push");
    }, 1500);
    const id = setInterval(() => tick(true), 60000);
    const wake = () => tick();
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [ready, userId, mode, googleLinked]);
  const googleEvent = state.events.find(
    (event) => event.id === googleSelection?.id,
  );
  function openGoogleEvent(id: string) {
    const event = state.events.find((e) => e.id === id);
    if (!event) return;
    const request = ++detailsRequest.current;
    const infoLoading = !!event.googleId && !!auth && mode !== "demo";
    setGoogleSelection({ id, request, infoLoading });
    if (infoLoading) {
      const query = new URLSearchParams({
        calendarId: event.calendarId,
        eventId: event.googleId!,
      });
      void api("/api/google/events?" + query, undefined, "GET").then(
        (info: GoogleEventInfo) =>
          setGoogleSelection((current) =>
            current?.request === request && latestMode.current === mode
              ? { ...current, infoLoading: false, info }
              : current,
          ),
        (err: Error) =>
          setGoogleSelection((current) =>
            current?.request === request && latestMode.current === mode
              ? { ...current, infoLoading: false, infoError: err.message }
              : current,
          ),
      );
    }
  }
  async function moveGoogleEvent(event: ImportedEvent, time: EventTime) {
    if (busy)
      throw new Error("Wait for the current calendar or AI action to finish.");
    if (!event.canEdit || !event.googleId || !event.etag)
      throw new Error("This Google event cannot be moved from Daylight.");
    setBusy(true);
    try {
      const result = await api(
        "/api/google/events",
        {
          calendarId: event.calendarId,
          eventId: event.googleId,
          etag: event.etag,
          time,
        },
        "PATCH",
      );
      if (latestMode.current !== mode) return;
      update((s) => {
        const idx = s.events.findIndex((entry) => entry.id === event.id);
        if (idx >= 0) s.events[idx] = result.event;
        audit(s, "Updated imported Google event time", event.id);
      });
      notify("Event time updated in Google Calendar.");
    } finally {
      setBusy(false);
    }
  }
  async function dropGoogleBlock(id: string, target: EventDrop) {
    const event = state.events.find((entry) => entry.id === id);
    if (!event) return;
    try {
      const timezone = state.settings.timezone;
      const original = timeEditorValues(event, timezone);
      if (
        target.date === original.startDate &&
        (original.allDay ||
          !target.start ||
          target.start === original.startTime)
      )
        return;
      await moveGoogleEvent(event, timeEditorValues(event, timezone, target));
    } catch (err) {
      notify((err as Error).message);
    }
  }
  async function resizeGoogleBlock(
    id: string,
    date: string,
    start: string,
    duration: number,
  ) {
    const event = state.events.find((entry) => entry.id === id);
    if (!event) return;
    try {
      await moveGoogleEvent(
        event,
        timeEditorValues(event, state.settings.timezone, {
          date,
          start,
          duration,
        }),
      );
    } catch (err) {
      notify((err as Error).message);
    }
  }
  function scheduleDroppedTask(taskId: string, date: string, start: string) {
    change((s) => {
      const task = s.tasks.find(
        (entry) => entry.id === taskId && entry.status === "active",
      );
      if (!task)
        throw new Error("This task is no longer available to schedule.");
      const id = uid();
      s.sessions.push({
        id,
        taskId,
        date,
        start,
        duration: Math.min(
          defaultSessionDuration(task),
          1440 - clockMinutes(start),
        ),
        outcome: "pending",
        actualMinutes: null,
        note: "",
        needsReview: false,
      });
      audit(s, "Created session in planner", id);
    });
  }
  async function removeGoogleEvent(event: ImportedEvent) {
    if (!event.canDelete || !event.googleId || !event.etag || busy) return;
    setBusy(true);
    try {
      await api(
        "/api/google/events",
        {
          calendarId: event.calendarId,
          eventId: event.googleId,
          etag: event.etag,
        },
        "DELETE",
      );
      if (latestMode.current !== mode) return;
      update((s) => {
        s.events = s.events.filter((e) => e.id !== event.id);
        audit(s, "Deleted imported Google event", event.id);
      });
      setGoogleSelection(null);
      notify("Event removed from Google Calendar.");
    } finally {
      setBusy(false);
    }
  }
  async function propose(projectId: string) {
    if (busy) return;
    const inputKey = projectDraftKey(state, projectId, "milestones");
    setBusy(true);
    notify("Asking Gemini for milestone drafts. This can take up to a minute.");
    try {
      const result = await api("/api/projects/propose", { state, projectId });
      if (latestMode.current !== mode) return;
      update((s) => {
        const p = s.projects.find((p) => p.id === projectId)!;
        p.milestones.push(
          ...result.milestones.map(
            (m: State["projects"][number]["milestones"][number]) => ({
              ...m,
              reason: (
                m.reason +
                "\nPlanning assumptions: " +
                result.assumptions.join(" ")
              ).slice(0, 4000),
            }),
          ),
        );
        s.aiRuns.push({
          id: uid(),
          kind: "milestones",
          createdAt: new Date().toISOString(),
          version: result.version,
          inputKey,
          snapshot:
            result.snapshot || makeSnapshot(state, dayKey(), "", "", ""),
          output: result,
        });
        audit(s, "AI milestone drafts proposed · " + result.version, projectId);
      });
      notify(
        "Draft milestones added. Review their assumptions and approve each date.",
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function requestPriorities() {
    if (busy) return;
    setBusy(true);
    notify("Asking Gemini for priorities. This can take up to a minute.");
    try {
      const result = await api("/api/priorities", { state });
      if (latestMode.current !== mode) return;
      update((s) =>
        s.aiRuns.push({
          id: uid(),
          kind: "priorities",
          createdAt: new Date().toISOString(),
          version: result.version,
          inputKey: priorityInput,
          snapshot: result.snapshot,
          output: {
            summary: result.summary,
            recommendations: result.recommendations,
          },
        }),
      );
      notify("AI priorities saved.");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function proposeTasks(projectId: string) {
    if (busy) return;
    const inputKey = projectDraftKey(state, projectId, "tasks");
    setBusy(true);
    notify("Asking Gemini for task drafts. This can take up to a minute.");
    try {
      const result = await api("/api/projects/tasks", { state, projectId });
      if (latestMode.current !== mode) return;
      update((s) =>
        s.aiRuns.push({
          id: uid(),
          kind: "tasks",
          createdAt: new Date().toISOString(),
          version: result.version,
          inputKey,
          snapshot: {
            project: state.projects.find((p) => p.id === projectId),
            existing_tasks: state.tasks.filter(
              (t) => t.projectId === projectId,
            ),
          },
          output: result,
        }),
      );
      setTaskDrafts(result);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function adjustSession(
    id: string,
    date: string,
    start: string,
    duration: number,
  ) {
    const session = state.sessions.find((entry) => entry.id === id);
    if (
      !session ||
      (session.date === date &&
        session.start === start &&
        session.duration === duration)
    )
      return;
    change((s) => {
      const current = s.sessions.find((entry) => entry.id === id);
      if (!current) return;
      current.date = date;
      current.start = start;
      current.duration = duration;
      audit(s, "Session time adjusted in planner", id);
    });
  }
  function unscheduleSession(id: string) {
    try {
      let hasOtherSessions = false;
      update((s) => {
        const session = s.sessions.find((entry) => entry.id === id);
        if (!session)
          throw new Error("This session is no longer on the calendar.");
        if (
          session.outcome !== "pending" ||
          session.actualMinutes !== null ||
          session.note.trim()
        )
          throw new Error(
            "This session has recorded work. Keep it in your history and schedule another session if needed.",
          );
        s.sessions = s.sessions.filter((entry) => entry.id !== id);
        hasOtherSessions = s.sessions.some(
          (entry) => entry.taskId === session.taskId,
        );
        audit(
          s,
          hasOtherSessions
            ? "Removed one of the task’s sessions"
            : "Returned task to planner",
          hasOtherSessions ? id : session.taskId,
        );
      });
      notify(
        hasOtherSessions
          ? "Session removed. This task still has other sessions on the calendar."
          : "Session removed. Task put back in the task list.",
      );
      return true;
    } catch (err) {
      notify((err as Error).message);
      return false;
    }
  }
  function setOutcome(kind: string, id: string, date: string, value: Outcome) {
    change((s) => {
      if (kind === "session") {
        const session = s.sessions.find((x) => x.id === id);
        if (session) {
          session.outcome = value;
          if (value !== "pending") session.needsReview = false;
        }
      } else {
        const rec = s.routineRecords.find(
          (x) => x.routineId === id && x.date === date,
        );
        if (rec) rec.outcome = value;
        else
          s.routineRecords.push({
            routineId: id,
            date,
            outcome: value,
            note: "",
          });
      }
      audit(s, "Recorded " + kind + " outcome: " + value, id);
    });
    notify(
      value === "pending"
        ? "Outcome reset."
        : kind === "session"
          ? "Session outcome saved. Task status is unchanged."
          : "Routine outcome saved.",
    );
  }
  function moveRoutineOccurrence(
    id: string,
    sourceDate: string,
    date: string,
    start: string,
    duration: number,
  ) {
    change((s) => {
      if (sourceDate !== date) {
        const source = s.exceptions.find(
          (x) => x.routineId === id && x.date === sourceDate,
        );
        if (source) source.skip = true;
        else
          s.exceptions.push({
            routineId: id,
            date: sourceDate,
            skip: true,
            start: "00:00",
            duration: 1,
          });
      }
      const existing = s.exceptions.find(
        (x) => x.routineId === id && x.date === date,
      );
      if (existing) {
        existing.skip = false;
        existing.start = start;
        existing.duration = duration;
      } else {
        s.exceptions.push({
          routineId: id,
          date,
          skip: false,
          start,
          duration,
        });
      }
      audit(s, "Moved routine occurrence", id);
    });
    notify("Routine occurrence scheduled on the calendar.");
  }
  function restoreRoutineOccurrence(
    id: string,
    sourceDate: string,
    date: string,
  ) {
    change((s) => {
      if (sourceDate !== date) return;
      s.exceptions = s.exceptions.filter(
        (x) => !(x.routineId === id && x.date === date),
      );
      audit(s, "Restored routine occurrence to deadlines", id);
    });
    notify("Routine occurrence restored to the deadlines row.");
  }
  const hasData =
    state.tasks.length +
      state.projects.length +
      state.routines.length +
      state.deadlines.length >
    0;
  const aiReady = !!health?.aiConfigured && !!auth && mode !== "demo";
  const props = { state, update: change, edit, notify };
  if (!ready)
    return (
      <div className="loading-screen">
        <Sunrise size={38} />
        <h1>
          daylight<span>®</span>
        </h1>
        <p>A little space for what matters.</p>
        <Loader2 size={20} className="spin" />
      </div>
    );
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (mobile ? "mobile-open" : "")}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("planner");
          }}
        >
          <span className="brand-icon">
            <Sunrise size={27} strokeWidth={1.7} />
          </span>
          daylight<span className="brand-period">.</span>
        </a>
        <button
          className="workspace-switch"
          onClick={() => {
            setView("settings");
            setMobile(false);
          }}
        >
          <span className="avatar">
            {state.settings.name?.[0]?.toUpperCase() || "M"}
          </span>
          <span>
            <strong>
              {state.settings.name
                ? state.settings.name + "’s space"
                : "My workspace"}
            </strong>
            <small>
              {mode === "demo"
                ? "Sample workspace"
                : auth
                  ? "Personal · cloud"
                  : "Personal · local"}
            </small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={"nav-item " + (view === id ? "active" : "")}
              onClick={() => {
                setView(id);
                setMobile(false);
              }}
            >
              <Icon size={18} strokeWidth={1.7} />
              <span>{label}</span>
              {id === "tasks" &&
                state.tasks.filter((t) => t.status === "active").length > 0 && (
                  <span className="nav-count">
                    {state.tasks.filter((t) => t.status === "active").length}
                  </span>
                )}
              {id === "planner" && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="note-sun">☼</span>
          <h3>
            A little less busy.
            <br />A little more intentional.
          </h3>
          <p>
            You don’t have to do it all.
            <br />
            Just make room for what matters.
          </p>
        </div>
        <div className="sidebar-bottom">
          <button
            className={"nav-item " + (view === "settings" ? "active" : "")}
            onClick={() => {
              setView("settings");
              setMobile(false);
            }}
          >
            <Settings2 size={18} />
            <span>Settings & connections</span>
          </button>
          <div className="storage-status" title={status}>
            {auth ? <Cloud size={13} /> : <HardDrive size={13} />}
            <span>{status}</span>
            <span className={"status-dot " + (error ? "warning" : "")} />
          </div>
        </div>
      </aside>
      {mobile && (
        <button
          className="mobile-scrim"
          onClick={() => setMobile(false)}
          aria-label="Close navigation"
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <IconButton
              label="Toggle navigation"
              className="mobile-menu"
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={19} />
            </IconButton>
            <span>My workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>
              {view === "settings"
                ? "Settings"
                : nav.find((n) => n.id === view)?.label}
            </strong>
          </div>
          <div className="top-actions">
            <button
              className="global-search"
              onClick={() => setSearch("")}
              aria-label="Search workspace"
            >
              <Search size={15} />
              <span>Search anything</span>
              <kbd>⌘ K</kbd>
            </button>
            <span className="topbar-divider" />
            <IconButton
              label="Sync Google Calendar"
              onClick={sync}
              disabled={busy || !auth || mode === "demo"}
            >
              <RefreshCw size={16} className={busy ? "spin" : ""} />
            </IconButton>
            <div className="quick-add">
              <button
                className="button primary"
                onClick={() => setQuick(!quick)}
                aria-expanded={quick}
              >
                <Plus size={16} />
                <span>Quick add</span>
                <ChevronDown size={13} />
              </button>
              {quick && (
                <>
                  <button
                    className="dropdown-dismiss"
                    aria-label="Dismiss quick add"
                    onClick={() => setQuick(false)}
                  />
                  <div className="dropdown">
                    {[
                      ["task", "Task"],
                      ["deadline", "Deadline"],
                      ["project", "Project"],
                      ["routine", "Routine"],
                    ].map(([kind, label]) => (
                      <button
                        key={kind}
                        onClick={() =>
                          edit({ kind: kind as EditorState["kind"] })
                        }
                      >
                        <Plus size={14} />
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
        <main>
          {mode === "demo" && (
            <div className="demo-banner">
              <span>
                <Sparkles size={15} />
                <strong>Sample workspace</strong> · Explore freely. These are
                example records.
              </span>
              <button onClick={() => workspace.leaveDemo()}>
                Return to my workspace
                <ArrowRight size={14} />
              </button>
            </div>
          )}
          {syncProblem && mode !== "demo" && (
            <div className="workspace-error" role="alert">
              <AlertCircle size={18} />
              <span>{syncProblem.message}</span>
              {syncProblem.conflicts && (
                <button onClick={() => setConflicts(syncProblem.conflicts!)}>
                  Review
                </button>
              )}
              <button onClick={() => void runSync("full")}>Retry now</button>
            </div>
          )}
          {error && (
            <div className="workspace-error" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button
                onClick={() =>
                  download("daylight-recovery.json", workspace.exportRaw())
                }
              >
                Export backup
              </button>
              <button
                onClick={() => {
                  if (
                    confirm(
                      "Load the latest stored copy? Export a backup first if you need to keep these edits.",
                    )
                  )
                    void workspace.reloadCloud();
                }}
              >
                Reload stored copy
              </button>
            </div>
          )}
          {!hasData && mode !== "demo" && !welcomeDismissed && (
            <div className="welcome-banner">
              <div>
                <span className="welcome-icon">
                  <Sun size={21} />
                </span>
                <div>
                  <strong>Your day starts with a little clarity.</strong>
                  <p>
                    Add your first task, or explore an example workspace to see
                    how Daylight fits together.
                  </p>
                </div>
              </div>
              <button
                className="button secondary"
                onClick={() => workspace.loadDemo()}
              >
                Explore an example
                <ArrowUpRight size={14} />
              </button>
              <IconButton
                label="Dismiss welcome"
                onClick={() => setWelcomeDismissed(true)}
              >
                <X size={16} />
              </IconButton>
            </div>
          )}
          {view === "planner" && (
            <Planner
              state={state}
              date={date}
              setDate={setDate}
              edit={edit}
              openGoogleEvent={openGoogleEvent}
              moveImportedEvent={dropGoogleBlock}
              resizeImportedEvent={resizeGoogleBlock}
              scheduleTask={scheduleDroppedTask}
              moveRoutineOccurrence={moveRoutineOccurrence}
              restoreRoutineOccurrence={restoreRoutineOccurrence}
              canManageGoogle={!!auth && mode !== "demo"}
              unscheduleSession={unscheduleSession}
              adjustSession={adjustSession}
              setOutcome={setOutcome}
              aiReady={aiReady}
              aiNeedsSignIn={!!health?.aiConfigured && !auth && mode !== "demo"}
              aiBusy={busy}
              requestPriorities={requestPriorities}
              aiPriorities={aiPriorities}
            />
          )}{" "}
          {view === "tasks" && <Tasks {...props} />}{" "}
          {view === "deadlines" && <Deadlines {...props} />}{" "}
          {view === "routines" && <Routines {...props} />}{" "}
          {view === "projects" && (
            <Projects
              {...props}
              busy={busy}
              propose={propose}
              proposeTasks={proposeTasks}
              aiReady={aiReady}
            />
          )}{" "}
          {view === "progress" && (
            <Progress
              {...props}
              setOutcome={setOutcome}
              api={api}
              update={(fn) => {
                if (latestMode.current === mode) update(fn);
              }}
              aiReady={aiReady}
            />
          )}{" "}
          {view === "settings" && (
            <Settings
              workspace={workspace}
              health={health}
              api={api}
              sync={sync}
              busy={busy}
              notify={notify}
            />
          )}
          <footer className="main-footer">
            <Sunrise size={14} />
            Made for a more intentional day.
            <span>Daylight · Your time, your call.</span>
          </footer>
        </main>
      </div>
      {modal && (
        <Editor
          key={JSON.stringify(modal)}
          modal={modal}
          state={state}
          update={update}
          onClose={() => setModal(null)}
          onSaved={notify}
          onUnschedule={unscheduleSession}
        />
      )}
      {googleEvent && googleSelection && (
        <GoogleEventDetails
          key={googleSelection.request}
          event={googleEvent}
          timezone={state.settings.timezone}
          selection={googleSelection}
          canUseGoogle={!!auth && mode !== "demo"}
          busy={busy}
          onSave={async (time) => {
            await moveGoogleEvent(googleEvent, time);
            if (latestMode.current !== mode) return;
            setDate(time.startDate);
            setGoogleSelection((current) =>
              current?.request === googleSelection.request ? null : current,
            );
          }}
          onDelete={() => removeGoogleEvent(googleEvent)}
          onClose={() => setGoogleSelection(null)}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {search !== null && (
        <Dialog title="Find your next step" onClose={() => setSearch(null)}>
          <div className="search-dialog">
            <label className="search">
              <Search size={18} />
              <input
                autoFocus
                placeholder="Search tasks, deadlines, projects…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div className="search-results">
              {[
                ...state.tasks.map((t) => ({
                  id: t.id,
                  title: t.title,
                  kind: "task" as const,
                })),
                ...state.projects.map((p) => ({
                  id: p.id,
                  title: p.title,
                  kind: "project" as const,
                })),
                ...state.deadlines.map((d) => ({
                  id: d.id,
                  title: d.title,
                  kind: "deadline" as const,
                })),
                ...state.routines.map((r) => ({
                  id: r.id,
                  title: r.title,
                  kind: "routine" as const,
                })),
              ]
                .filter((x) =>
                  x.title.toLowerCase().includes(search.toLowerCase()),
                )
                .slice(0, 12)
                .map((x) => (
                  <button
                    key={x.kind + x.id}
                    onClick={() => {
                      setSearch(null);
                      edit({ kind: x.kind, id: x.id });
                    }}
                  >
                    <span>{x.title}</span>
                    <Badge>{x.kind}</Badge>
                  </button>
                ))}
            </div>
          </div>
        </Dialog>
      )}
      {taskDrafts && (
        <Dialog
          title="Review the next few steps"
          subtitle="Only the current approved milestone is expanded. Add your own estimates or leave them unknown."
          onClose={() => setTaskDrafts(null)}
        >
          <form
            className="editor-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                update((s) => {
                  const p = s.projects.find(
                    (p) => p.id === taskDrafts.projectId,
                  );
                  const m = p?.milestones.find(
                    (m) =>
                      m.id === taskDrafts.milestoneId &&
                      m.approved &&
                      !m.completed,
                  );
                  if (!m)
                    throw new Error(
                      "This milestone changed. Request fresh task proposals.",
                    );
                  taskDrafts.tasks.forEach((t, i) => {
                    if (f.get("include-" + i) !== "on") return;
                    const raw = String(f.get("estimate-" + i) || ""),
                      estimate = raw ? Number(raw) : null;
                    const id = uid();
                    s.tasks.push({
                      id,
                      title: String(f.get("title-" + i)),
                      notes: t.notes,
                      estimate,
                      remaining: estimate,
                      projectId: p!.id,
                      milestoneId: m.id,
                      deadlineId: null,
                      importance: "normal",
                      status: "active",
                      createdAt: new Date().toISOString(),
                      completedAt: null,
                    });
                    audit(
                      s,
                      "AI task draft accepted with user-supplied estimate · " +
                        taskDrafts.version,
                      id,
                    );
                  });
                });
                setTaskDrafts(null);
                notify(
                  "Selected tasks added. Choose their sessions in the planner.",
                );
              } catch (err) {
                notify((err as Error).message);
              }
            }}
          >
            {taskDrafts.tasks.map((t, i) => (
              <div className="task-draft" key={i}>
                <label className="checkbox">
                  <input type="checkbox" name={"include-" + i} defaultChecked />
                  Include this task
                </label>
                <Field label="Task title">
                  <input
                    required
                    name={"title-" + i}
                    defaultValue={t.title}
                    maxLength={200}
                  />
                </Field>
                <p className="form-hint">{t.notes}</p>
                <Field label="Your estimate · minutes">
                  <input
                    name={"estimate-" + i}
                    type="number"
                    min="1"
                    max="525600"
                    placeholder="Estimate later"
                  />
                </Field>
              </div>
            ))}
            <div className="dialog-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setTaskDrafts(null)}
              >
                Cancel
              </button>
              <span className="spacer" />
              <button className="button primary">Accept selected tasks</button>
            </div>
          </form>
        </Dialog>
      )}
      {conflicts && (
        <Dialog
          title="A few calendar changes need review"
          subtitle="Daylight preserved both versions. No conflicting event was overwritten."
          onClose={() => setConflicts(null)}
        >
          <div className="conflict-list">
            {conflicts.map((c, i) => (
              <div key={i}>
                <strong>{c.title}</strong>
                <p>{c.reason}</p>
                {c.url && (
                  <a href={c.url} target="_blank" rel="noreferrer">
                    Open in Google Calendar ↗
                  </a>
                )}
              </div>
            ))}
            <p className="form-hint">
              Make the event match your intended Daylight date and time, or
              update the Daylight record to match Google. Then sync again.
              Deleted Google events require restoring the original event or
              removing the related Daylight record.
            </p>
            <button
              className="button primary"
              onClick={() => setConflicts(null)}
            >
              Got it
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
