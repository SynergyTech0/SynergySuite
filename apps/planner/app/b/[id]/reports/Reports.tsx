"use client";
import { useEffect, useState } from "react";

type Velocity = { name: string; committed: number; completed: number };
type Week = { label: string; created: number; resolved: number };
type SprintReport = {
  name: string; committedPoints: number; completedPoints: number;
  committedCards: number; completedCards: number; completedAt: string;
};
type Data = {
  velocity: Velocity[]; averageVelocity: number; sprintReports: SprintReport[];
  createdVsResolved: Week[]; throughput: { label: string; done: number }[];
};

const W = 520, H = 180, PAD = 30;
const shortWeek = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/** Grouped bars: committed behind, completed in front, so the gap is the story. */
function VelocityChart({ rows, average }: { rows: Velocity[]; average: number }) {
  if (!rows.length) return <div className="bempty">No completed sprints yet. Velocity appears once a sprint is completed.</div>;
  const max = Math.max(...rows.flatMap((r) => [r.committed, r.completed]), 1);
  const band = (W - PAD - 10) / rows.length;
  const y = (v: number) => H - 24 - (v / max) * (H - 44);
  return (
    <svg className="bdsvg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Velocity by sprint">
      <line className="bdaxis" x1={PAD} y1={H - 24} x2={W - 6} y2={H - 24} />
      <line className="bdaxis" x1={PAD} y1={8} x2={PAD} y2={H - 24} />
      <line className="bdideal" x1={PAD} y1={y(average)} x2={W - 6} y2={y(average)} />
      <text className="bdlab" x={W - 6} y={y(average) - 3} textAnchor="end">avg {average}</text>
      {rows.map((r, i) => {
        const x = PAD + i * band + band * 0.15;
        const w = band * 0.35;
        return (
          <g key={r.name}>
            <rect x={x} y={y(r.committed)} width={w} height={H - 24 - y(r.committed)} fill="#334155">
              <title>{r.name}: {r.committed} committed</title>
            </rect>
            <rect x={x + w + 2} y={y(r.completed)} width={w} height={H - 24 - y(r.completed)} fill="#22c55e">
              <title>{r.name}: {r.completed} completed</title>
            </rect>
            <text className="bdlab" x={x + w} y={H - 10} textAnchor="middle">{r.name.slice(0, 8)}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Two lines: how much arrived, how much left. Lines crossing the wrong way is the thing to see. */
function CreatedResolvedChart({ rows }: { rows: Week[] }) {
  if (!rows.length) return <div className="bempty">Nothing yet.</div>;
  const max = Math.max(...rows.flatMap((r) => [r.created, r.resolved]), 1);
  const x = (i: number) => PAD + (i / Math.max(rows.length - 1, 1)) * (W - PAD - 10);
  const y = (v: number) => H - 24 - (v / max) * (H - 44);
  const line = (key: "created" | "resolved") => rows.map((r, i) => `${x(i)},${y(r[key])}`).join(" ");
  return (
    <svg className="bdsvg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Created versus resolved by week">
      <line className="bdaxis" x1={PAD} y1={H - 24} x2={W - 6} y2={H - 24} />
      <line className="bdaxis" x1={PAD} y1={8} x2={PAD} y2={H - 24} />
      <polyline className="bdactual made" points={line("created")} />
      <polyline className="bdactual ok" points={line("resolved")} />
      {rows.map((r, i) => (
        <g key={r.label}>
          <circle className="bddot made" cx={x(i)} cy={y(r.created)} r={2.5}><title>{shortWeek(r.label)}: {r.created} created</title></circle>
          <circle className="bddot ok" cx={x(i)} cy={y(r.resolved)} r={2.5}><title>{shortWeek(r.label)}: {r.resolved} resolved</title></circle>
          {(i === 0 || i === rows.length - 1 || i === Math.floor(rows.length / 2)) && (
            <text className="bdlab" x={x(i)} y={H - 10} textAnchor="middle">{shortWeek(r.label)}</text>
          )}
        </g>
      ))}
      <text className="bdlab" x={PAD} y={16}>{max} max</text>
    </svg>
  );
}

export function Reports({ board }: { board: { id: string; title: string } }) {
  const [data, setData] = useState<Data | null>(null);
  const [weeks, setWeeks] = useState(8);

  useEffect(() => {
    fetch(`/api/boards/${board.id}/reports?weeks=${weeks}`).then((r) => (r.ok ? r.json() : null)).then(setData);
  }, [board.id, weeks]);

  return (
    <div className="boardpage">
      <div className="boardhead">
        <a href={`/b/${board.id}`} className="back">← {board.title}</a>
        <h1>Reports</h1>
        <div style={{ flex: 1 }} />
        <select className="plainsel" value={weeks} aria-label="Weeks to show" onChange={(e) => setWeeks(Number(e.target.value))}>
          {[4, 8, 12, 26].map((w) => <option key={w} value={w}>{w} weeks</option>)}
        </select>
        <a href={`/b/${board.id}/backlog`} className="mini">Backlog</a>
        <a href={`/b/${board.id}/releases`} className="mini">Releases</a>
      </div>

      <div className="backlog">
        <section className="sprint">
          <div className="shead"><b>Velocity</b><span className="muted">points committed vs completed, per completed sprint</span></div>
          <div className="bd">{data ? <VelocityChart rows={data.velocity} average={data.averageVelocity} /> : <div className="bempty">Loading…</div>}</div>
          {data?.sprintReports.length ? (
            <div className="bzone">
              {data.sprintReports.map((s) => (
                <div key={s.name} className="brow" style={{ cursor: "default" }}>
                  <span className="btitle">{s.name}</span>
                  <span className="muted">{s.completedCards}/{s.committedCards} issues · {s.completedPoints}/{s.committedPoints} pts</span>
                  <span className="muted">{new Date(s.completedAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="sprint">
          <div className="shead"><b>Created vs resolved</b><span className="muted">per week — grey in, green out</span></div>
          <div className="bd">{data ? <CreatedResolvedChart rows={data.createdVsResolved} /> : <div className="bempty">Loading…</div>}</div>
        </section>

        <section className="sprint">
          <div className="shead"><b>Throughput</b><span className="muted">issues finished per week</span></div>
          <div className="bzone throughput">
            {data?.throughput.map((t) => (
              <div key={t.label} className="tbar" title={`${shortWeek(t.label)}: ${t.done} done`}>
                <div style={{ height: `${Math.min(100, t.done * 12)}px` }} />
                <span className="bdlab">{t.done}</span>
              </div>
            ))}
            {data && !data.throughput.some((t) => t.done) && <div className="bempty">Nothing finished in this window yet.</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
