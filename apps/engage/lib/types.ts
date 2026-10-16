export type Privacy = "public" | "private";
export type Role = "admin" | "member";
export type PostKind = "discussion" | "question" | "praise" | "poll" | "article";
export type FeedView = "home" | "discover" | "community" | "person" | "topic" | "mentions" | "saved" | "questions";

export const KINDS: PostKind[] = ["discussion", "question", "praise", "poll", "article"];
export const VIEWS: FeedView[] = ["home", "discover", "community", "person", "topic", "mentions", "saved", "questions"];
export const REACTIONS = ["like", "love", "celebrate", "insightful", "laugh", "sad"] as const;
export type Reaction = (typeof REACTIONS)[number];
export const COLORS = ["blue", "green", "red", "orange", "purple", "teal", "pink", "gray"] as const;

/** Praise badges, in the order the picker shows them. */
export const BADGES: Record<string, string> = {
  "thank-you": "Thank you",
  "great-job": "Great job",
  "team-player": "Team player",
  "above-and-beyond": "Above and beyond",
  "problem-solver": "Problem solver",
  creative: "Creative",
  leader: "Leader",
  welcome: "Welcome",
};

/** The community everyone joins on their first visit. */
export const ALL_COMPANY = "all-company";

export type Person = {
  email: string;
  name: string;
  title: string;
  department: string;
  about: string;
  followers: number;
  following: number;
  /** Whether the viewer follows them. */
  followed: boolean;
  communities: number;
  posts: number;
};

export type PersonRef = { email: string; name: string };

export type Community = {
  id: string;
  slug: string;
  name: string;
  description: string;
  privacy: Privacy;
  color: string;
  official: boolean;
  chatUrl: string;
  chatName: string;
  siteUrl: string;
  createdBy: string;
  createdAt: string;
  members: number;
  posts: number;
  lastActivity: string | null;
  /** The viewer's place in it; null when they have not joined. */
  myRole: Role | null;
  /** Whether the viewer can moderate it: its admins and the company's. */
  canManage: boolean;
};

export type CommunityRef = { id: string; slug: string; name: string; color: string; privacy: Privacy };

export type Comment = {
  id: string;
  postId: string;
  parentId: string | null;
  author: PersonRef;
  body: string;
  mentions: PersonRef[];
  createdAt: string;
  editedAt: string | null;
  reactions: Partial<Record<Reaction, number>>;
  myReaction: Reaction | null;
  canEdit: boolean;
  canDelete: boolean;
};

export type Poll = { options: { id: string; label: string; votes: number }[]; myVote: string | null; total: number };

export type Post = {
  id: string;
  community: CommunityRef | null;
  author: PersonRef;
  kind: PostKind;
  title: string;
  body: string;
  topics: string[];
  mentions: PersonRef[];
  praised: PersonRef[];
  badge: string | null;
  announcement: boolean;
  pinned: boolean;
  bestAnswer: string | null;
  createdAt: string;
  editedAt: string | null;
  activityAt: string;
  reactions: Partial<Record<Reaction, number>>;
  myReaction: Reaction | null;
  commentCount: number;
  /** In a feed, the latest two; on the post's own page, all of them, oldest first. */
  comments: Comment[];
  poll: Poll | null;
  saved: boolean;
  can: { edit: boolean; delete: boolean; moderate: boolean; markAnswer: boolean };
};

export type FeedPage = { posts: Post[]; next: string | null };

export type QuickLink = { id: string; label: string; url: string; position: number };

export type Home = {
  me: PersonRef & { admin: boolean };
  company: string;
  news: Post[];
  quickLinks: QuickLink[];
  communities: Community[];
  suggested: Community[];
  topics: { topic: string; posts: number }[];
  people: PersonRef[];
};
