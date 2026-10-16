import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface QuestionFormProps {
  subject: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isLoading: boolean;
}

export function QuestionForm({ subject, onChange, isLoading }: QuestionFormProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="subject">Question Subject</Label>
      <Input
        id="subject"
        name="subject"
        value={subject}
        onChange={onChange}
        placeholder="What would you like to know about?"
        required
        disabled={isLoading}
      />
    </div>
  );
}
