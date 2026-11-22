# Sample Gemini progress-report packages

All records in these examples are fictional. These files were captured from the actual `/api/review` request builder with provider/authentication calls mocked; nothing was sent to Gemini or saved to a real workspace.

- `interpret-paste.txt`: actual shared and interpretation instructions plus readable input for the first step.
- `report-paste.txt`: actual shared and final report/storage instructions plus readable input after confirmation.
- `*-request.json`: exact outbound API body, including generation settings and serialized input.

The initial interpretation response does not save a review. After the user confirms/edits the interpretation, the final response contains an assessment and `commitmentUpdates` with exact record keys and open-ended notes. The client appends a Review to `state.reviews`, preserving the original focus/blocker/accomplishment, confirmed interpretation, optional follow-up, generated assessment and keyed updates. It does not replace task status, deadline dates, estimates or other approved records.

Each record's progress history is assembled from its keyed updates across saved reviews. Task histories include `task:ID` notes; deadline/milestone/project histories also include relevant child-task updates. A new report appends evidence; records not mentioned retain their earlier reports. Postponement information is read from open-ended notes when present, with no invented skip counter. Original submitted text remains stored even if a generated note omits something. Notes no longer have the previous 600-character storage cap. Older saved notes cannot be retroactively expanded, though the original review text remains available in those saved reviews.

Planning uses prior decision memory as rationale only, never proof work was accomplished.
