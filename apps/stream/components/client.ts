"use client";
// Browser-side helpers shared by the Stream screens.

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

/**
 * Uploads a file as the raw body with progress (fetch can't report upload progress), to
 * POST /api/videos?name=…&origin=…. Resolves with the JSON answer.
 */
export function upload<T>(url: string, file: Blob, onProgress: (fraction: number) => void): { done: Promise<T>; cancel: () => void } {
  const xhr = new XMLHttpRequest();
  const done = new Promise<T>((resolve, reject) => {
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: unknown = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new Error((data as { error?: string }).error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("The upload was interrupted. Check your connection and try again."));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(file);
  });
  return { done, cancel: () => xhr.abort() };
}

export function person(email: string, me?: string): string {
  if (me && email === me) return "You";
  return email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "Today", "Yesterday", "Oct 12" or "Oct 12, 2025". */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString([], d.getFullYear() === now.getFullYear() ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

export function bytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function viewsLabel(n: number): string {
  return n === 1 ? "1 view" : `${n.toLocaleString()} views`;
}
