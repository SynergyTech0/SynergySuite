import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, Brain } from "lucide-react";
import Link from "next/link";

export function FeaturesHero() {
    return (
        <section className="pt-32 pb-20 px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="text-center max-w-4xl mx-auto">
            <Badge 
              variant="outline" 
              className="mb-6 border-blue-200 text-blue-700 bg-blue-50/50 px-4 py-1.5"
            >
              <Brain className="w-3.5 h-3.5 mr-1.5" />
              COMPLETE FEATURE SET
            </Badge>
            <h1 className="text-5xl md:text-6xl mb-6 text-gray-900">
              Everything You Need
            </h1>
            <p className="text-xl text-gray-600 mb-10 leading-relaxed">
              Enterprise-grade document signing powered by advanced AI and built for teams of any size. From automation to security, we've got you covered.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/auth/signup">
                <Button size="lg" className="bg-blue-600 hover:bg-blue-700 px-8">
                  Start For Free
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
              <a href="/contact?inquiryType=demo">
                <Button size="lg" variant="outline" className="px-8 border-gray-300">
                  Schedule a Demo
                </Button>
              </a>
            </div>
          </div>
        </div>
      </section>
    );
}