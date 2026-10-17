// Server and browser both render contract text with this, so it has no client-only code.

/** Renders the light Markdown a contract is written in: # headings, - lists, **bold**. */
export function ContractText({ body }: { body: string }) {
  if (!body.trim()) return <p className="muted">No text yet.</p>;
  return (
    <div className="doc">
      {body.split(/\n{2,}/).map((block, i) => {
        const t = block.trim();
        const h = t.match(/^(#{1,3})\s+(.*)$/);
        if (h) {
          const Tag = (["h2", "h3", "h4"] as const)[h[1].length - 1];
          return <Tag key={i}>{inline(h[2])}</Tag>;
        }
        if (/^[-*]\s/.test(t)) return <ul key={i}>{t.split("\n").map((l, j) => <li key={j}>{inline(l.replace(/^[-*]\s+/, ""))}</li>)}</ul>;
        return <p key={i}>{t.split("\n").flatMap((l, j) => (j ? [<br key={j} />, inline(l)] : [inline(l)]))}</p>;
      })}
    </div>
  );
}

function inline(s: string): React.ReactNode {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <b key={i}>{part.slice(2, -2)}</b> : part));
}
