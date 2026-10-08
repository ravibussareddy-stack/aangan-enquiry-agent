import { redirect } from "next/navigation";

// Live, per-request data (session + database).
export const instant = false;

export default function Home() {
  redirect("/dashboard");
}
