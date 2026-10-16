import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface AssistanceFormProps {
  subject: string;
  currentIssue: string;
  phoneNumber: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  isLoading: boolean;
}

export function AssistanceForm({
  subject,
  currentIssue,
  phoneNumber,
  onChange,
  isLoading,
}: AssistanceFormProps) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="subject">Issue Subject</Label>
        <Input
          id="subject"
          name="subject"
          value={subject}
          onChange={onChange}
          placeholder="Brief description of your issue"
          required
          disabled={isLoading}
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="currentIssue">Current Issue Details</Label>
        <Textarea
          id="currentIssue"
          name="currentIssue"
          value={currentIssue}
          onChange={onChange}
          placeholder="Please describe the issue you're experiencing in detail"
          className="min-h-[100px]"
          required
          disabled={isLoading}
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="phoneNumber">Phone Number (Optional)</Label>
        <Input
          id="phoneNumber"
          name="phoneNumber"
          type="tel"
          value={phoneNumber}
          onChange={onChange}
          placeholder="For urgent support callbacks"
          disabled={isLoading}
        />
      </div>
    </>
  );
}
