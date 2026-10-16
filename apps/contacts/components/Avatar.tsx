"use client";
import { useState } from "react";
import { hue, initials } from "./client";

export function Avatar({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (src && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="avatar" style={style} src={src} alt="" onError={() => setBroken(true)} />;
  }
  const h = hue(name);
  return (
    <span className="avatar" style={{ ...style, background: `hsl(${h} 60% 92%)`, color: `hsl(${h} 55% 32%)` }} aria-hidden>
      {initials(name)}
    </span>
  );
}
