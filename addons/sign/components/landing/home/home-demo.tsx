import { Button } from "@/components/ui/button";
import { ArrowRight, Play } from "lucide-react";

export function LandingDemo({ demoVideoUrl }: { demoVideoUrl: string }) {
  const urlHash = (demoVideoUrl.split("v=")[1] || "").split("&")[0];  
  
  return (
      <section className="py-20 px-6 lg:px-8 bg-gray-50/50">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-4xl md:text-5xl mb-4 text-gray-900">
              See SynergySign in Action
            </h2>
            <p className="text-lg text-gray-600">
              Watch how easy it is to sign documents in under 30 seconds
            </p>
          </div>

          <div className="relative aspect-video rounded-2xl overflow-hidden shadow-2xl">
            <iframe 
            className="w-full h-full"
            src={`https://www.youtube-nocookie.com/embed/${urlHash}?si=Vf-mdllOx_0ca5AO`}
            title="YouTube video player"
            allow="web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen />
          </div>

          <div className="text-center mt-12">
            <Button size="lg" className="bg-blue-600 hover:bg-blue-700 text-white px-8">
              Start Signing Like a Pro
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
            <p className="text-sm text-gray-500 mt-3">
              30 seconds to complete signing. That's faster than your last coffee break.
            </p>
          </div>
        </div>
      </section>
    );
}