'use client';

import { useState, useEffect } from 'react';
import { useSession } from "@/lib/session-client";
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { formatPhoneNumber } from '@/lib/phone-utils';
import { QuestionForm } from './question-form';
import { AssistanceForm } from './assistance-form';
import { SuggestionForm } from './suggestion-form';
import { DemoForm } from './demo-form';

type InquiryType = 'question' | 'assistance' | 'suggestion' | 'demo' | '';

interface FormData {
  name: string;
  email: string;
  inquiryType: InquiryType;
  subject: string;
  message: string;
  companyName?: string;
  phoneNumber?: string;
  currentIssue?: string;
  featureRequest?: string;
  preferredDate?: string;
  preferredTime?: string;
  companySize?: string;
}

export function ContactForm() {
  const { data: session } = useSession();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    name: '',
    email: '',
    inquiryType: '',
    subject: '',
    message: '',
  });

  // Autofill name, email, and inquiry type from session and URL parameters
  useEffect(() => {
    const updates: Partial<FormData> = {};

    // Autofill from session
    if (session?.user) {
      updates.name = session.user.name || '';
      updates.email = session.user.email || '';
    }

    // Check for inquiry type in URL parameters (supports: inquiryType)
    const urlInquiryType = 
      searchParams.get('inquiryType')

    if (urlInquiryType) {
      const validTypes: InquiryType[] = ['question', 'assistance', 'suggestion', 'demo'];
      const normalizedType = urlInquiryType.toLowerCase();
      
      if (validTypes.includes(normalizedType as InquiryType)) {
        updates.inquiryType = normalizedType as InquiryType;
      }
    }

    if (Object.keys(updates).length > 0) {
      setFormData((prev) => ({
        ...prev,
        ...updates,
      }));
    }
  }, [session, searchParams]);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    
    setFormData((prev) => ({
    ...prev,
    [name]: value,
    }));

  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleInquiryTypeChange = (value: string) => {
    setFormData((prev) => ({
      ...prev,
      inquiryType: value as InquiryType,
      // Clear conditional fields when inquiry type changes
      companyName: undefined,
      phoneNumber: undefined,
      currentIssue: undefined,
      featureRequest: undefined,
      preferredDate: undefined,
      preferredTime: undefined,
      companySize: undefined,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await fetch('/api/contact/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (response.ok) {
        toast({
          title: 'Message sent successfully!',
          description: 'We\'ll get back to you as soon as possible.',
        });

        // Reset form after successful submission
        setFormData({
          name: session?.user?.name || '',
          email: session?.user?.email || '',
          inquiryType: '',
          subject: '',
          message: '',
        });

        // Redirect based on session status
        setTimeout(() => {
          if (session?.user) {
            router.push('/dashboard');
          } else {
            router.push('/');
          }
        }, 2000);
      } else {
        toast({
          title: 'Error',
          description: data.error || 'Failed to send message. Please try again.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'An unexpected error occurred. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const renderConditionalFields = () => {
    switch (formData.inquiryType) {
      case 'question':
        return (
          <QuestionForm
            subject={formData.subject}
            onChange={handleInputChange}
            isLoading={isLoading}
          />
        );

      case 'assistance':
        return (
          <AssistanceForm
            subject={formData.subject}
            currentIssue={formData.currentIssue || ''}
            phoneNumber={formData.phoneNumber || ''}
            onChange={handleInputChange}
            isLoading={isLoading}
          />
        );

      case 'suggestion':
        return (
          <SuggestionForm
            subject={formData.subject}
            featureRequest={formData.featureRequest || ''}
            onChange={handleInputChange}
            isLoading={isLoading}
          />
        );

      case 'demo':
        return (
          <DemoForm
            companyName={formData.companyName || ''}
            companySize={formData.companySize || ''}
            phoneNumber={formData.phoneNumber || ''}
            preferredDate={formData.preferredDate || ''}
            preferredTime={formData.preferredTime || ''}
            onChange={handleInputChange}
            onSelectChange={handleSelectChange}
            isLoading={isLoading}
          />
        );

      default:
        return null;
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Contact Us</CardTitle>
        <CardDescription>
          Have a question or need assistance? We're here to help!
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              placeholder="Your full name"
              required
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleInputChange}
              placeholder="your.email@example.com"
              required
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="inquiryType">Inquiry Type</Label>
            <Select
              value={formData.inquiryType}
              onValueChange={handleInquiryTypeChange}
              disabled={isLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select inquiry type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="question">General Question</SelectItem>
                <SelectItem value="assistance">Technical Assistance</SelectItem>
                <SelectItem value="suggestion">Suggestion/Feature Request</SelectItem>
                <SelectItem value="demo">Schedule a Demo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {renderConditionalFields()}

          {formData.inquiryType && formData.inquiryType !== 'demo' && (
            <div className="space-y-2">
              <Label htmlFor="message">Additional Details</Label>
              <Textarea
                id="message"
                name="message"
                value={formData.message}
                onChange={handleInputChange}
                placeholder="Any additional information you'd like to share"
                className="min-h-[120px]"
                disabled={isLoading}
              />
            </div>
          )}

          {formData.inquiryType === 'demo' && (
            <div className="space-y-2">
              <Label htmlFor="message">Additional Requirements</Label>
              <Textarea
                id="message"
                name="message"
                value={formData.message}
                onChange={handleInputChange}
                placeholder="Any specific features or use cases you'd like to see in the demo?"
                className="min-h-[100px]"
                disabled={isLoading}
              />
            </div>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={isLoading || !formData.inquiryType}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              'Submit'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
