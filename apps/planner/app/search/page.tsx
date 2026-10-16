import { Search } from "./Search";

export const dynamic = "force-dynamic";

// Cross-board search. Everything it shows comes from /api/search/jql, which scopes results to the
// caller's boards, so this page needs no guard of its own.
export default function SearchPage() {
  return <Search />;
}
