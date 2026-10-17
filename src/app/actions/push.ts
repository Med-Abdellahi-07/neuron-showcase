"use server";

import webpush from "web-push";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";
import { getUserId } from "@/lib/auth";
import { PUSH_KINDS, pushConfigured, sendPush, type PushKind } from "@/lib/push";

export interface SubInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

const okSub = (s: SubInput) =>
  typeof s?.endpoint === "string" && s.endpoint.startsWith("https://") && s.endpoint.length <= 1000 &&
  typeof s.p256dh === "string" && s.p256dh.length > 20 && s.p256dh.length <= 200 &&
  typeof s.auth === "string" && s.auth.length > 8 && s.auth.length <= 100;

/** حفظ اشتراك هذا الجهاز. نستعمل service role لأن endpoint فريد وقد يكون مسجّلاً سابقاً باسم مستخدم آخر على الجهاز نفسه. */
export async function savePushSubscription(sub: SubInput, userAgent: string): Promise<{ ok: boolean }> {
  const userId = await getUserId();
  if (!userId || !okSub(sub)) return { ok: false };
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("push_subscriptions")
      .upsert({ user_id: userId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, user_agent: userAgent.slice(0, 200) }, { onConflict: "endpoint" });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

export async function removePushSubscription(endpoint: string): Promise<{ ok: boolean }> {
  const userId = await getUserId();
  if (!userId || typeof endpoint !== "string") return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  return { ok: !error };
}

export async function savePushPrefs(prefs: Record<string, boolean>): Promise<{ ok: boolean }> {
  const userId = await getUserId();
  if (!userId) return { ok: false };
  const row: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
  for (const k of PUSH_KINDS) if (typeof prefs[k] === "boolean") row[k] = prefs[k];
  const supabase = await createClient();
  const { error } = await supabase.from("notification_prefs").upsert(row);
  return { ok: !error };
}

/** إشعار تجريبي للمستخدم نفسه (يتجاوز تفضيل النوع ليتحقق من الجهاز). */
export async function sendTestPush(): Promise<{ ok: boolean; reason?: "not_configured" | "no_device" | "failed" }> {
  const userId = await getUserId();
  if (!userId) return { ok: false, reason: "failed" };
  if (!pushConfigured()) return { ok: false, reason: "not_configured" };
  const r = await sendPush({ userIds: [userId] }, "announcement", {
    ar: { title: "Neuron ✓", body: "الإشعارات تعمل على هذا الجهاز." },
    fr: { title: "Neuron ✓", body: "Les notifications fonctionnent sur cet appareil." },
    url: "/profile",
    tag: "test",
  });
  if (r.sent > 0) return { ok: true };
  return { ok: false, reason: r.recipients === 0 ? "no_device" : "failed" };
}

/** المدير: يولّد مفاتيح VAPID على الخادم (بلا طرفية). المفتاح الخاص يُعرض مرة واحدة ولا يُخزَّن. */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  await requireAdmin();
  return webpush.generateVAPIDKeys();
}

export type { PushKind };
