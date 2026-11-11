import { notFound } from "next/navigation";
export default function LayoutCheck() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main style={{ padding: 20 }}>
      <h1 style={{ fontSize: 18, marginBottom: 15 }}>
        Development layout check · 390px
      </h1>
      <iframe
        title="Daylight mobile preview"
        src="/"
        style={{
          width: 390,
          height: 844,
          border: "1px solid #ddd",
          borderRadius: 12,
          background: "white",
        }}
      />
    </main>
  );
}
