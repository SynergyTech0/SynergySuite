import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Editor } from "@/components/Editor";
import { editorAiSettings } from "@/lib/ai";
import { currentUser } from "@/lib/api";

export const dynamic = "force-dynamic";

/** What the page tells draw.io in its configure message (https://www.drawio.com/doc/faq/configure-diagram-editor). */
function editorConfig(): Record<string, unknown> {
  return {
    // The shape libraries open in the left panel, much like Visio's basic stencils.
    defaultLibraries: "general;basic;arrows2;flowchart;uml;er;bpmn;network",
    defaultFonts: ["Segoe UI", "Helvetica", "Verdana", "Times New Roman", "Garamond", "Courier New"],
    ...editorAiSettings(),
  };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  const { id } = await params;
  return (
    <Suspense>
      <Editor id={id} me={me.email} editorConfig={editorConfig()} />
    </Suspense>
  );
}
