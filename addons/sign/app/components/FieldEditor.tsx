"use client";

import Draggable from "react-draggable";
import { useState } from "react";

interface Signer {
  id: string;
  name: string;
  email: string;
}

interface Field {
  id: string;
  label: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  signerId?: string;
  assignedTo?: string;
}

interface FieldEditorProps {
  documentId: string;
  initialFields: Field[];
  signers: Signer[];
}

export default function FieldEditor({ documentId, initialFields, signers }: FieldEditorProps) {
  const [fields, setFields] = useState<Field[]>(initialFields);
  const GRID_SIZE = 10;

  const snap = (val: number) => Math.round(val / GRID_SIZE) * GRID_SIZE;

  const handleStop = (i: number, e: any, data: any) => {
    const updated = [...fields];
    updated[i] = { ...updated[i], x: snap(data.x), y: snap(data.y) };
    setFields(updated);
  };

  const handleSignerChange = (i: number, signerId: string) => {
    const updated = [...fields];
    updated[i].signerId = signerId;
    updated[i].assignedTo = signers.find((s) => s.id === signerId)?.email;
    setFields(updated);
  };

  const save = async () => {
    await fetch("/api/documents/fields/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId, fields }),
    });
    alert("✅ Layout saved");
  };

  return (
    <div className="relative">
      {fields.map((f, i) => (
        <Draggable
          key={f.id}
          grid={[GRID_SIZE, GRID_SIZE]}
          defaultPosition={{ x: f.x || 100, y: f.y || 100 }}
          onStop={(e, data) => handleStop(i, e, data)}
        >
          <div
            className="absolute border px-2 py-1 text-xs bg-white/90 rounded-md shadow cursor-move"
            style={{ borderColor: "#0070f3" }}
          >
            <strong>{f.label}</strong>
            <br />
            <select
              value={f.signerId || ""}
              onChange={(e) => handleSignerChange(i, e.target.value)}
              className="text-xs border rounded mt-1"
            >
              <option value="">Unassigned</option>
              {signers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </Draggable>
      ))}
      <button
        onClick={save}
        className="mt-6 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Save Layout
      </button>
    </div>
  );
}
