import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, Shield } from "lucide-react";
import Link from "next/link";

export function SecurityHero() {
    return (
        <section className="pt-32 pb-20 px-6 lg:px-8 bg-white">
        <div className="mx-auto max-w-7xl">
          <div className="text-center max-w-4xl mx-auto">
            <Badge 
              variant="outline" 
              className="mb-6 border-blue-200 text-blue-700 bg-blue-50/50 px-4 py-1.5"
            >
              <Shield className="w-3.5 h-3.5 mr-1.5" />
              ENTERPRISE SECURITY
            </Badge>
            <h1 className="text-5xl md:text-6xl mb-6 text-gray-900">
              Security & Compliance
            </h1>
            <p className="text-xl text-gray-600 mb-10 leading-relaxed">
              Your documents are protected with bank-grade encryption, comprehensive
              audit trails, and full legal compliance. Security is at the core of
              everything we do.
            </p>
            <div className="inline-block">
              <Link href="/auth/signup">
                <Button size="lg" className="bg-blue-600 hover:bg-blue-700 text-white px-8">
                  Start For Free
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
              <p className="text-sm text-gray-500 mt-3">
                Because your paranoia about security is completely justified
              </p>
            </div>
          </div>
        </div>
      </section>
    );
}