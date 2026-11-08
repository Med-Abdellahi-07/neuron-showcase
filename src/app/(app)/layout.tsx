import Link from "next/link";
import { getProfile, isStaffRole } from "@/lib/auth";
import { getSpace } from "@/lib/spaces";
import { getSpaceOptions } from "@/lib/space-options";
import { MULTI_SPACE, SINGLE_SPACE_NAME } from "@/lib/flags";
import { SpaceSwitcher } from "@/components/space-switcher";
import { getT } from "@/lib/i18n/server";
import { logout } from "@/app/actions/auth";
import { LogoutForm } from "@/components/logout-button";
import { OfflineSync } from "@/components/offline-sync";
import { BottomNav, SideNav } from "@/components/app-nav";
import { Logo } from "@/components/logo";
import { BackButton } from "@/components/back-button";
import { SeenPing } from "@/components/seen-ping";
import { HeaderShell } from "@/components/header-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  const { t } = await getT();

  if (!profile) {
    // Signed-in user without a profile (the admin has not created it yet).
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-5 text-center">
        <Logo />
        <p className="text-sm text-muted">{t("common.error")}</p>
        <LogoutForm action={logout} label={t("profile.logout")} />
      </main>
    );
  }

  const isStaff = isStaffRole(profile.role);
  const space = await getSpace();
  const ai = space?.features.ai === true;
  // Super admin: space list for quick switching.
  const options = MULTI_SPACE && profile.role === "admin" ? await getSpaceOptions() : [];
  const initial = profile.full_name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:shrink-0 md:flex-col md:gap-6 md:p-4">
        <Link href="/" aria-label="Neuron"><Logo /></Link>
        {space && (
          <p className="px-3 text-xs font-semibold text-muted" dir="ltr">{MULTI_SPACE ? space.name : SINGLE_SPACE_NAME}</p>
        )}
        <SideNav isStaff={isStaff} ai={ai} />
      </aside>

      <div className="min-w-0 flex-1 pb-[calc(104px+env(safe-area-inset-bottom))] md:pb-0">
        <HeaderShell>
          <div className="flex items-center gap-2">
            <BackButton variant="dark" />
            <Link href="/" className="md:invisible" aria-label="Neuron"><Logo size={24} /></Link>
          </div>
          <div className="flex items-center gap-2">
            {MULTI_SPACE && profile.role === "admin" && space ? (
              <SpaceSwitcher current={space.id} options={options} />
            ) : space ? (
              <span dir="ltr" className="rounded-[14px] bg-deep-2 px-3 py-2.5 text-xs font-semibold text-white">{MULTI_SPACE ? space.name : SINGLE_SPACE_NAME}</span>
            ) : null}
            <Link
              href="/profile"
              aria-label={t("profile.title")}
              className="press flex size-[42px] items-center justify-center rounded-full bg-gold text-sm font-bold text-deep"
            >
              {initial}
            </Link>
          </div>
        </HeaderShell>
        <main className="mx-auto w-full max-w-3xl p-4 has-[.bleed-page]:max-w-none has-[.bleed-page]:p-0 has-[.wide-page]:max-w-6xl md:p-8 md:has-[.bleed-page]:p-0">{children}</main>
      </div>

      <BottomNav ai={ai} />
      <SeenPing />
      <OfflineSync />
    </div>
  );
}
