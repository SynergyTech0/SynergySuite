declare module "html-to-docx" {
  const HTMLtoDOCX: (
    html: string,
    headerHTML?: string | null,
    options?: Record<string, unknown>,
    footerHTML?: string | null,
  ) => Promise<Buffer | ArrayBuffer | Blob>;
  export default HTMLtoDOCX;
}
