"use client";
import { Tag } from "lucide-react";
import type { Label } from "@/lib/client";

/** A sensitivity label as a chip in its own color. */
export function LabelChip({ label }: { label: Pick<Label, "name" | "color" | "description"> }) {
  return (
    <span className="labelchip" style={{ color: label.color, borderColor: label.color }} title={label.description || `Sensitivity: ${label.name}`}>
      <Tag size={12} /> {label.name}
    </span>
  );
}
