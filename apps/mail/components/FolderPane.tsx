"use client";
import { Archive, ChevronDown, ChevronRight, FileText, Folder as FolderIcon, Inbox, Plus, Send, ShieldAlert, Trash2, PenSquare, X } from "lucide-react";
import { useState } from "react";
import type { AccountSummary, Folder } from "@/lib/client";

const ROLE_ICON: Record<string, typeof Inbox> = {
  "\\Inbox": Inbox, "\\Sent": Send, "\\Drafts": FileText, "\\Trash": Trash2, "\\Junk": ShieldAlert, "\\Archive": Archive,
};
const ROLE_NAME: Record<string, string> = {
  "\\Sent": "Sent Items", "\\Drafts": "Drafts", "\\Trash": "Deleted Items", "\\Junk": "Junk Email", "\\Archive": "Archive",
};

export function FolderPane(props: {
  accounts: AccountSummary[];
  folders: Record<string, Folder[] | undefined>;
  current: { account: string; folder: string } | null;
  onSelect: (account: string, folder: string) => void;
  onNewMail: () => void;
  /** Left out when outside accounts can't be added (demo mode). */
  onAddAccount?: () => void;
  onRemoveAccount: (a: AccountSummary) => void;
  onNewFolder: (account: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  return (
    <nav className="folders">
      <button className="btn primary newmail" onClick={props.onNewMail}><PenSquare size={16} /> New mail</button>
      {props.accounts.map((a) => (
        <div key={a.id} className="account">
          <div className="accthead">
            <button className="acctname" onClick={() => setCollapsed((c) => ({ ...c, [a.id]: !c[a.id] }))} title={a.address}
              aria-expanded={!collapsed[a.id]}>
              {collapsed[a.id] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <span>{a.kind === "suite" ? a.address : a.label}</span>
            </button>
            <button className="iconbtn small" title="New folder" onClick={() => props.onNewFolder(a.id)}><Plus size={14} /></button>
            {a.kind === "imap" && (
              <button className="iconbtn small" title="Remove account" onClick={() => props.onRemoveAccount(a)}><X size={14} /></button>
            )}
          </div>
          {!collapsed[a.id] && (
            <ul>
              {(props.folders[a.id] ?? []).map((f) => {
                const Icon = (f.role && ROLE_ICON[f.role]) || FolderIcon;
                const active = props.current?.account === a.id && props.current.folder === f.path;
                return (
                  <li key={f.path}>
                    <button className={`folder${active ? " active" : ""}`} style={{ paddingLeft: 14 + f.depth * 14 }}
                      onClick={() => props.onSelect(a.id, f.path)}>
                      <Icon size={15} />
                      <span className="fname">{(f.role && ROLE_NAME[f.role]) || f.name}</span>
                      {f.unread > 0 && f.role !== "\\Sent" && f.role !== "\\Drafts" && <span className="count">{f.unread}</span>}
                    </button>
                  </li>
                );
              })}
              {props.folders[a.id] === undefined && <li className="muted pad">Loading…</li>}
            </ul>
          )}
        </div>
      ))}
      {props.onAddAccount && (
        <button className="btn ghost addacct" onClick={props.onAddAccount}><Plus size={15} /> Add account</button>
      )}
    </nav>
  );
}
