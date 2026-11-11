"use client";
import { useEffect, useRef, useState } from "react";
import { Sunrise } from "lucide-react";
import { browserDb } from "@/lib/supabase";
export default function AuthCallback() {
  const started = useRef(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const db = browserDb();
        if (!db) throw new Error("Sign-in is not configured.");
        // The Supabase client exchanges the Google sign-in code on its own as
        // it starts. getSession() waits for that to finish.
        const { data, error } = await db.auth.getSession();
        if (error) throw error;
        if (!data.session) throw new Error("No sign-in session was found.");
        window.location.replace("/");
      } catch {
        setError(
          "Google sign-in could not be completed. Return to Daylight and try again from Settings, in the same browser.",
        );
        history.replaceState({}, "", window.location.pathname);
      }
    })();
  }, []);
  return (
    <div className="loading-screen">
      <Sunrise size={38} />
      <h1>daylight.</h1>
      {error ? (
        <>
          <p style={{ maxWidth: 400, textAlign: "center" }} role="alert">
            {error}
          </p>
          <a className="button secondary" href="/">
            Return to Daylight
          </a>
        </>
      ) : (
        <p>Finishing your sign-in…</p>
      )}
    </div>
  );
}
