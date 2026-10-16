"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Plus, X, Mail, User, AlertCircle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SignersFormProps } from "@/lib/types";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";


export type { Signer } from "@/lib/types";

const validateEmail = (email: string): boolean => {
  if (!email.trim()) return true;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export default function SignersForm({
  signers,
  onSignersChange,
  signingOrder = "PARALLEL",
  onSigningOrderChange,
  title = "Signers",
  description = "People who must sign this document",
}: SignersFormProps) {
  const [emailErrors, setEmailErrors] = useState<Record<number, string>>({});

  const addSigner = () => {
    onSignersChange([...signers, { email: "", name: "" }]);
  };

  const removeSigner = (index: number) => {
    const updated = signers.filter((_, i) => i !== index);
    onSignersChange(updated);

    const newErrors = { ...emailErrors };
    delete newErrors[index];

    const reindexed: Record<number, string> = {};
    updated.forEach((_, newIndex) => {
      const oldIndex = newIndex >= index ? newIndex + 1 : newIndex;
      if (emailErrors[oldIndex]) {
        reindexed[newIndex] = emailErrors[oldIndex];
      }
    });
    setEmailErrors(reindexed);
  };

  const updateSigner = (
    index: number,
    field: "email" | "name",
    value: string
  ) => {
    const updated = signers.map((s, i) =>
      i === index ? { ...s, [field]: value } : s
    );
    onSignersChange(updated);

    if (field === "email") {
      if (value.trim() && !validateEmail(value)) {
        setEmailErrors((prev) => ({
          ...prev,
          [index]: "Please enter a valid email address",
        }));
      } else {
        setEmailErrors((prev) => {
          const newErrors = { ...prev };
          delete newErrors[index];
          return newErrors;
        });
      }
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Signing Order Selection */}
        {onSigningOrderChange && (
          <div className="p-4 bg-gray-50 rounded-lg space-y-3 mb-4">
            <Label className="text-sm font-semibold">Signing Order</Label>
            <RadioGroup
              value={signingOrder}
              onValueChange={(value) => onSigningOrderChange(value as "PARALLEL" | "SEQUENTIAL")}
              className="space-y-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="PARALLEL" id="parallel" />
                <Label htmlFor="parallel" className="font-normal cursor-pointer flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">All at once (Parallel)</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">
                    All signers receive the invite at the same time and can sign in any order.
                  </p>
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="SEQUENTIAL" id="sequential" />
                <Label htmlFor="sequential" className="font-normal cursor-pointer flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">One at a time (Sequential)</span>
                    <ArrowRight className="w-4 h-4 text-gray-400" />
                  </div>
                  <p className="text-xs text-gray-600 mt-1">
                    Signers must sign in order. Each signer receives invite after previous signer completes.
                  </p>
                </Label>
              </div>
            </RadioGroup>
            {signers.length < 2 && (
              <p className="text-xs text-amber-600 mt-2">
                ⓘ Sequential signing requires at least 2 signers. Add another signer to use this option.
              </p>
            )}
          </div>
        )}

        {signers.map((s, i) => {
          const emailError = emailErrors[i];

          return (
            <div key={i} className="flex gap-3 items-start">
              <div className="flex-1">
                <Label htmlFor={`signer-name-${i}`}>Name</Label>
                <div className="relative mt-1.5">
                  <User className="absolute left-3 inset-y-0 my-auto h-4 w-4 text-muted-foreground" />
                  <Input
                    id={`signer-name-${i}`}
                    type="text"
                    value={s.name}
                    onChange={(e) => updateSigner(i, "name", e.target.value)}
                    placeholder="Signer name"
                    className="pl-10"
                  />
                </div>
              </div>
              <div className="flex-1">
                <Label htmlFor={`signer-email-${i}`}>Email *</Label>
                <div className="relative mt-1.5">
                  <Mail className="absolute left-3 inset-y-0 my-auto h-4 w-4 text-muted-foreground" />
                  <Input
                    id={`signer-email-${i}`}
                    type="email"
                    value={s.email}
                    onChange={(e) => updateSigner(i, "email", e.target.value)}
                    placeholder="signer@example.com"
                    required
                    className={cn(
                      "pl-10",
                      emailError &&
                        "border-destructive focus-visible:ring-destructive"
                    )}
                  />
                </div>
                {emailError && (
                  <p className="text-sm text-destructive mt-1.5 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {emailError}
                  </p>
                )}
              </div>
              {signers.length > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => removeSigner(i)}
                  className="shrink-0 mt-7"
                  aria-label="Remove signer"
                >
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
          );
        })}
        <Button
          type="button"
          variant="outline"
          onClick={addSigner}
          className="w-full"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Signer
        </Button>
      </CardContent>
    </Card>
  );
}
