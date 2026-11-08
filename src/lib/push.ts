import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

/** Notification types (match the notification_prefs columns). */
export type PushKind = "lesson_tomorrow" | "schedule_change" | "new_content" | "duel" | "review" | "announcement";
export const PUSH_KINDS: PushKind[] = ["lesson_tomorrow", "schedule_change", "new_content", "duel", "review", "announcement"];

export interface PushText {
  title: string;
  body: string;
}
export interface PushMessage {
  ar: PushText;
  fr: PushText;
  en: PushText;
  /** In-app path opened on click. */
  url?: string;
  /** Notifications with the same tag replace each other. */
  tag?: string;
}
export interface PushTarget {
  userIds?: string[];
  cohortId?: string;
  excludeUserId?: string;
}
export interface PushResult {
  sent: number;
  failed: number;
  removed: number;
  recipients: number;
}

const vapidPublic = () => process.env.VAPID_PUBLIC_KEY?.trim() ?? "";
export const vapidPublicKey = vapidPublic;
export const pushConfigured = () =>
  !!(vapidPublic() && process.env.VAPID_PRIVATE_KEY?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY);

let configured = false;
function configure() {
  if (configured) return;
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:admin@neuron.invalid";
  webpush.setVapidDetails(subject, vapidPublic(), process.env.VAPID_PRIVATE_KEY!.trim());
  configured = true;
}

const EMPTY: PushResult = { sent: 0, failed: 0, removed: 0, recipients: 0 };

/**
 * Sends a notification to a group of users while honouring their preferences. Never throws: a notification failure must not fail the admin's operation.
 * Devices whose subscription has expired (404/410) are deleted automatically.
 */
export async function sendPush(target: PushTarget, kind: PushKind, msg: PushMessage): Promise<PushResult> {
  try {
    if (!pushConfigured()) return EMPTY;
    configure();
    const admin = createAdminClient();

    let ids = target.userIds ?? [];
    if (target.cohortId) {
      const { data } = await admin.from("profiles").select("id").eq("cohort_id", target.cohortId);
      ids = [...new Set([...ids, ...(data ?? []).map((r) => r.id as string)])];
    }
    if (target.excludeUserId) ids = ids.filter((i) => i !== target.excludeUserId);
    if (!ids.length) return EMPTY;

    const [{ data: prefs }, { data: profs }, { data: subs }] = await Promise.all([
      admin.from("notification_prefs").select(`user_id, ${kind}`).in("user_id", ids),
      admin.from("profiles").select("id, locale").in("id", ids),
      admin.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth").in("user_id", ids),
    ]);
    const off = new Set((prefs ?? []).filter((p) => (p as unknown as Record<string, unknown>)[kind] === false).map((p) => (p as unknown as { user_id: string }).user_id));
    const locale = new Map((profs ?? []).map((p) => [p.id as string, p.locale === "fr" ? "fr" : p.locale === "en" ? "en" : "ar"] as const));
    const list = (subs ?? []).filter((s) => !off.has(s.user_id as string));
    const recipients = new Set(list.map((s) => s.user_id as string)).size;

    const res: PushResult = { sent: 0, failed: 0, removed: 0, recipients };
    const dead: string[] = [];
    for (let i = 0; i < list.length; i += 10) {
      await Promise.all(
        list.slice(i, i + 10).map(async (s) => {
          const text = msg[locale.get(s.user_id as string) ?? "ar"];
          const payload = JSON.stringify({ title: text.title, body: text.body, url: msg.url ?? "/", tag: msg.tag });
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint as string, keys: { p256dh: s.p256dh as string, auth: s.auth as string } },
              payload,
              { TTL: 60 * 60 * 24, urgency: "normal" }
            );
            res.sent += 1;
          } catch (e) {
            const code = (e as { statusCode?: number }).statusCode;
            if (code === 404 || code === 410) dead.push(s.id as string);
            else console.error("push failed:", code, (e as Error).message);
            res.failed += 1;
          }
        })
      );
    }
    if (dead.length) {
      await admin.from("push_subscriptions").delete().in("id", dead);
      res.removed = dead.length;
    }
    return res;
  } catch (e) {
    console.error("sendPush error:", (e as Error).message);
    return EMPTY;
  }
}
