import { PublicFooter, PublicHeader } from "@/components/public-chrome";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PublicHeader />
      <main id="main">{children}</main>
      <PublicFooter />
    </>
  );
}
