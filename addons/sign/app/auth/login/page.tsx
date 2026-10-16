
import { Metadata } from 'next';
import { LoginForm } from '@/components/auth/login-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import { FileSignature, Sparkles } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Login - SynergySign',
  description: 'Sign in to your electronic signature platform account',
};

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo and branding */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center space-x-2">
            <div className="bg-blue-600 p-2 rounded-lg">
              <FileSignature className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-bold text-gray-900">SynergySign</span>
          </div>
          <p className="text-gray-600">Welcome back to the future of document signing</p>
        </div>

        {/* Login Card */}
        <Card className="shadow-xl border-0">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-semibold text-center">Sign In</CardTitle>
            <CardDescription className="text-center">
              Enter your credentials to access your account
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
            <div className="mt-6 text-center">
              <p className="text-sm text-gray-600">
                Don't have an account?{' '}
                <Link 
                  href="/auth/signup" 
                  className="font-medium text-blue-600 hover:text-blue-500 transition-colors"
                >
                  Sign up here
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Features highlight */}
        <div className="text-center">
          <div className="flex items-center justify-center space-x-1 text-sm text-gray-500">
            <Sparkles className="w-4 h-4 text-blue-500" />
            <span>AI-powered document analysis and field detection</span>
          </div>
        </div>
      </div>
    </div>
  );
}

