"use client";
import { useEffect, useState } from "react";
import { api } from "./client";
import { Modal } from "./Modal";

type Channel = { id: number; name: string; url: string };

/** Posts a link to the post into one of the viewer's Chat channels. */
export function ShareToChat({ postId, onClose, say }: { postId: string; onClose: () => void; say: (t: string) => void }) {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [channel, setChannel] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ channels: Channel[]; available: boolean }>("/api/chat/channels").then(
      (r) => {
        setChannels(r.channels);
        setAvailable(r.available);
        if (r.channels[0]) setChannel(String(r.channels[0].id));
      },
      () => setAvailable(false),
    );
  }, []);

  return (
    <Modal title="Share to Chat" onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(`/api/posts/${postId}/share`, { method: "POST", json: { channelId: Number(channel), note } });
          say("Shared to Chat");
          onClose();
        } catch (x) {
          setError((x as Error).message);
        }
      }}>
        {!available ? (
          <p className="muted">Chat can&apos;t be reached right now.</p>
        ) : channels === null ? (
          <p className="muted">Loading your channels…</p>
        ) : channels.length === 0 ? (
          <p className="muted">You&apos;re not in any Chat channels yet.</p>
        ) : (
          <>
            <label>
              <span>Channel</span>
              <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                {channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
            </label>
            <label>
              <span>Add a note (optional)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </>
        )}
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!channel}>Share</button>
        </div>
      </form>
    </Modal>
  );
}
