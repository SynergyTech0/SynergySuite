import { Card } from "@/components/ui/card";
import { Building, Building2, Hospital, Scale, Users } from "lucide-react";

const industries = [
              {
                title: "Healthcare",
                description: "HIPAA-compliant signatures for patient records, consent forms, and medical documents with FHIR/HL7 compatibility",
                icon: Hospital,
              },
              {
                title: "Legal",
                description: "Legally-binding contracts, NDAs, and court documents with complete audit trails and ESIGN/UETA compliance",
                icon: Scale,
              },
              {
                title: "Human Resources",
                description: "Employee onboarding, contracts, policy acknowledgments, and performance reviews with role-based access",
                icon: Users,
              },
              {
                title: "Enterprise",
                description: "Multi-department workflows, vendor agreements, and large-scale contract management with team controls",
                icon: Building,
              },
            ];

export function LandingIndustry() {
    return (
        <section className="py-20 px-6 lg:px-8 bg-gray-50/50">
        <div className="mx-auto max-w-7xl">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl mb-4 text-gray-900">
              Perfect for Every Industry
            </h2>
            <p className="text-lg text-gray-600">
              Trusted by professionals across healthcare, legal, HR, and enterprise
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {industries.map((useCase, index) => (
              <Card key={index} className="p-6 border-gray-200 text-center flex flex-col items-center h-full">
                <div className="text-4xl mb-4"><useCase.icon /></div>
                <h3 className="text-xl mb-3 text-gray-900">{useCase.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{useCase.description}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>
    );
}