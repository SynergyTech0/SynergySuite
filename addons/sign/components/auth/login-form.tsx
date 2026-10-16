
'use client';

import { useEffect, useState } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function LoginForm() {
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const { data: session } = useSession();

  // Ask NextAuth what providers are actually configured, rather than hardcoding the button. If SSO
  // isn't wired (no client id/secret), the provider simply isn't registered and the button hides
  // itself — so a broken "Sign in with SynergyAuth" can never be shown.
  const [ssoAvailable, setSsoAvailable] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/providers')
      .then((r) => r.json())
      .then((p) => { if (!cancelled) setSsoAvailable(Boolean(p?.synergyauth)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const router = useRouter();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      // Ensure any existing session is cleared so the new login isn't blocked
      // await signOut({ redirect: false });
      // await new Promise((resolve) => setTimeout(resolve, 500)); // small delay to ensure signOut completes
      const result = await signIn('credentials', {
        email: formData.email,
        password: formData.password,
        redirect: false
      });

      if (result?.error) {
        setError('Invalid email or password');
      } else {
        if (session?.user.verified) {
          toast({
            title: 'Welcome back!',
            description: 'Successfully signed in to your account.',
          });
        }
        router.push('/dashboard');
        router.refresh();
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
    <div className="space-y-4">
      {/* Staff sign in through SynergyAuth (the same IdP as Drive and Boards). External signers
          never see this page at all — they open a tokenised /sign/<token> link. */}
      {ssoAvailable && (
        <>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={ssoLoading}
            onClick={() => {
              setSsoLoading(true);
              signIn('synergyauth', { callbackUrl: '/dashboard' });
            }}
          >
            {ssoLoading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Redirecting…</>
            ) : (
              <><ShieldCheck className="mr-2 h-4 w-4" /> Sign in with SynergyAuth</>
            )}
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">or with a password</span>
            </div>
          </div>
        </>
      )}

    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          value={formData.email}
          onChange={handleChange}
          placeholder="Enter your email"
          required
          disabled={isLoading}
        />
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
            placeholder="Enter your password"
            required
            disabled={isLoading}
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
            Signing In...
          </>
        ) : (
          'Sign In'
        )}
      </Button>
    </form>
    </div>
  );
}

