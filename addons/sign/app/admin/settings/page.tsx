
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function AdminSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">System Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure platform-wide settings
        </p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Email Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>SMTP Server</Label>
              <Input placeholder="smtp.example.com" disabled />
            </div>
            <div className="space-y-2">
              <Label>From Email</Label>
              <Input placeholder="noreply@synergysign.com" disabled />
            </div>
            <Button disabled>Save Email Settings</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Storage Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Storage Provider</Label>
              <Input value="Hybrid (Local + S3)" disabled />
            </div>
            <div className="space-y-2">
              <Label>Max File Size (MB)</Label>
              <Input type="number" value="50" disabled />
            </div>
            <Button disabled>Save Storage Settings</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Platform Limits</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Free Tier - Documents/Month</Label>
                <Input type="number" value="3" disabled />
              </div>
              <div className="space-y-2">
                <Label>Free Tier - Signers/Document</Label>
                <Input type="number" value="3" disabled />
              </div>
              <div className="space-y-2">
                <Label>Basic Tier - Documents/Month</Label>
                <Input type="number" value="25" disabled />
              </div>
              <div className="space-y-2">
                <Label>Basic Tier - Signers/Document</Label>
                <Input type="number" value="10" disabled />
              </div>
              <div className="space-y-2">
                <Label>Pro Tier - Documents/Month</Label>
                <Input type="number" value="100" disabled />
              </div>
              <div className="space-y-2">
                <Label>Pro Tier - Signers/Document</Label>
                <Input type="number" value="Unlimited" disabled />
              </div>
            </div>
            <Button disabled>Save Platform Limits</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notification Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Send Welcome Emails</Label>
                <p className="text-sm text-muted-foreground">
                  Send welcome email to new users
                </p>
              </div>
              <input type="checkbox" className="rounded" defaultChecked disabled />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Send Signature Reminders</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically remind signers after 3 days
                </p>
              </div>
              <input type="checkbox" className="rounded" defaultChecked disabled />
            </div>
            <Button disabled>Save Notification Settings</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
