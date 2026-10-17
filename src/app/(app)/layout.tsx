import Link from "next/link";
import { getProfile } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { logout } from "@/app/actions/auth";
import { BottomNav, SideNav } from "@/components/app-nav";
import { Logo } from "@/components/logo";
import { SeenPing } from "@/components/seen-ping";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  const { t } = await getT();

  if (!profile) {
    // مستخدم مسجّل دخوله لكن بلا ملف شخصي (لم يُنشئه المدير)
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-5 text-center">
        <Logo />
        <p className="text-sm text-muted">{t("common.error")}</p>
        <form action={logout}>
          <button className="btn w-full">{t("profile.logout")}</button>
        </form>
      </main>
    );
  }

  const isStaff = profile.role === "moderator" || profile.role === "admin";
  const initial = profile.full_name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:shrink-0 md:flex-col md:gap-6 md:border-e md:border-border md:p-4">
        <Link href="/" aria-label="Neuron"><Logo /></Link>
        <SideNav isStaff={isStaff} />
      </aside>

      <div className="min-w-0 flex-1 pb-20 md:pb-0">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-bg/90 px-4 backdrop-blur md:px-8">
          <Link href="/" className="md:invisible" aria-label="Neuron"><Logo size={24} /></Link>
          <Link
            href="/profile"
            aria-label={t("profile.title")}
            className="tech flex size-9 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent"
          >
            {initial}
          </Link>
        </header>
        <main className="mx-auto w-full max-w-3xl p-4 has-[.wide-page]:max-w-6xl md:p-8">{children}</main>
      </div>

      <BottomNav />
      <SeenPing />
    </div>
  );
}
