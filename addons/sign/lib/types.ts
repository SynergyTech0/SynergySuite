
import { Document, DocumentSigner, DocumentField, User, Template, AuditLog, Notification, SubscriptionTier, UserRole, DocumentStatus, SignerStatus, FieldType } from "@prisma/client";

// Extended types for API responses
export interface DocumentWithRelations extends Document {
  sender: User;
  signers: DocumentSigner[];
  fields: DocumentField[];
  template?: Template;
}

export interface DocumentSignerWithUser extends DocumentSigner {
  user?: User;
}

export interface UserWithSubscription extends User {
  subscription?: {
    tier: SubscriptionTier;
    status: string;
    currentPeriodEnd?: Date;
  };
}

// Form types
export interface CreateDocumentRequest {
  title: string;
  description?: string;
  file: File;
  signers: {
    email: string;
    name: string;
    order?: number;
  }[];
  deadline?: string;
  signingOrder: 'SEQUENTIAL' | 'PARALLEL';
  templateId?: string;
}

export interface AddFieldRequest {
  documentId: string;
  assignedTo: string;
  fieldType: FieldType;
  label: string;
  required: boolean;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  options?: any;
}

export interface SignDocumentRequest {
  documentId: string;
  signerId: string;
  signatures: {
    fieldId: string;
    value: string;
    signatureData?: any;
  }[];
}

// AI types
export interface AIFieldSuggestion {
  fieldType: FieldType;
  label: string;
  confidence: number;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  suggestedAssignee?: string;
}

export interface DocumentAnalysis {
  summary: string;
  suggestedFields: AIFieldSuggestion[];
  documentType: string;
  keyTerms: string[];
}

// Stripe types
export interface StripeSubscriptionData {
  tier: SubscriptionTier;
  priceId: string;
  features: string[];
  price: number;
  interval: 'month' | 'year';
}

export interface Signer {
  email: string;
  name: string;
}

export interface SignersFormProps {
  signers: Signer[];
  onSignersChange: (signers: Signer[]) => void;
  signingOrder?: "PARALLEL" | "SEQUENTIAL";
  onSigningOrderChange?: (order: "PARALLEL" | "SEQUENTIAL") => void;
  title?: string;
  description?: string;
}