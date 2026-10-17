import { redirect } from "next/navigation";

/** Sign is part of the suite: people go straight to their documents (the gateway has signed them in). */
export default function HomePage() {
  redirect("/dashboard");
}
