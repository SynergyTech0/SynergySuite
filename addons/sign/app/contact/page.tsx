

import { ContactForm } from '@/components/contact/contact-form';

export default function Contact() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 py-12">
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold tracking-tight mb-4">
            Get in Touch
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Have questions about SynergySign? Our team is ready to help you streamline 
            your document signing process.
          </p>
        </div>
        <ContactForm />
      </div>
    </div>
  );
}