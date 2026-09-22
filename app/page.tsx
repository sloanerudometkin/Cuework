import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LandingPage } from "@/components/landing";

export default async function Home() {
  if (await getSession()) redirect("/overview");
  return <LandingPage />;
}
