"use client";
/** The bar above a report's print page: print it, or save it as PDF through the same dialog. */
export function PrintBar({ landscape }: { landscape: boolean }) {
  return (
    <div className="print-bar">
      {/* The page's orientation goes to the print dialog through @page. */}
      <style>{`@page { size: ${landscape ? "landscape" : "portrait"}; margin: 14mm; }`}</style>
      <button className="primary" onClick={() => window.print()}>
        Print
      </button>
      <span className="muted small">To get a PDF, choose Save as PDF as the printer.</span>
    </div>
  );
}
