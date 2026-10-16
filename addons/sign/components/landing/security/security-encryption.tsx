import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowRight, CheckCircle, Lock } from "lucide-react";
import Link from "next/link";

export function SecurityEncryption() {
    return (
        <section className="py-20 px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-4xl md:text-5xl mb-6 text-gray-900">
                Military-Grade Encryption
              </h2>
              <p className="text-lg text-gray-600 mb-8 leading-relaxed">
                Your documents are protected with the same level of encryption used by
                financial institutions and government agencies.
              </p>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-gray-900">256-bit AES Encryption</p>
                    <p className="text-sm text-gray-600">
                      Industry-standard encryption for data at rest
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-gray-900">TLS 1.3 Protocol</p>
                    <p className="text-sm text-gray-600">
                      Secure data transmission with latest protocol
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-gray-900">Zero-Knowledge Architecture</p>
                    <p className="text-sm text-gray-600">
                      We can't access your documents even if we wanted to
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-gray-900">Secure Key Management</p>
                    <p className="text-sm text-gray-600">
                      Advanced key rotation and management protocols
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <Card className="p-10 bg-gradient-to-br from-blue-600 to-blue-700 text-white border-0 shadow-xl">
              <Lock className="w-16 h-16 mb-6 opacity-90" />
              <h3 className="text-3xl mb-4">End-to-End Protection</h3>
              <p className="text-blue-100 mb-6 leading-relaxed">
                Documents are encrypted before leaving your device and remain encrypted
                throughout storage and transmission. Only authorized parties with proper
                credentials can decrypt and access the content.
              </p>
              <div className="bg-white/10 rounded-lg p-4 backdrop-blur-sm">
                <p className="text-sm text-blue-100 mb-2">Encryption Status</p>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse" />
                  <span className="text-white">All Systems Secure</span>
                </div>
              </div>
            </Card>
          </div>

          <div className="text-center mt-12">
            <p className="text-sm text-gray-500 mt-3">
              Even hackers are impressed. And slightly intimidated.
            </p>
          </div>
        </div>
      </section>
    );
}