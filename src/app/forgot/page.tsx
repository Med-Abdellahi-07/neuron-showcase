import Link from "next/link";
import { Logo } from "@/components/logo";
import { getT } from "@/lib/i18n/server";
import { ForgotForm } from "./forgot-form";

export default async function ForgotPage() {
  const { t } = await getT();
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-5 py-10">
      <Logo />
      <div>
        <h1 className="page-title !mb-1">{t("forgot.title")}</h1>
        <p className="text-sm text-muted">{t("forgot.hint")}</p>
      </div>
      <ForgotForm />
      <p className="text-xs text-muted">{t("forgot.phoneNote")}</p>
      <Link href="/login" className="text-sm text-accent hover:underline">{t("common.back")}</Link>
    </main>
  );
}
