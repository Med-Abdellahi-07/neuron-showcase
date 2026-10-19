import { cookies } from "next/headers";
import { Logo } from "@/components/logo";
import { LangSwitch } from "@/components/lang-switch";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { SPACE_COOKIE, type Directory } from "@/lib/spaces";
import { LoginForm } from "./login-form";
import { SpaceLogin } from "./space-login";

export default async function LoginPage() {
  const { t } = await getT();
  const supabase = await createClient();
  // دليل المؤسسات/التخصصات/المستويات عام (بلا بيانات خاصة) ويُقرأ بصلاحية الزائر
  const { data, error } = await supabase.rpc("public_directory");
  if (error) console.error("public_directory failed:", error.code, error.message);
  const directory = !error && data ? (data as unknown as Directory) : null;
  const remembered = (await cookies()).get(SPACE_COOKIE)?.value ?? null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-5 py-10">
      <div className="flex items-center justify-between">
        <Logo />
        <LangSwitch />
      </div>
      <div>
        <h1 className="page-title !mb-1">{t("login.title")}</h1>
        <p className="text-sm text-muted">{t("login.subtitle")}</p>
      </div>
      {directory && directory.institutions.length > 0 ? <SpaceLogin directory={directory} initialSpaceId={remembered} /> : <LoginForm />}
    </main>
  );
}
