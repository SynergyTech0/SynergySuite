import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface SuggestionFormProps {
  subject: string;
  featureRequest: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  isLoading: boolean;
}

export function SuggestionForm({
  subject,
  featureRequest,
  onChange,
  isLoading,
}: SuggestionFormProps) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="subject">Suggestion Title</Label>
        <Input
          id="subject"
          name="subject"
          value={subject}
          onChange={onChange}
          placeholder="What's your suggestion about?"
          required
          disabled={isLoading}
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="featureRequest">Detailed Suggestion/Request</Label>
        <Textarea
          id="featureRequest"
          name="featureRequest"
          value={featureRequest}
          onChange={onChange}
          placeholder="Tell us more about your suggestion or feature request"
          className="min-h-[100px]"
          required
          disabled={isLoading}
        />
      </div>
    </>
  );
}
