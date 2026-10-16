"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Sparkles, AlertTriangle, ShieldCheck, Users, FileText,
  Loader2, RefreshCw, Scale, CalendarClock, Wand2, PenLine, Anchor, EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

interface Party {
  role: string;
  name: string | null;
  email: string | null;
  signingOrder: number;
}
interface ComplianceFlag {
  severity: "HIGH" | "MEDIUM" | "LOW";
  issue: string;
  recommendation: string;
}
interface SuggestedField {
  fieldType: string;
  label: string;
  partyRole: string;
  pageNumber: number;
  confidence: number;
  /** true = geometry taken from the PDF's real rule; false = the model's estimate */
  snapped?: boolean;
  anchorId?: string | null;
}
interface Analysis {
  documentType: string;
  title: string;
  summary: string;
  keywords: string[];
  parties: Party[];
  complianceFlags: ComplianceFlag[];
  effectiveDate: string | null;
  governingLaw: string | null;
  suggestedFields?: SuggestedField[];
  model?: string;
  /** Text in the PDF a reader cannot see; the model was not shown it. */
  hiddenText?: HiddenText;
}
interface HiddenText {
  chars: number;
  byReason: Record<string, number>;
  ocrLayerOnly?: boolean;
  samples?: { pageNumber: number; reason: string; text: string }[];
}

/** Same wording as describeHiddenText() in lib/ai/visible-text.ts (kept client-side: that module is server-only). */
const HIDDEN_LABEL: Record<string, string> = {
  invisible_unicode: "invisible characters",
  render_mode: "invisible text mode",
  transparent: "transparent text",
  no_glyph: "characters with no glyph",
  hidden_layer: "a hidden layer",
  off_page: "off-page or clipped text",
  tiny: "microscopic text",
  low_contrast: "text the same colour as its background",
  covered: "text covered by other content",
};

const FIELD_ICON: Record<string, string> = {
  SIGNATURE: "✍️",
  INITIALS: "🅰️",
  DATE: "📅",
  TEXT: "🔤",
  CHECKBOX: "☑️",
};

const TYPE_LABEL: Record<string, string> = {
  CONTRACT: "Contract",
  NDA: "NDA",
  INVOICE: "Invoice",
  EMPLOYMENT_AGREEMENT: "Employment Agreement",
  SALES_AGREEMENT: "Sales Agreement",
  LEASE: "Lease",
  WAIVER: "Waiver",
  OTHER: "Document",
};

const SEVERITY: Record<string, string> = {
  HIGH: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300",
  MEDIUM: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300",
  LOW: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400",
};

export default function AiInsightsPanel({
  documentId,
  onFieldsDetected,
}: {
  documentId: string;
  onFieldsDetected?: () => void;
}) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<null | "detect" | "analyze">(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldCount, setFieldCount] = useState<number | null>(null);
  const [unmatched, setUnmatched] = useState<Party[]>([]);

  // Load any analysis we already have — no model call, no cost.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/documents/${documentId}/analyze`);
        const data = await res.json();
        if (!cancelled && res.ok) setAnalysis(data.analysis ?? null);
      } catch {
        /* leave empty — the user can run it */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [documentId]);

  const run = useCallback(
    async (mode: "detect" | "analyze") => {
      setWorking(mode);
      setError(null);
      try {
        // "detect" also places the fields; "analyze" only refreshes the insights.
        const url =
          mode === "detect"
            ? `/api/documents/${documentId}/fields`
            : `/api/documents/${documentId}/analyze`;
        const res = await fetch(url, { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Analysis failed");

        setAnalysis(data.analysis ?? null);
        if (mode === "detect") {
          setFieldCount(data.createdFields?.length ?? 0);
          setUnmatched(data.unmatchedParties ?? []);
          onFieldsDetected?.();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Analysis failed");
      } finally {
        setWorking(null);
      }
    },
    [documentId, onFieldsDetected],
  );

  if (loading) {
    return (
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b bg-gradient-to-r from-violet-50 to-transparent dark:from-violet-950/30">
        <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-400" />
        <h3 className="font-semibold text-sm">Document Intelligence</h3>
        {analysis?.model && (
          <Badge variant="secondary" className="ml-auto text-[10px] font-mono">
            {analysis.model}
          </Badge>
        )}
      </div>

      <div className="p-5 space-y-5">
        {error && (
          <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {!analysis && (
          <div className="text-center py-6">
            <Wand2 className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              Read this document, identify who has to sign it, and place the fields on the real
              signature lines.
            </p>
            <Button className="mt-4" onClick={() => run("detect")} disabled={working !== null}>
              {working === "detect" ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Reading document…</>
              ) : (
                <><Sparkles className="mr-2 h-4 w-4" /> Analyze &amp; place fields</>
              )}
            </Button>
          </div>
        )}

        {analysis && (analysis.hiddenText?.chars ?? 0) > 0 && (() => {
          const h = analysis.hiddenText!;
          const why = Object.entries(h.byReason).filter(([, n]) => n > 0).map(([k]) => HIDDEN_LABEL[k] ?? k).join(", ");
          return (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
              <div className="flex gap-2">
                <EyeOff className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="font-medium">
                    {h.ocrLayerOnly
                      ? `This PDF carries ${h.chars} characters of invisible text over a scanned image.`
                      : `This PDF contains ${h.chars} characters of hidden text.`}
                  </p>
                  <p className="mt-1 text-xs opacity-90">
                    {h.ocrLayerOnly
                      ? "Usually an OCR layer. The AI read the page images instead and never saw it."
                      : `Found: ${why}. A reader cannot see this text, so the AI suggestions were made without it. Review the document before sending it.`}
                  </p>
                  {!h.ocrLayerOnly && h.samples && h.samples.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs">
                      {h.samples.slice(0, 3).map((s, i) => (
                        <li key={i} className="truncate rounded bg-red-100/70 px-2 py-1 font-mono dark:bg-red-900/40" title={s.text}>
                          p.{s.pageNumber}: {s.text}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {analysis && (
          <>
            <div className="flex items-start gap-2">
              <FileText className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge>{TYPE_LABEL[analysis.documentType] ?? analysis.documentType}</Badge>
                  <span className="text-sm font-medium truncate">{analysis.title}</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {analysis.summary}
                </p>
              </div>
            </div>

            {(analysis.governingLaw || analysis.effectiveDate) && (
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                {analysis.governingLaw && (
                  <span className="inline-flex items-center gap-1.5">
                    <Scale className="h-3.5 w-3.5" /> {analysis.governingLaw}
                  </span>
                )}
                {analysis.effectiveDate && (
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarClock className="h-3.5 w-3.5" /> Effective {analysis.effectiveDate}
                  </span>
                )}
              </div>
            )}

            {analysis.parties?.length > 0 && (
              <>
                <Separator />
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <h4 className="text-sm font-medium">
                      Parties <span className="text-muted-foreground">({analysis.parties.length})</span>
                    </h4>
                  </div>
                  <ul className="space-y-2">
                    {analysis.parties
                      .slice()
                      .sort((a, b) => a.signingOrder - b.signingOrder)
                      .map((p, i) => (
                        <li key={i} className="flex items-center gap-3 text-sm">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium">
                            {p.signingOrder}
                          </span>
                          <span className="min-w-0">
                            <span className="font-medium">{p.name || p.role}</span>
                            {p.name && <span className="text-muted-foreground"> · {p.role}</span>}
                            {p.email && (
                              <span className="block text-xs text-muted-foreground truncate">{p.email}</span>
                            )}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              </>
            )}

            <Separator />
            <div>
              <div className="flex items-center gap-2 mb-3">
                {analysis.complianceFlags?.length ? (
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                ) : (
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                )}
                <h4 className="text-sm font-medium">
                  Risks &amp; gaps{" "}
                  <span className="text-muted-foreground">
                    ({analysis.complianceFlags?.length ?? 0})
                  </span>
                </h4>
              </div>
              {analysis.complianceFlags?.length ? (
                <ul className="space-y-2">
                  {analysis.complianceFlags.map((f, i) => (
                    <li key={i} className={`rounded-lg border p-3 text-sm ${SEVERITY[f.severity]}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wide">
                          {f.severity}
                        </span>
                        <span className="font-medium">{f.issue}</span>
                      </div>
                      <p className="mt-1 text-xs opacity-80">{f.recommendation}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No missing clauses or risky terms found.
                </p>
              )}
            </div>

            {unmatched.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/40">
                <p className="font-medium text-amber-800 dark:text-amber-300">
                  {unmatched.length} detected {unmatched.length === 1 ? "party has" : "parties have"} no signer yet
                </p>
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  Add {unmatched.map((p) => p.name || p.role).join(", ")} as a signer so their fields
                  get assigned.
                </p>
              </div>
            )}

            {/* Placed fields, and — crucially — whether each one is pinned to a real rule in the
                PDF or is only the model's estimate. Those two deserve different trust. */}
            {analysis.suggestedFields && analysis.suggestedFields.length > 0 && (() => {
              const fields = analysis.suggestedFields!;
              const onLine = fields.filter((f) => f.snapped).length;
              const estimated = fields.length - onLine;
              return (
                <>
                  <Separator />
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <PenLine className="h-4 w-4 text-muted-foreground" />
                      <h4 className="text-sm font-medium">
                        Fields <span className="text-muted-foreground">({fields.length})</span>
                      </h4>
                    </div>
                    <p className="mb-3 text-xs text-muted-foreground">
                      {onLine > 0 && (
                        <><strong className="text-emerald-600 dark:text-emerald-400">{onLine} snapped</strong> to a
                        signature line found in the document</>
                      )}
                      {onLine > 0 && estimated > 0 && " · "}
                      {estimated > 0 && (
                        <><strong className="text-amber-600 dark:text-amber-400">{estimated} estimated</strong> — no
                        line to snap to; check these</>
                      )}
                    </p>

                    <ul className="space-y-1.5">
                      {fields.map((f, i) => (
                        <li
                          key={i}
                          className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs ${
                            f.snapped
                              ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/30"
                              : "border-amber-200 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/30"
                          }`}
                        >
                          <span className="shrink-0">{FIELD_ICON[f.fieldType] ?? "▫️"}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{f.label}</span>
                            <span className="block truncate text-muted-foreground">
                              {f.partyRole} · page {f.pageNumber}
                            </span>
                          </span>
                          {f.snapped ? (
                            <span
                              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300"
                              title={`Pinned to the rule ${f.anchorId} found in the PDF — the field sits exactly on that line.`}
                            >
                              <Anchor className="h-3 w-3" /> on line
                            </span>
                          ) : (
                            <span
                              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-900/60 dark:text-amber-300"
                              title="No signature line was found here, so this position is the model's best estimate. Worth checking."
                            >
                              <AlertTriangle className="h-3 w-3" /> estimated
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              );
            })()}

            {fieldCount !== null && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300">
                Placed <strong>{fieldCount}</strong> field{fieldCount === 1 ? "" : "s"}. Drag any of
                them to adjust — your changes train the placement.
              </div>
            )}

            {analysis.keywords?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {analysis.keywords.map((k) => (
                  <Badge key={k} variant="outline" className="text-[11px] font-normal">
                    {k}
                  </Badge>
                ))}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={() => run("detect")} disabled={working !== null} className="flex-1">
                {working === "detect" ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Placing…</>
                ) : (
                  <><Sparkles className="mr-2 h-4 w-4" /> Re-place fields</>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => run("analyze")}
                disabled={working !== null}
                title="Refresh the insights without touching the fields"
              >
                {working === "analyze" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
