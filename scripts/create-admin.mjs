// ينشئ أول حساب مدير (مرة واحدة). يقرأ المفاتيح من .env.local.
// الاستعمال:  node --env-file=.env.local scripts/create-admin.mjs "الاسم الكامل" you@example.com 'كلمة-سر-قوية'
import { createClient } from "@supabase/supabase-js";

const [, , fullName, email, password] = process.argv;
if (!fullName || !email || !password) {
  console.error('الاستعمال: node --env-file=.env.local scripts/create-admin.mjs "الاسم" email password');
  process.exit(1);
}
if (password.length < 8) {
  console.error("كلمة السر يجب ألا تقل عن 8 أحرف");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("اضبط NEXT_PUBLIC_SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY في .env.local");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });

const { data: cohort } = await admin.from("cohorts").select("id").order("created_at").limit(1).maybeSingle();

const { data, error } = await admin.auth.admin.createUser({
  email: email.toLowerCase(),
  password,
  email_confirm: true,
  user_metadata: { full_name: fullName },
});
if (error) {
  console.error("فشل إنشاء المستخدم:", error.message);
  process.exit(1);
}

const { error: pErr } = await admin.from("profiles").insert({
  id: data.user.id,
  full_name: fullName,
  email: email.toLowerCase(),
  role: "admin",
  cohort_id: cohort?.id ?? null,
});
if (pErr) {
  await admin.auth.admin.deleteUser(data.user.id);
  console.error("فشل إنشاء الملف الشخصي:", pErr.message);
  process.exit(1);
}
console.log(`تم إنشاء المدير ${email} ✓`);
