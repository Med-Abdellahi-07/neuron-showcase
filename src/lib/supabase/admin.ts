import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";

/**
 * عميل بصلاحية service role — يتجاوز RLS. للاستخدام داخل Server Actions
 * بعد التحقق من أن المستدعي مدير. لا يُستورد أبداً من مكوّن عميل.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY غير مضبوط");
  return createClient(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
