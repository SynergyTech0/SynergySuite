"use client";

/** A print button that hides itself on paper. */
export function PrintNow() {
  return (
    <div className="noprint toolbar" style={{ marginBottom: 16 }}>
      <button className="btn primary" onClick={() => window.print()}>Print or save as PDF</button>
    </div>
  );
}
