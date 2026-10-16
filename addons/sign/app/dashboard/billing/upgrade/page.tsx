"use client";

import { useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  Plus,
  Signpost,
  Phone,
  Bot,
  FileText,
  Mail,
  BookDashed,
  Signature,
  Users,
  Files,
  Lock,
  CreditCard,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type PlanKey = "basic" | "pro";

const PLAN_DETAILS: Record<
  PlanKey,
  {
    label: string;
    price: { monthly: string; quarterly: string; annual: string };
    color: string;
  }
> = {
  basic: {
    label: "Basic",
    price: { monthly: "$9.99", quarterly: "$29.99", annual: "$119.99" },
    color: "green",
  },
  pro: {
    label: "Pro",
    price: { monthly: "$29.99", quarterly: "$89.99", annual: "$359.99" },
    color: "blue",
  },
};

const SELLING_POINTS: Record<PlanKey, { icon: JSX.Element; text: string }[]> = {
  basic: [
    { icon: <Files className="w-5 h-5 text-green-500 mt-0.5" />, text: "5 documents per month" },
    { icon: <Signature className="w-5 h-5 text-green-500 mt-0.5" />, text: "Up to 3 signers per document" },
    { icon: <BookDashed className="w-5 h-5 text-green-500 mt-0.5" />, text: "Core templates" },
    { icon: <Mail className="w-5 h-5 text-green-500 mt-0.5" />, text: "Email support" },
  ],
  pro: [
    { icon: <FileText className="w-5 h-5 text-blue-500 mt-0.5" />, text: "Unlimited documents" },
    { icon: <Users className="w-5 h-5 text-blue-500 mt-0.5" />, text: "Unlimited document signers" },
    { icon: <BookDashed className="w-5 h-5 text-blue-500 mt-0.5" />, text: "Advanced templates" },
    { icon: <Bot className="w-5 h-5 text-blue-500 mt-0.5" />, text: "AI features" },
    { icon: <Phone className="w-5 h-5 text-blue-500 mt-0.5" />, text: "Priority support" },
    { icon: <Signpost className="w-5 h-5 text-blue-500 mt-0.5" />, text: "Custom branding" },
    { icon: <Plus className="w-5 h-5 text-blue-500 mt-0.5" />, text: "Everything from Basic" },
  ],
};

export default function UpgradeAccount() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const { data: session } = useSession();

  const param = (searchParams.get("plan") || "").toLowerCase();
  const validPlan: PlanKey = param === "pro" ? "pro" : "basic";
  const isParamInvalid = param !== "" && param !== "basic" && param !== "pro";

  const cycle = (searchParams.get("cycle") || "monthly").toLowerCase();
  const validCycle: "monthly" | "quarterly" | "annual" =
    cycle === "quarterly" ? "quarterly" : cycle === "annual" ? "annual" : "monthly";

  const [submitting, setSubmitting] = useState(false);

  const plan = useMemo(() => PLAN_DETAILS[validPlan], [validPlan]);
  const points = SELLING_POINTS[validPlan];

  // Get current user's plan tier
  const currentTier = session?.user?.subscription?.tier?.toUpperCase() || "FREE";

  // Determine if this is an upgrade or downgrade
  const tierHierarchy: Record<string, number> = {
    "FREE": 0,
    "BASIC": 1,
    "PRO": 2
  };

  const isUpgrade = tierHierarchy[validPlan.toUpperCase()] > tierHierarchy[currentTier];
  const isDowngrade = tierHierarchy[validPlan.toUpperCase()] < tierHierarchy[currentTier];
  const actionText = isDowngrade ? "Downgrade" : "Upgrade";

  const handleCheckout = async () => {
    setSubmitting(true);

    try {
      console.log("Starting checkout with:", { plan: validPlan, billingCycle: validCycle });

      const res = await fetch("/api/billing/subscription/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: validPlan, billingCycle: validCycle }),
      });

      const data = await res.json();
      console.log("Checkout API response:", { status: res.status, ok: res.ok, data });

      if (!res.ok || !data.success) {
        toast({
          title: "Error",
          description: data.error || "Failed to start checkout",
          variant: "destructive",
        });
        setSubmitting(false);
        return;
      }

      if (!data.url) {
        toast({
          title: "Error",
          description: "No checkout URL received",
          variant: "destructive",
        });
        setSubmitting(false);
        return;
      }

      console.log("Redirecting to Stripe checkout:", data.url);

      // Redirect to Stripe Checkout using the URL
      window.location.href = data.url;

    } catch (err: any) {
      console.error("Checkout error:", err);
      toast({
        title: "Checkout Failed",
        description: err.message || "Please try again later",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const accent = plan.color === "green" ? "emerald" : "blue";

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 bg-gray-50">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold text-gray-900">{actionText} to {plan.label}</h1>
        <p className="text-gray-600">
          Complete your billing details to {isDowngrade ? 'downgrade to' : 'start'} your {plan.label.toLowerCase()} plan.
        </p>
      </div>

      {isParamInvalid && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <p>Unknown plan in URL. Defaulting to Basic.</p>
        </div>
      )}

      <div className="grid gap-y-6 lg:gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{actionText} to {plan.label}</CardTitle>
                <CardDescription>
                  {plan.price[validCycle]}/{validCycle} • Recurring Billing
                </CardDescription>
              </div>
              <Badge className={`bg-${accent}-600 hover:bg-${accent}-600`}>
                {plan.label}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <Lock className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-blue-900">Secure Payment via Stripe</p>
                <p className="text-sm text-blue-700">
                  Your payment information is handled securely by Stripe. We never see or store your card
                  details. All transactions are encrypted and PCI-DSS compliant.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="font-semibold text-gray-900">What happens next:</h3>
              <ol className="space-y-2 text-sm text-gray-600">
                <li className="flex gap-2"><span className="font-semibold text-gray-900">1.</span> Click the {actionText.toLowerCase()} button below</li>
                <li className="flex gap-2"><span className="font-semibold text-gray-900">2.</span> You'll be redirected to Stripe's secure payment page</li>
                <li className="flex gap-2"><span className="font-semibold text-gray-900">3.</span> Enter your payment details safely on Stripe</li>
                <li className="flex gap-2"><span className="font-semibold text-gray-900">4.</span> Your {isDowngrade ? 'downgraded' : 'new'} subscription will be activated immediately</li>
              </ol>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Plan</span>
                <span className="font-medium text-gray-900">{plan.label}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Billing Cycle</span>
                <span className="font-medium text-gray-900">
                  {validCycle.charAt(0).toUpperCase() + validCycle.slice(1)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Amount</span>
                <span className={`font-semibold text-${accent}-700`}>
                  {plan.price[validCycle]}/{validCycle}
                </span>
              </div>
            </div>

            <Separator />

            <div className="space-y-2 text-xs text-gray-500">
              <p>• Your subscription will automatically renew until canceled</p>
              <p>• You can cancel or change your plan anytime from billing settings</p>
              <p>• Taxes may apply based on your location</p>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
            <Button variant="outline" onClick={() => router.push("/dashboard/billing")} className="w-full md:w-auto">
              Cancel
            </Button>
            <Button
              onClick={handleCheckout}
              disabled={submitting}
              className={`w-full md:w-auto bg-${accent}-600 hover:bg-${accent}-700 flex items-center gap-2`}
            >
              {submitting ? (
                <>Processing...</>
              ) : (
                <>
                  <CreditCard className="w-4 h-4" />
                  {actionText} to {plan.label}
                </>
              )}
            </Button>
          </CardFooter>
        </Card>

        <Card className="col-span-2 lg:col-span-1">
          <CardHeader>
            <CardTitle>Why {plan.label}?</CardTitle>
            <CardDescription>Highlights of the {plan.label} plan</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-3">
              {points.map((p, idx) => (
                <li key={idx} className="flex items-center gap-2">
                  {p.icon}
                  <span className="text-sm text-gray-700">{p.text}</span>
                </li>
              ))}
            </ul>
            <Separator />
            <div className="text-sm text-gray-600 inline-flex">
              <p>Not enough? Upgrade to </p>
              {plan.label === "Basic" ? (
                <a href="/dashboard/billing/upgrade?plan=pro" className="text-blue-600 underline mx-1">Pro</a>
              ) : (
                <a href="/dashboard/billing/enterprise-contact" className="text-blue-600 underline mx-1">Enterprise</a>
              )}
              <p> instead.</p>
            </div>
            <Separator />
            <div className="text-sm text-gray-600">Manage or cancel anytime. Taxes may apply.</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
