"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Session as AuthSession } from "@supabase/supabase-js";
import { State, stateSchema, emptyState, validateReferences } from "./model";
import { demoState } from "./demo";
import { browserDb } from "./supabase";
type Cache = { state: State; version: number; dirty: boolean; stamp: string };
export function useWorkspace() {
  const [state, setState] = useState<State>(emptyState),
    [ready, setReady] = useState(false),
    [auth, setAuth] = useState<AuthSession | null>(null),
    [mode, setMode] = useState("local"),
    [status, setStatus] = useState("Loading…"),
    [error, setError] = useState("");
  const stateRef = useRef(state),
    version = useRef(0),
    modeRef = useRef("local"),
    dirty = useRef(false),
    frozen = useRef(false),
    saving = useRef(false),
    epoch = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authRef = useRef<AuthSession | null>(null);
  const key = () => `daylight:v1:${modeRef.current}`;
  const persist = () => {
    const cache: Cache = {
      state: stateRef.current,
      version: version.current,
      dirty: dirty.current,
      stamp: new Date().toISOString(),
    };
    localStorage.setItem(key(), JSON.stringify(cache));
  };
  const save = useCallback(async () => {
    if (
      !dirty.current ||
      frozen.current ||
      saving.current ||
      !authRef.current ||
      modeRef.current === "demo" ||
      modeRef.current === "local"
    )
      return;
    const db = browserDb();
    if (!db) return;
    const generation = epoch.current;
    const snapshot = stateRef.current;
    saving.current = true;
    setStatus("Saving to cloud…");
    try {
      const { data, error } = await db.rpc("daylight_save_workspace", {
        document: snapshot,
        expected_revision: version.current,
      });
      if (generation !== epoch.current) return;
      if (error) throw error;
      version.current = Number(data);
      dirty.current = stateRef.current !== snapshot;
      persist();
      setError("");
      setStatus(dirty.current ? "Changes pending" : "Saved to cloud");
    } catch (e) {
      if (generation !== epoch.current) return;
      const message =
        e instanceof Error
          ? e.message
          : (e as { message?: string }).message || "Cloud save failed";
      if (message.includes("revision_conflict")) {
        frozen.current = true;
        setError(
          "Newer cloud changes exist. Export your work, then reload the cloud copy.",
        );
      } else
        setError(
          "Cloud save failed. Your changes are backed up in this browser. " +
            message,
        );
      setStatus("Saved locally · cloud pending");
    } finally {
      saving.current = false;
    }
  }, []);
  const load = useCallback(
    async (session: AuthSession | null, nextMode?: string) => {
      const generation = ++epoch.current;
      if (timer.current) clearTimeout(timer.current);
      setReady(false);
      setError("");
      frozen.current = false;
      authRef.current = session;
      setAuth(session);
      const mode = nextMode || session?.user.id || "local";
      modeRef.current = mode;
      setMode(mode);
      dirty.current = false;
      version.current = 0;
      let cached: Cache | null = null;
      try {
        const raw = localStorage.getItem(key());
        if (raw) {
          const c = JSON.parse(raw);
          cached = {
            ...c,
            state: validateReferences(stateSchema.parse(c.state)),
          };
        }
      } catch {
        setError(
          "A saved copy could not be read. It has not been overwritten. Export the raw backup before making changes.",
        );
        frozen.current = true;
      }
      let next = cached?.state || emptyState();
      version.current = cached?.version || 0;
      dirty.current = !!cached?.dirty;
      if (mode === "demo") {
        next = cached?.state || demoState();
        setStatus("Sample workspace");
      } else if (session) {
        try {
          const { data, error } = await browserDb()!
            .from("daylight_workspaces")
            .select("document,revision")
            .eq("user_id", session.user.id)
            .maybeSingle();
          if (generation !== epoch.current) return;
          if (error) throw error;
          if (data) {
            const remote = validateReferences(stateSchema.parse(data.document));
            if (cached?.dirty && cached.version === data.revision) {
              next = cached.state;
            } else if (cached?.dirty) {
              next = cached.state;
              frozen.current = true;
              setError(
                "Local edits and newer cloud changes need review. Export your work, then reload the cloud copy.",
              );
            } else {
              next = remote;
              version.current = data.revision;
            }
          } else {
            next = cached?.state || emptyState();
            dirty.current = true;
          }
          setStatus(
            frozen.current
              ? "Conflict · local copy"
              : dirty.current
                ? "Cloud save pending"
                : "Saved to cloud",
          );
        } catch (e) {
          if (generation !== epoch.current) return;
          frozen.current = true;
          setStatus("Cloud unavailable");
          setError(
            "Cloud storage is not ready. Local backup preserved. Apply the database migration or check your connection.",
          );
        }
      } else setStatus("Saved in this browser");
      if (generation !== epoch.current) return;
      stateRef.current = next;
      setState(next);
      setReady(true);
    },
    [],
  );
  useEffect(() => {
    const db = browserDb();
    if (!db) {
      void load(null);
      return;
    }
    let alive = true;
    db.auth.getSession().then(({ data }) => {
      if (alive) void load(data.session);
    });
    const { data } = db.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return;
      const previousUser = authRef.current?.user.id;
      authRef.current = session;
      setAuth(session);
      if (event === "SIGNED_OUT" || session?.user.id !== previousUser)
        setTimeout(() => {
          if (alive) void load(session);
        }, 0);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, [load]);
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => void save(), 5000);
    const before = (e: BeforeUnloadEvent) => {
      if (
        dirty.current &&
        modeRef.current !== "local" &&
        modeRef.current !== "demo"
      ) {
        e.preventDefault();
      }
    };
    const storage = (e: StorageEvent) => {
      if (e.key === key() && e.newValue) {
        frozen.current = true;
        setError(
          "Another tab changed this workspace. Export any unsaved work, then reload before editing.",
        );
      }
    };
    window.addEventListener("beforeunload", before);
    window.addEventListener("storage", storage);
    return () => {
      clearInterval(id);
      window.removeEventListener("beforeunload", before);
      window.removeEventListener("storage", storage);
    };
  }, [ready, save]);
  const update = useCallback(
    (fn: (s: State) => void) => {
      if (frozen.current)
        throw new Error("Resolve the workspace conflict before editing.");
      const draft = structuredClone(stateRef.current);
      fn(draft);
      const parsed = validateReferences(stateSchema.parse(draft));
      stateRef.current = parsed;
      dirty.current = true;
      setState(parsed);
      try {
        persist();
        setStatus(
          modeRef.current === "demo"
            ? "Sample workspace"
            : modeRef.current === "local"
              ? "Saved in this browser"
              : "Saved locally · cloud pending",
        );
      } catch {
        setError(
          "Browser storage is full or unavailable. Export a backup now.",
        );
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), 800);
    },
    [save],
  );
  const reloadCloud = async () => {
    if (!authRef.current) {
      await load(null, modeRef.current);
      return;
    }
    const recovery = localStorage.getItem(key());
    if (recovery)
      localStorage.setItem("daylight:recovery:" + Date.now(), recovery);
    localStorage.removeItem(key());
    await load(authRef.current);
  };
  return {
    state,
    ready,
    auth,
    mode,
    status,
    error,
    setError,
    update,
    save,
    reloadCloud,
    loadDemo: () => load(authRef.current, "demo"),
    leaveDemo: () => load(authRef.current),
    token: async () => {
      const { data } = await browserDb()!.auth.getSession();
      if (!data.session) throw new Error("Sign in to use this integration.");
      return data.session.access_token;
    },
    exportRaw: () =>
      localStorage.getItem(key()) || JSON.stringify(stateRef.current),
  };
}
