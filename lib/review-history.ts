import { type State, type Review, formatDate } from "./model";

export function confirmReviewReplacement(state: State, date: string) {
  const existing = state.reviews.filter((review) => review.date === date);
  if (
    existing.length &&
    !window.confirm(
      `Replace the saved progress report for ${formatDate(date, { month: "long", day: "numeric", year: "numeric" })}?\n\nThis replaces its confirmed account and approved connections. Later confirmed reports stay intact.`,
    )
  )
    return null;
  return JSON.stringify(existing);
}

export function reviewContextBefore(state: State, date: string): State {
  return {
    ...state,
    reviews: state.reviews.filter((review) => review.date < date),
  };
}

export function saveDatedReview(
  state: State,
  record: Review,
  expected: string,
) {
  if (
    JSON.stringify(
      state.reviews.filter((review) => review.date === record.date),
    ) !== expected
  )
    throw new Error(
      "The saved report changed while you were writing. Review it and confirm replacement again.",
    );
  const replaced = state.reviews.filter(
    (review) => review.date === record.date,
  );
  // Keep an audit copy without exposing superseded evidence as current progress.
  record.snapshot.replaced_report_ids = replaced.map((review) => review.id);
  for (const later of state.reviews.filter(
    (review) => review.date > record.date,
  )) {
    later.snapshot.earlier_report_changed = record.date;
  }
  state.reviews = [
    ...state.reviews.filter((review) => review.date !== record.date),
    record,
  ].sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
  );
}
