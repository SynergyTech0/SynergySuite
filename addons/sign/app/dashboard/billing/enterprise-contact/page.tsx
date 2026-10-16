"use client";

import { useState } from "react";
import {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
    CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectTrigger,
    SelectContent,
    SelectItem,
    SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
    Building2,
    Users,
    Shield,
    Sparkles,
    Plug,
    Lock,
    Phone,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";

interface EnterpriseFormData {
    companyName: string;
    contactName: string;
    email: string;
    licenses: number;
    subscription: string;
    message: string;
}

export default function EnterpriseContactPage() {
    const { toast } = useToast();
    const [submitting, setSubmitting] = useState(false);

    const [form, setForm] = useState<EnterpriseFormData>({
        companyName: "",
        contactName: "",
        email: "",
        licenses: 25,
        subscription: "YEARLY",
        message: "",
    });

    const router = useRouter();

    const update = (field: keyof EnterpriseFormData, value: any) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    };

    const validateEmail = (email: string) =>
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Required fields validation
        if (!form.companyName || !form.contactName || !form.email || !form.message) {
            toast({
                title: "Missing fields",
                description: "Please fill all required fields.",
            });
            return;
        }

        if (!validateEmail(form.email)) {
            toast({
                title: "Invalid Email",
                description: "Enter a valid email address.",
            });
            return;
        }

        if (form.licenses < 25) {
            toast({
                title: "Minimum Licenses Required",
                description: "Enterprise plan requires at least 25 seats/licenses.",
            });
            return;
        }

        setSubmitting(true);

        try {
            const res = await fetch("/api/enterprise/request", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                
                body: JSON.stringify({
                    companyName: form.companyName,
                    contactName: form.contactName,
                    email: form.email,
                    message: form.message,
                    subscription: "YEARLY",
                    licenses: form.licenses,
                    teamSizeRange: `${form.licenses}+`,
                }),
            });

            if (res.ok) {
                const data = await res.json().catch(() => ({}));

                // Redirect to Stripe Checkout to add payment method
                if (data.checkoutUrl) {
                    toast({
                        title: "Request submitted!",
                        description: "Redirecting to secure payment setup...",
                    });
                    window.location.href = data.checkoutUrl;
                } else {
                    // Fallback if no checkout URL
                    toast({
                        title: "Request submitted",
                        description: (
                            <>
                                <div><strong>Request ID:</strong> {data?.requestId || "N/A"}</div>
                                <div>Our team will reach out shortly.</div>
                            </>
                        ),
                    });

                    setForm({
                        companyName: "",
                        contactName: "",
                        email: "",
                        licenses: 25,
                        subscription: "YEARLY",
                        message: "",
                    });

                    router.replace("/dashboard/billing");
                }
            } else {
                const data = await res.json().catch(() => ({}));
                toast({
                    title: "Submission failed",
                    description: data.error || "Please try again later.",
                });
            }
        } catch {
            toast({
                title: "Network error",
                description: "Could not submit enterprise request.",
            });
        } finally {
            setSubmitting(false);
        }
    };

    const enterpriseTalkingPoints = [
        { icon: Building2, text: "Dedicated account manager" },
        { icon: Plug, text: "Custom integrations" },
        { icon: Shield, text: "SLA & compliance (SOC2 / GDPR)" },
        { icon: Lock, text: "SSO / advanced authentication" },
        { icon: Sparkles, text: "Advanced analytics & reporting" },
        { icon: Users, text: "Scalable team management" },
        { icon: Phone, text: "Priority support access" },
    ];

    const enterpriseLongPoints = [
        {
            color: "blue",
            text: "Security First",
            description:
                "We support strict compliance workflows and security review processes.",
        },
        {
            color: "green",
            text: "Future Ready",
            description:
                "Our platform scales with the evolving needs of enterprise teams.",
        },
    ];

    return (
        <>
            {submitting && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-4">
                        <Spinner size="lg" />
                        <p className="text-gray-700 font-medium">Submitting request...</p>
                    </div>
                </div>
            )}
            <div className="p-6 max-w-6xl mx-auto space-y-6">
                <h1 className="text-3xl font-bold text-gray-900">Enterprise Inquiry</h1>
                <p className="text-gray-600">
                    Tell us about your organization and we'll tailor a solution.
                </p>

            <div className="grid gap-6 md:grid-cols-3">
                {/* FORM */}
                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle>Contact Information</CardTitle>
                        <CardDescription>
                            Provide details so we can prepare a custom enterprise proposal.
                        </CardDescription>
                    </CardHeader>

                    <form onSubmit={onSubmit}>
                        <CardContent className="space-y-6">
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                <div className="flex gap-2 items-start">
                                    <Lock className="w-5 h-5 text-blue-600 mt-0.5" />
                                    <div className="text-sm text-blue-800">
                                        <strong>Next Step: Secure Payment Setup</strong>
                                        <p className="mt-1 text-blue-700">
                                            After submitting this form, you'll be redirected to Stripe's secure payment page to add your payment method. 
                                            You won't be charged until our team reviews and activates your enterprise account.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="grid md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Company Name *</Label>
                                    <Input
                                        value={form.companyName}
                                        onChange={(e) => update("companyName", e.target.value)}
                                        required
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label>Contact Name *</Label>
                                    <Input
                                        value={form.contactName}
                                        onChange={(e) => update("contactName", e.target.value)}
                                        required
                                    />
                                </div>
                            </div>

                            <div className="grid md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Email *</Label>
                                    <Input
                                        type="email"
                                        value={form.email}
                                        onChange={(e) => update("email", e.target.value)}
                                        required
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label>Number of Seats / Licenses (min. 25) *</Label>
                                    <Input
                                        type="number"
                                        min={25}
                                        value={form.licenses}
                                        onChange={(e) => update("licenses", Number(e.target.value))}
                                        required
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Subscription Type *</Label>
                                <Select value="YEARLY" disabled>
                                    <SelectTrigger>
                                        <SelectValue placeholder="YEARLY" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="YEARLY">Yearly (Required)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label>Use Case / Message *</Label>
                                <Textarea
                                    rows={5}
                                    placeholder="Describe primary workflows, integrations, volume, compliance needs..."
                                    value={form.message}
                                    onChange={(e) => update("message", e.target.value)}
                                    required
                                />
                            </div>

                            <div className="text-xs text-gray-500">* Required fields</div>
                        </CardContent>

                        <CardFooter>
                            <Button type="submit" disabled={submitting} className="w-full md:w-auto">
                                {submitting ? "Submitting..." : "Submit Enterprise Request"}
                            </Button>
                        </CardFooter>
                    </form>
                </Card>

                {/* SIDE PANEL */}
                <Card>
                    <CardHeader>
                        <CardTitle>Why Enterprise?</CardTitle>
                        <CardDescription>Includes all Pro features plus:</CardDescription>
                    </CardHeader>

                    <CardContent className="space-y-4">
                        {enterpriseTalkingPoints.map((p, i) => (
                            <div key={i} className="flex gap-3">
                                <p.icon className="w-5 h-5 text-purple-600" />
                                <span className="text-sm text-gray-700">{p.text}</span>
                            </div>
                        ))}

                        {enterpriseLongPoints.map((point, i) => (
                            <div key={i}>
                                <Badge variant="outline" className={`bg-${point.color}-100`}>
                                    {point.text}
                                </Badge>
                                <p className="text-gray-600 text-sm mt-1">{point.description}</p>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </div>
        </div>
        </>
    );
}
