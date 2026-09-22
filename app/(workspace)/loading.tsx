/** Shown while any workspace page streams in: layout-shaped placeholders, not a spinner. */
export default function Loading() {
  return (
    <div className="animate-pulse" role="status" aria-label="Loading">
      <div className="mb-2 h-3 w-32 rounded bg-sunken" />
      <div className="h-9 w-2/3 max-w-md rounded-lg bg-sunken" />
      <div className="mt-3 h-4 w-full max-w-xl rounded bg-sunken" />
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 rounded-xl border border-line bg-surface" />
        ))}
      </div>
      <div className="mt-6 h-72 rounded-xl border border-line bg-surface" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
