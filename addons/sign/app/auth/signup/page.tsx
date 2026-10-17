import { redirect } from "next/navigation";

/** Sign signs people in with their suite account; old links to its own sign-in land there. */
export default function Page() {
  redirect("/signin?rd=/dashboard");
}
