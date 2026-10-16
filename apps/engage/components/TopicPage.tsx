"use client";
import { Feed } from "./Feed";

export function TopicPage({ topic }: { topic: string }) {
  return (
    <div className="column">
      <div className="head"><h1>#{topic}</h1><p className="muted">Posts tagged #{topic}.</p></div>
      <Feed params={{ view: "topic", topic }} empty={<p>No posts with this topic yet.</p>} />
    </div>
  );
}
