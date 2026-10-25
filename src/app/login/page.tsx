import { cookies } from "next/headers";
import { LangSwitch } from "@/components/lang-switch";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { SPACE_COOKIE, type Directory } from "@/lib/spaces";
import { LoginShell } from "./login-shell";
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
    <LoginShell lang={<LangSwitch />} title={t("login.title")} subtitle={t("login.subtitle")}>
      {directory && directory.institutions.length > 0 ? <SpaceLogin directory={directory} initialSpaceId={remembered} /> : <LoginForm />}
    </LoginShell>
  );
}
