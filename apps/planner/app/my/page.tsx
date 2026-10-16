import { MyWork } from "./MyWork";

export const dynamic = "force-dynamic";

// Everything on this page is scoped by the API to boards the caller can see, so the page itself
// needs no guard beyond being signed in — and an empty dashboard is the honest answer for someone
// who is a member of nothing.
export default function MyWorkPage() {
  return <MyWork />;
}
