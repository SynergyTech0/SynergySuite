/**
 * The small Markdown subset Copilot answers in (headings, paragraphs, bullets, numbered and
 * checklist items, bold and italic) to the HTML the page editor inserts. Everything is escaped
 * first, so the answer can't add markup of its own.
 */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(s: string): string {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>")
    .replace(/(^|[\s(])\*([^*]+)\*(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
}

export function markdownToHtml(md: string): string {
  const out: string[] = [];
  let list: "ul" | "ol" | "task" | null = null;
  const close = () => {
    if (list) out.push(list === "ol" ? "</ol>" : "</ul>");
    list = null;
  };
  const open = (kind: "ul" | "ol" | "task") => {
    if (list === kind) return;
    close();
    out.push(kind === "ol" ? "<ol>" : kind === "task" ? '<ul data-type="taskList">' : "<ul>");
    list = kind;
  };
  for (const raw of md.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if (!line.trim()) {
      close();
    } else if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      close();
      const level = Math.min(m[1].length + 1, 3);
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if ((m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/))) {
      open("task");
      out.push(`<li data-type="taskItem" data-checked="${m[1] === " " ? "false" : "true"}"><p>${inline(m[2])}</p></li>`);
    } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
      open("ul");
      out.push(`<li><p>${inline(m[1])}</p></li>`);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      open("ol");
      out.push(`<li><p>${inline(m[1])}</p></li>`);
    } else {
      close();
      out.push(`<p>${inline(line.trim())}</p>`);
    }
  }
  close();
  return out.join("");
}
