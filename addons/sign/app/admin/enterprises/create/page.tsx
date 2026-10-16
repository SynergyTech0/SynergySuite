
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function CreateEnterprisePage() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    domain: '',
    contactName: '',
    contactEmail: '',
    licenses: '25',
    customPricing: '',
    notes: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const licenses = formData.licenses ? parseInt(formData.licenses) : 25;
    if (licenses < 25) {
      toast({
        title: 'Validation Error',
        description: 'Number of licenses must be at least 25',
        variant: 'destructive',
      });
      setLoading(false);
      return;
    }

    if (formData.customPricing) {
      const pricingValue = parseFloat(formData.customPricing);
      if (isNaN(pricingValue) || pricingValue < 0) {
        toast({
          title: 'Validation Error',
          description: 'Custom pricing must be a valid number greater than or equal to 0',
          variant: 'destructive',
        });
        setLoading(false);
        return;
      }
    }

    try {
      const response = await fetch('/api/admin/enterprises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          domain: formData.domain,
          contactName: formData.contactName,
          contactEmail: formData.contactEmail,
          licenses: licenses,
          customPricing: formData.customPricing ? parseFloat(formData.customPricing) : null,
          notes: formData.notes || null,
          priceId: null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create enterprise');
      }

      toast({
        title: 'Success',
        description: data.message || 'Enterprise created successfully',
      });

      router.push('/admin/enterprises');
      router.refresh();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create enterprise',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8">
      <Link href="/admin/enterprises">
        <Button variant="ghost" className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Enterprises
        </Button>
      </Link>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Create Enterprise Account</CardTitle>
          <CardDescription>Add a new enterprise customer to the platform</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="name">Enterprise Name *</Label>
              <Input
                id="name"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Acme Corporation"
              />
            </div>

            <div>
              <Label htmlFor="domain">Email Domain *</Label>
              <Input
                id="domain"
                required
                value={formData.domain}
                onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                placeholder="acme.com"
              />
              <p className="text-sm text-gray-500 mt-1">
                Users with this email domain will automatically be assigned to this enterprise
              </p>
            </div>

            <div>
              <Label htmlFor="contactName">Contact Name *</Label>
              <Input
                id="contactName"
                required
                value={formData.contactName}
                onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                placeholder="John Doe"
              />
            </div>

            <div>
              <Label htmlFor="contactEmail">Contact Email *</Label>
              <Input
                id="contactEmail"
                type="email"
                required
                value={formData.contactEmail}
                onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                placeholder="contact@acme.com"
              />
              <p className="text-sm text-gray-500 mt-1">
                User with this email must already have an account in the system
              </p>
            </div>

            <div>
              <Label htmlFor="licenses">Number of Licenses *</Label>
              <Input
                id="licenses"
                type="number"
                required
                min="25"
                value={formData.licenses}
                onChange={(e) => setFormData({ ...formData, licenses: e.target.value })}
                placeholder="25"
              />
              <p className="text-sm text-gray-500 mt-1">Minimum: 25 licenses (Enterprise plan requirement)</p>
            </div>

            <div>
              <Label htmlFor="customPricing">Custom Pricing ($/month)</Label>
              <Input
                id="customPricing"
                type="number"
                step="0.01"
                min="0"
                value={formData.customPricing}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === '' || (parseFloat(value) >= 0 && !isNaN(parseFloat(value)))) {
                    setFormData({ ...formData, customPricing: value });
                  }
                }}
                placeholder="99.99"
              />
              <p className="text-sm text-gray-500 mt-1">Leave empty for standard Enterprise pricing. Must be 0 or greater.</p>
            </div>

            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Additional notes about this enterprise..."
                rows={4}
              />
            </div>

            <div className="flex gap-4">
              <Button type="submit" disabled={loading}>
                {loading ? 'Creating...' : 'Create Enterprise'}
              </Button>
              <Link href="/admin/enterprises">
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
