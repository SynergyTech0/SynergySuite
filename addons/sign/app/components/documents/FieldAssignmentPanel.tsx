"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";

interface Field {
  id: string;
  label: string;
  fieldType: string;
  assignedToId?: string | null;
  pageNumber: number;
  required: boolean;
}

interface Signer {
  id: string;
  email: string;
  name?: string | null;
}

interface Props {
  documentId: string;
}

export default function FieldAssignmentPanel({ documentId }: Props) {
  const [fields, setFields] = useState<Field[]>([]);
  const [signers, setSigners] = useState<Signer[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  // ----------------------------
  // Load fields + signers
  // ----------------------------
  useEffect(() => {
    async function loadData() {
      try {
        const [fieldsRes, signersRes] = await Promise.all([
          fetch(`/api/documents/${documentId}/fields`),
          fetch(`/api/documents/${documentId}/signers`),
        ]);
        const [fieldsData, signersData] = await Promise.all([
          fieldsRes.json(),
          signersRes.json(),
        ]);
        setFields(fieldsData);
        setSigners(signersData);
      } catch (err) {
        console.error("Error loading field data:", err);
        toast({
          title: "Failed to load fields",
          description: "Please refresh the page or try again later.",
          variant: "destructive",
        });
      }
    }
    loadData();
  }, [documentId, toast]);

  // ----------------------------
  // Handle signer assignment
  // ----------------------------
  const handleAssign = (fieldId: string, signerId: string | null) => {
    setFields((prev) =>
      prev.map((f) =>
        f.id === fieldId ? { ...f, assignedToId: signerId } : f
      )
    );
  };

  // ----------------------------
  // Save changes
  // ----------------------------
  const handleSave = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/documents/${documentId}/fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to update fields");
      }

      toast({
        title: "Field assignments updated",
        description: "All signer assignments saved successfully.",
      });
    } catch (err: any) {
      console.error(err);
      toast({
        title: "Error saving changes",
        description: err.message || "Unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Field Assignment</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {fields.map((field) => (
            <div
              key={field.id}
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between border p-3 rounded-md"
            >
              <div className="flex-1">
                <p className="font-medium text-gray-900">
                  {field.label}{" "}
                  <span className="text-sm text-gray-500">
                    ({field.fieldType})
                  </span>
                </p>
                <p className="text-sm text-gray-400">
                  Page {field.pageNumber} {field.required ? "• Required" : ""}
                </p>
              </div>
              <div className="mt-3 sm:mt-0 sm:w-64">
                <Select
                  value={field.assignedToId ?? ""}
                  onValueChange={(val) =>
                    handleAssign(field.id, val || null)
                  }
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder="Assign signer"
                      defaultValue={field.assignedToId ?? ""}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Unassigned</SelectItem>
                    {signers.map((signer) => (
                      <SelectItem key={signer.id} value={signer.id}>
                        {signer.name || signer.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end mt-6">
          <Button onClick={handleSave} disabled={loading}>
            {loading ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
