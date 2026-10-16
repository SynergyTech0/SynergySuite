/**
 * A laid-out report (lib/reportLayout.ts) as a page: the title, then one table with a heading row
 * for each group, its records, and a totals row under it, with the report's totals at the end.
 * No state, so the print page renders it on the server and Report view in the browser.
 */
import { Fragment, type ReactNode } from "react";
import { rightAligned, TOTAL_LABELS, type ReportData, type ReportGroup } from "@/lib/reportLayout";

function Totals({ data, g, label, className }: { data: ReportData; g: ReportGroup; label: string; className: string }) {
  if (!g.totals.some((t) => t !== null)) return null;
  return (
    <tr className={className}>
      {data.columns.map((c, i) => (
        <td key={c.index} className={rightAligned(c) || c.total === "count" ? "num" : ""}>
          {g.totals[i] !== null ? (
            <>
              <span className="fn">{TOTAL_LABELS[c.total!]}</span> {g.totals[i]}
            </>
          ) : i === 0 ? (
            label
          ) : null}
        </td>
      ))}
    </tr>
  );
}

function rowsOf(data: ReportData, g: ReportGroup, level: number): ReactNode[] {
  const out: ReactNode[] = [];
  g.rows?.forEach((r, i) => {
    out.push(
      <tr key={`r${i}`} className="detail">
        {r.map((v, j) => (
          <td key={j} className={rightAligned(data.columns[j]) ? "num" : ""}>
            {v}
          </td>
        ))}
      </tr>,
    );
  });
  g.groups?.forEach((child, i) => {
    const lv = data.levels[level];
    out.push(
      <Fragment key={`g${i}`}>
        <tr className={`group-head level-${level}`}>
          <td colSpan={Math.max(data.columns.length, 1)}>
            <span className="muted">{lv.label}:</span> {child.label} <span className="muted small">({child.count.toLocaleString("en-US")})</span>
          </td>
        </tr>
        {rowsOf(data, child, level + 1)}
        {lv.totals && <Totals data={data} g={child} label={`${child.label} total`} className={`group-foot level-${level}`} />}
      </Fragment>,
    );
  });
  return out;
}

export function ReportBody({ data, landscape }: { data: ReportData; landscape?: boolean }) {
  return (
    <article className={`report ${landscape ? "landscape" : ""}`}>
      <header>
        <h1>{data.title}</h1>
        <p className="muted small">
          {data.body.count.toLocaleString("en-US")} record{data.body.count === 1 ? "" : "s"}
          {data.truncated ? " (the report stopped at this many; filter the source with a query)" : ""}
        </p>
      </header>
      <table className="report-table">
        <thead>
          <tr>
            {data.columns.map((c) => (
              <th key={c.index} className={rightAligned(c) ? "num" : ""}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rowsOf(data, data.body, 0)}</tbody>
        <tfoot>
          <Totals data={data} g={data.body} label="Report total" className="grand" />
        </tfoot>
      </table>
      {data.body.count === 0 && <p className="muted">No records.</p>}
    </article>
  );
}
