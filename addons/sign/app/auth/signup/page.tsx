
import { Metadata } from 'next';
import { SignupForm } from '@/components/auth/signup-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import { FileSignature, Shield, Zap, Users } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Sign Up - SynergySign',
  description: 'Create your electronic signature platform account',
};

export default function SignupPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
          
          {/* Left side - Features */}
          <div className="space-y-6 lg:pr-8">
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <div className="bg-blue-600 p-2 rounded-lg">
                  <FileSignature className="w-6 h-6 text-white" />
                </div>
                <span className="text-2xl font-bold text-gray-900">SynergySign</span>
              </div>
              <h1 className="text-3xl font-bold text-gray-900">
                The Future of Electronic Signatures
              </h1>
              <p className="text-lg text-gray-600">
                AI-powered document processing with seamless signing workflows
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex items-start space-x-3">
                <div className="bg-blue-100 p-2 rounded-lg">
                  <Zap className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">AI Field Detection</h3>
                  <p className="text-gray-600">Automatically identify optimal signature field placement</p>
                </div>
              </div>
              
              <div className="flex items-start space-x-3">
                <div className="bg-green-100 p-2 rounded-lg">
                  <Shield className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Enterprise Security</h3>
                  <p className="text-gray-600">Bank-level encryption and compliance standards</p>
                </div>
              </div>
              
              <div className="flex items-start space-x-3">
                <div className="bg-purple-100 p-2 rounded-lg">
                  <Users className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Multi-Party Signing</h3>
                  <p className="text-gray-600">Sequential or parallel signing workflows</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right side - Signup form */}
          <div>
            <Card className="shadow-xl border-0">
              <CardHeader className="space-y-1">
                <CardTitle className="text-2xl font-semibold text-center">Create Account</CardTitle>
                <CardDescription className="text-center">
                  Get started signing documents today
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SignupForm />
                <div className="mt-6 text-center">
                  <p className="text-sm text-gray-600">
                    Already have an account?{' '}
                    <Link 
                      href="/auth/login" 
                      className="font-medium text-blue-600 hover:text-blue-500 transition-colors"
                    >
                      Sign in here
                    </Link>
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

