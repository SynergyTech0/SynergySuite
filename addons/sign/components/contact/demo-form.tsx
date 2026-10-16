import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface DemoFormProps {
  companyName: string;
  companySize: string;
  phoneNumber: string;
  preferredDate: string;
  preferredTime: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSelectChange: (name: string, value: string) => void;
  isLoading: boolean;
}

export function DemoForm({
  companyName,
  companySize,
  phoneNumber,
  preferredDate,
  preferredTime,
  onChange,
  onSelectChange,
  isLoading,
}: DemoFormProps) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="companyName">Company Name</Label>
        <Input
          id="companyName"
          name="companyName"
          value={companyName}
          onChange={onChange}
          placeholder="Your company name"
          required
          disabled={isLoading}
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="companySize">Company Size</Label>
        <Select
          value={companySize}
          onValueChange={(value) => onSelectChange('companySize', value)}
          disabled={isLoading}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select company size" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1-10">1-10 employees</SelectItem>
            <SelectItem value="11-50">11-50 employees</SelectItem>
            <SelectItem value="51-200">51-200 employees</SelectItem>
            <SelectItem value="201-500">201-500 employees</SelectItem>
            <SelectItem value="501+">501+ employees</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="phoneNumber">Phone Number</Label>
        <Input
          id="phoneNumber"
          name="phoneNumber"
          type="tel"
          value={phoneNumber}
          onChange={onChange}
          placeholder="Best number to reach you"
          required
          disabled={isLoading}
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="preferredDate">Preferred Demo Date</Label>
        <Input
          id="preferredDate"
          name="preferredDate"
          type="date"
          value={preferredDate}
          onChange={onChange}
          min={new Date().toISOString().split('T')[0]}
          required
          disabled={isLoading}
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="preferredTime">Preferred Time</Label>
        <Select
          value={preferredTime}
          onValueChange={(value) => onSelectChange('preferredTime', value)}
          disabled={isLoading}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select preferred time" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="morning">Morning (9AM - 12PM)</SelectItem>
            <SelectItem value="afternoon">Afternoon (12PM - 5PM)</SelectItem>
            <SelectItem value="evening">Evening (5PM - 8PM)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
