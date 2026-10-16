// types/react-pdf.d.ts
declare module "react-pdf" {
  import * as React from "react";

  export interface DocumentProps {
    file?: string | File | null;
    onLoadSuccess?: (pdf: { numPages: number }) => void;
    onLoadError?: (error: Error) => void;
    children?: React.ReactNode;
  }

  export interface PageProps {
    pageNumber?: number;
    scale?: number;
    renderTextLayer?: boolean;
    renderAnnotationLayer?: boolean;
  }

  export const Document: React.FC<DocumentProps>;
  export const Page: React.FC<PageProps>;
  export const pdfjs: {
    GlobalWorkerOptions: {
      workerSrc: string;
    };
  };
}
