import Link from "next/link";
import { getProfile, isStaffRole } from "@/lib/auth";
import { getSpace, SPACE_SELECT, toSpace } from "@/lib/spaces";
import { createClient } from "@/lib/supabase/server";
import { SpaceSwitcher } from "@/components/space-switcher";
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

  const isStaff = isStaffRole(profile.role);
  const space = await getSpace();
  const ai = space?.features.ai === true;
  // المشرف العام: قائمة الفضاءات للتبديل السريع
  let options: { id: string; label: string }[] = [];
  if (profile.role === "admin") {
    const supabase = await createClient();
    const { data } = await supabase.from("cohorts").select(SPACE_SELECT).order("name");
    options = (data ?? []).map((r) => {
      const sp = toSpace(r as never);
      return { id: sp.id, label: sp.name };
    });
  }
  const initial = profile.full_name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:shrink-0 md:flex-col md:gap-6 md:p-4">
        <Link href="/" aria-label="Neuron"><Logo /></Link>
        {space && (
          <p className="px-3 text-xs font-semibold text-muted" dir="ltr">{space.name}</p>
        )}
        <SideNav isStaff={isStaff} ai={ai} />
      </aside>

      <div className="min-w-0 flex-1 pb-28 md:pb-0">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between bg-bg px-4 md:px-8">
          <Link href="/" className="md:invisible" aria-label="Neuron"><Logo size={24} /></Link>
          <div className="flex items-center gap-2">
          {profile.role === "admin" && space ? (
            <SpaceSwitcher current={space.id} options={options} />
          ) : space ? (
            <span dir="ltr" className="rounded-2xl bg-accent-soft px-3 py-2 text-xs font-semibold text-accent">{space.name}</span>
          ) : null}
          <Link
            href="/profile"
            aria-label={t("profile.title")}
            className="press flex size-10 items-center justify-center rounded-2xl bg-surface text-sm font-semibold text-accent shadow-[var(--shadow)]"
          >
            {initial}
          </Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl p-4 has-[.wide-page]:max-w-6xl md:p-8">{children}</main>
      </div>

      <BottomNav ai={ai} />
      <SeenPing />
    </div>
  );
}
