import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Create your workspace" };

export default function SignUpPage() {
  return (
    <div className="animate-rise">
      <h1 className="text-[1.75rem]">Create your workspace</h1>
      <p className="mb-7 mt-2 text-soft">Add your brands, import your data, and get your first prioritised recommendations.</p>
      <SignUpForm />
    </div>
  );
}
