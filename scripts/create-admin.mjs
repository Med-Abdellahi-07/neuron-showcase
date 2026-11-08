// Creates the first admin account (run once). Reads the keys from .env.local.
// Usage:  node --env-file=.env.local scripts/create-admin.mjs "Full Name" you@example.com 'strong-password'
import { createClient } from "@supabase/supabase-js";

const [, , fullName, email, password] = process.argv;
if (!fullName || !email || !password) {
  console.error('Usage: node --env-file=.env.local scripts/create-admin.mjs "Full Name" email password');
  process.exit(1);
}
if (password.length < 8) {
  console.error("The password must be at least 8 characters");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
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
  console.error("Failed to create the user:", error.message);
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
  console.error("Failed to create the profile:", pErr.message);
  process.exit(1);
}
console.log(`Admin ${email} created ✓`);
