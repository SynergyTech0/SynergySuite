
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'react-hot-toast';

interface Enterprise {
  id: string;
  name: string;
  domain: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  userLimit: number;
  contractStartDate: Date | null;
  contractEndDate: Date | null;
  notes: string | null;
  customPricing: string | null;
  isActive: boolean;
}

export default function EnterpriseEditForm({
  enterprise,
}: {
  enterprise: Enterprise;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: enterprise.name,
    domain: enterprise.domain,
    contactName: enterprise.contactName,
    contactEmail: enterprise.contactEmail,
    contactPhone: enterprise.contactPhone || '',
    userLimit: enterprise.userLimit.toString(),
    contractStartDate: enterprise.contractStartDate
      ? new Date(enterprise.contractStartDate).toISOString().split('T')[0]
      : '',
    contractEndDate: enterprise.contractEndDate
      ? new Date(enterprise.contractEndDate).toISOString().split('T')[0]
      : '',
    notes: enterprise.notes || '',
    customPricing: enterprise.customPricing || '',
    isActive: enterprise.isActive,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch(`/api/admin/enterprises/${enterprise.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          userLimit: parseInt(formData.userLimit),
          contractStartDate: formData.contractStartDate || null,
          contractEndDate: formData.contractEndDate || null,
        }),
      });

      if (response.ok) {
        toast.success('Enterprise account updated successfully');
        router.refresh();
      } else {
        const error = await response.json();
        toast.error(error.message || 'Failed to update enterprise account');
      }
    } catch (error) {
      toast.error('An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Enterprise Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Company Name</Label>
              <Input
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="domain">Corporate Domain</Label>
              <Input
                id="domain"
                name="domain"
                value={formData.domain}
                onChange={handleChange}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contactName">Contact Name</Label>
              <Input
                id="contactName"
                name="contactName"
                value={formData.contactName}
                onChange={handleChange}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contactEmail">Contact Email</Label>
              <Input
                id="contactEmail"
                name="contactEmail"
                type="email"
                value={formData.contactEmail}
                onChange={handleChange}
                disabled
                className="bg-gray-50 cursor-not-allowed"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contactPhone">Contact Phone</Label>
              <Input
                id="contactPhone"
                name="contactPhone"
                type="tel"
                value={formData.contactPhone}
                onChange={handleChange}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="userLimit">User Limit</Label>
              <Input
                id="userLimit"
                name="userLimit"
                type="number"
                min="1"
                value={formData.userLimit}
                onChange={handleChange}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contractStartDate">Contract Start Date</Label>
              <Input
                id="contractStartDate"
                name="contractStartDate"
                type="date"
                value={formData.contractStartDate}
                onChange={handleChange}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contractEndDate">Contract End Date</Label>
              <Input
                id="contractEndDate"
                name="contractEndDate"
                type="date"
                value={formData.contractEndDate}
                onChange={handleChange}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="isActive" className="flex items-center space-x-2">
                <input
                  id="isActive"
                  name="isActive"
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={handleChange}
                  className="rounded"
                />
                <span>Active</span>
              </Label>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="customPricing">Custom Pricing Details</Label>
            <Textarea
              id="customPricing"
              name="customPricing"
              value={formData.customPricing}
              onChange={handleChange}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows={4}
            />
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
