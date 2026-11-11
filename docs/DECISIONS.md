# Provisional implementation decisions

These choices are implemented defaults, not claims that open product questions in specification v1.1 were approved.

- **Screen arrangement:** the planner combines a compact priority strip and calendar. Tasks, projects, deadlines, routines, progress, and settings have separate screens. The full task bank stays secondary and the task list is paginated.
- **Horizon:** seven days is the editable initial setting. Due-date checks can look through a particular deadline (up to 370 days); the horizon does not impose a scheduling rule.
- **Availability:** 09:00–18:00 Monday–Friday is a visible, user-editable template. It must be adjusted to reflect real personal availability. Calendar capacity excludes elapsed time, overlaps are counted once, and explicit due times cap the final day.
- **Unknown workload:** tasks can be saved without estimates. Missing estimates are flagged; AI does not invent them. Milestone proposal requests need either a supplied effort budget or available-hours budget.
- **Actual time:** optional manually entered minutes are distinguished from scheduled minutes. No timer, focus inference, or numerical productivity score is introduced.
- **Questions:** the daily review exposes short optional fields. A blocked session with a recorded note does not trigger a redundant blocker question. Remaining effort can be edited on the task itself.
- **Weekly summary:** on demand, with confirmed counts and current pacing explanations. No automatic email, scheduled job, or elaborate analytics dashboard.
- **Routine exceptions:** the occurrence editor supports move or skip for one date. The routine editor changes the series. Pause hides local occurrences and truncates the Google recurrence using the recorded pause date; historical occurrence outcomes remain stored. Resuming a series can restore past recurring instances in Google; historical exception semantics remain a product-review item.
- **Deadline completion:** an explicit user action marks the deadline resolved. The marker is preserved with a completed label. Finishing a task flags its pending sessions; it never deletes unrelated events.
- **Calendar scope:** one selected writable Google calendar plus visible holiday subscriptions; manual bounded snapshot synchronization. Holidays display as read-only and do not consume capacity. An explicit action can move or delete the synced version of a writable imported occurrence. Google details are read on demand and kept out of workspace backups. Conflicting changes to Daylight-owned events are surfaced for review.
- **Storage:** new namespaced Supabase tables and a versioned per-user JSON document with optimistic concurrency. Earlier application tables and connections remain untouched; migration of their meaning requires an explicit mapping.
- **AI:** user-selected Google Gemini via server-only generateContent REST; default stable Gemini 3.8 Flash, model override supported. Saved AI output persists and shows when inputs have changed. Only explicit actions generate content; rules-based review is a labeled local fallback. AI output is advice and drafts, never scheduling or approval.
- **Data size:** cloud documents/imports are limited to 5 MB; sync supports at most 500 outgoing Daylight records per request and requires a complete bounded import snapshot. These are explicit V1 limits, not silent truncation.

Deferred by the specification: automatic weekly reporting, multi-calendar conflict policies, background scheduling, automatic Gemini reflection import, handwriting recognition, behavioral optimization rules, and advanced analytics.
