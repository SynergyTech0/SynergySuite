"use client";
// The pipeline board: a column per stage. Drag a deal to another column, or focus it and use
// the left and right arrow keys. A move resets the deal's probability to the stage default.
import { GripVertical, Lock } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computePipelineSummary, effectiveProbability, STAGE_ORDER, STAGE_PROBABILITY, type PipelineSummary } from "@/lib/pipeline";
import { label, type Opportunity, type Stage } from "@/lib/types";
import { api, compactMoney, formatDate, formatMoney } from "./client";
import type { AppCtx } from "./shared";

export function SummaryBar({ summary }: { summary: PipelineSummary }) {
  const avg = summary.openCount ? summary.openAmount / summary.openCount : 0;
  const stats: [string, string, string][] = [
    ["Weighted pipeline", compactMoney(summary.weightedOpenAmount), "Open deals × probability"],
    ["Open pipeline", compactMoney(summary.openAmount), `${summary.openCount} open ${summary.openCount === 1 ? "deal" : "deals"}`],
    ["Won", compactMoney(summary.wonAmount), `${summary.wonCount} closed won`],
    ["Average open deal", compactMoney(avg), "Open amount ÷ open deals"],
  ];
  return (
    <div className="stats">
      {stats.map(([k, v, s]) => (
        <div className="stat" key={k}>
          <div className="k">{k}</div>
          <div className="v">{v}</div>
          <div className="s">{s}</div>
        </div>
      ))}
    </div>
  );
}

export function Pipeline({ app }: { app: AppCtx }) {
  const [rows, setRows] = useState<Opportunity[] | null>(null);
  const [mine, setMine] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const [announce, setAnnounce] = useState("");
  const focusAfter = useRef<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setRows(await api<Opportunity[]>(`/api/opportunities${mine ? "?mine=1" : ""}`));
  }, [mine]);
  useEffect(() => {
    void load().catch((e) => app.say(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- app.version refreshes after changes elsewhere
  }, [load, app.version]);

  // Keyboard moves keep focus on the deal that moved.
  useEffect(() => {
    const id = focusAfter.current;
    if (!id) return;
    focusAfter.current = null;
    boardRef.current?.querySelector<HTMLElement>(`[data-deal="${id}"]`)?.focus();
  }, [rows]);

  const summary = useMemo(() => computePipelineSummary(rows ?? []), [rows]);

  const move = async (deal: Opportunity, stage: Stage, viaKeyboard = false) => {
    if (!deal.editable || deal.stage === stage || !rows) return;
    const before = rows;
    // Show the move straight away, the way it will look once saved.
    setRows(rows.map((r) => (r.id === deal.id ? { ...r, stage, probability: STAGE_PROBABILITY[stage] } : r)));
    if (viaKeyboard) focusAfter.current = deal.id;
    setAnnounce(`${deal.name} moved to ${label(stage)}`);
    try {
      const saved = await api<Opportunity>(`/api/opportunities/${deal.id}/stage`, { method: "PATCH", json: { stage } });
      setRows((rs) => rs?.map((r) => (r.id === saved.id ? saved : r)) ?? rs);
      app.changed();
    } catch (e) {
      setRows(before);
      setAnnounce(`Couldn't move ${deal.name}`);
      app.say((e as Error).message);
    }
  };

  return (
    <div className="page" style={{ maxWidth: "none" }}>
      <div className="pagehead">
        <h1>Pipeline</h1>
        <label className="toggle"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> My deals only</label>
      </div>
      <SummaryBar summary={summary} />
      <p id="board-help" className="muted small" style={{ margin: 0 }}>
        Drag a deal to another stage, or focus it and press the left or right arrow key. Enter opens it.
      </p>
      <div className="sronly" aria-live="polite">{announce}</div>
      {rows === null ? <p className="muted">Loading…</p> : (
        <div className="board" ref={boardRef}>
          {STAGE_ORDER.map((stage, i) => {
            const cards = rows.filter((r) => r.stage === stage);
            const roll = summary.byStage[stage];
            return (
              <section
                key={stage}
                aria-label={`${label(stage)}, ${cards.length} ${cards.length === 1 ? "deal" : "deals"}`}
                className={`col${over === stage ? " over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setOver(stage);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((s) => (s === stage ? null : s));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  // The card re-renders in its new column, so its own dragend may never fire.
                  setDragId(null);
                  const id = e.dataTransfer.getData("text/plain") || dragId;
                  const deal = rows.find((r) => r.id === id);
                  if (deal) void move(deal, stage);
                }}
              >
                <div className="colhead">
                  <div className="t">{label(stage)} <span>{cards.length}</span></div>
                  <div className="s">{formatMoney(roll.amount)} · {STAGE_PROBABILITY[stage]}%</div>
                </div>
                <div className="colbody">
                  {cards.map((d) => (
                    <article
                      key={d.id}
                      data-deal={d.id}
                      className={`deal${d.editable ? "" : " locked"}${dragId === d.id ? " dragging" : ""}`}
                      draggable={d.editable}
                      tabIndex={0}
                      aria-describedby="board-help"
                      aria-label={`${d.name}, ${d.accountName}, ${formatMoney(d.amount)}, ${label(stage)}${d.editable ? "" : ", read-only"}`}
                      onDragStart={(e) => {
                        setDragId(d.id);
                        e.dataTransfer.setData("text/plain", d.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOver(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") app.go("opportunities", d.id);
                        else if (e.key === "ArrowRight" && i < STAGE_ORDER.length - 1) {
                          e.preventDefault();
                          void move(d, STAGE_ORDER[i + 1], true);
                        } else if (e.key === "ArrowLeft" && i > 0) {
                          e.preventDefault();
                          void move(d, STAGE_ORDER[i - 1], true);
                        }
                      }}
                    >
                      <div className="top">
                        {d.editable ? <GripVertical size={15} className="grip" aria-hidden /> : <Lock size={13} className="grip" aria-hidden />}
                        <div className="grow" style={{ minWidth: 0 }}>
                          <button className="link rname" style={{ display: "block", maxWidth: "100%", textAlign: "left" }} tabIndex={-1} onClick={() => app.go("opportunities", d.id)}>{d.name}</button>
                          <div className="rsub">{d.accountName}</div>
                        </div>
                      </div>
                      <div className="foot">
                        <span className="amt">{formatMoney(d.amount)}</span>
                        <span className="badge">{effectiveProbability(d.stage, d.probability)}%</span>
                      </div>
                      {d.closeDate ? <div className="rsub">Closes {formatDate(d.closeDate)} · {d.ownerName}</div> : <div className="rsub">{d.ownerName}</div>}
                    </article>
                  ))}
                  {cards.length === 0 ? <div className="drop">Drop a deal here</div> : null}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
