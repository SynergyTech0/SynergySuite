
'use client';

import { useState, useEffect } from 'react';
import { signIn, signOut } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Eye, EyeOff, Loader2, Gift } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function SignupForm() {
  const searchParams = useSearchParams();
  const referralCode = searchParams.get('ref');
  const invitationToken = searchParams.get('invitation');
  const planParam = (searchParams.get('plan') || '').toLowerCase();
  const validPlan = ['basic', 'pro', 'enterprise'].includes(planParam)
    ? planParam
    : '';

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    companyName: '',
    role: 'SENDER',
    referralCode: referralCode || '',
    invitationToken: invitationToken || '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const router = useRouter();
  const { toast } = useToast();
  
  useEffect(() => {
    if (referralCode) {
      setFormData(prev => ({ ...prev, referralCode }));
    }
  }, [referralCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Validate form data here
    if (!formData.email || !formData.password || !formData.firstName || !formData.lastName) {
      setError('Please fill in all required fields');
      return;
    }

    if (!formData.companyName) {
      setFormData(prev => ({ ...prev, companyName: 'Individual' }));
    }

    if (formData.firstName.match(/[^a-zA-Z'-]/) || formData.lastName.match(/[^a-zA-Z'-]/)) {
      setError('Name contains invalid characters');
      return;
    }

    if (!formData.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      setError('Please enter a valid email address');
      return;
    }

    if (formData.password.length < 8 || !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&()^$#.,<>])[A-Za-z\d@$!%*?&()^$#.,<>]/.test(formData.password)) {
      setError('Password must be at least 8 characters and include uppercase, lowercase, number, and special character');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to create account');
        return;
      }

      // Automatically sign in after successful signup
      // Ensure any existing session is cleared so the new login isn't blocked
      await signOut({ redirect: false });
      
      // Small delay to ensure session is fully cleared
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const result = await signIn('credentials', {
        email: formData.email,
        password: formData.password,
        redirect: false
      });

      if (result?.error) {
        console.error('Sign in error:', result.error);
        setError(`Account created but login failed: ${result.error}. Please try signing in.`);
      } else {
        toast({
          title: 'Account created successfully!',
          description: 'We\'ve sent a verification code to your email. Please check your inbox and enter the code to verify your account.',
        });
        // Build verify URL with plan parameter or fromReferral flag
        let verifyUrl = `/auth/verify?email=${encodeURIComponent(formData.email)}`;
        if (validPlan) {
          verifyUrl += `&plan=${encodeURIComponent(validPlan)}`;
        } else if (formData.referralCode) {
          // Users from affiliate links should choose a paid plan
          verifyUrl += `&fromReferral=true`;
        }
        router.replace(verifyUrl);
      }
    } catch (error) {
      setError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {referralCode && (
        <Alert className="bg-green-50 border-green-200">
          <Gift className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800">
            You were referred by a friend! Your referrer will earn rewards when you upgrade.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="firstName">First Name</Label>
          <Input
            id="firstName"
            name="firstName"
            value={formData.firstName}
            onChange={handleChange}
            placeholder="John"
            required
            disabled={isLoading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="lastName">Last Name</Label>
          <Input
            id="lastName"
            name="lastName"
            value={formData.lastName}
            onChange={handleChange}
            placeholder="Doe"
            required
            disabled={isLoading}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          value={formData.email}
          onChange={handleChange}
          placeholder="john@company.com"
          required
          disabled={isLoading}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="companyName">Company Name</Label>
        <Input
          id="companyName"
          name="companyName"
          value={formData.companyName}
          onChange={handleChange}
          placeholder="Your Company Inc."
          disabled={isLoading}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="role">Role</Label>
        <Select
          value={formData.role}
          onValueChange={(value) => setFormData(prev => ({ ...prev, role: value }))}
          disabled={isLoading}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select your role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="SENDER">Document Sender</SelectItem>
            <SelectItem value="SIGNER">Document Signer</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            value={formData.password}
            onChange={handleChange}
            placeholder="Create a strong password"
            required
            disabled={isLoading}
            minLength={8}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
            onClick={() => setShowPassword(!showPassword)}
            disabled={isLoading}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4 text-gray-500" />
            ) : (
              <Eye className="h-4 w-4 text-gray-500" />
            )}
          </Button>
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Creating Account...
          </>
        ) : (
          'Create Account'
        )}
      </Button>

      <p className="text-xs text-gray-600 text-center">
        By creating an account, you agree to our Terms of Service and Privacy Policy.
      </p>
    </form>
  );
}

