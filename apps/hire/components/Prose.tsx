// A job description as written: blank lines split paragraphs, "- " lines make a list and a short
// line ending in ":" or starting with "## " is a heading. Text only, so nothing typed can run.

type Block = { kind: "p" | "ul" | "h"; lines: string[] };

export function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const last = out[out.length - 1];
    if (!line.trim()) {
      out.push({ kind: "p", lines: [] });
      continue;
    }
    const item = line.match(/^\s*[-*•]\s+(.*)$/);
    if (item) {
      if (last?.kind === "ul") last.lines.push(item[1]);
      else out.push({ kind: "ul", lines: [item[1]] });
      continue;
    }
    const head = line.match(/^#{1,4}\s+(.*)$/) ?? (line.length <= 60 && /:$/.test(line) ? [line, line.slice(0, -1)] : null);
    if (head) {
      out.push({ kind: "h", lines: [head[1]] });
      continue;
    }
    if (last?.kind === "p") last.lines.push(line);
    else out.push({ kind: "p", lines: [line] });
  }
  return out.filter((b) => b.lines.length);
}

export function Prose({ text }: { text: string }) {
  return (
    <div className="prose">
      {blocks(text).map((b, i) =>
        b.kind === "ul" ? (
          <ul key={i}>{b.lines.map((l, j) => <li key={j}>{l}</li>)}</ul>
        ) : b.kind === "h" ? (
          <h4 key={i}>{b.lines[0]}</h4>
        ) : (
          <p key={i}>{b.lines.join("\n")}</p>
        ),
      )}
    </div>
  );
}
