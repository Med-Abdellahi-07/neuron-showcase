import { Logo } from "@/components/logo";
import { LangSwitch } from "@/components/lang-switch";
import { getT } from "@/lib/i18n/server";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const { t } = await getT();
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-5 py-10">
      <div className="flex items-center justify-between">
        <Logo />
        <LangSwitch />
      </div>
      <div>
        <h1 className="page-title !mb-1">{t("login.title")}</h1>
        <p className="text-sm text-muted">{t("login.subtitle")}</p>
      </div>
      <LoginForm />
    </main>
  );
}
