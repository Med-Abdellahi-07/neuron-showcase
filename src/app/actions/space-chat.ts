"use server";

import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/auth";

const KNOWN = ["muted", "rate_limited", "bad_body", "feature_disabled", "forbidden", "bad_target"];
const code = (m?: string) => KNOWN.find((k) => m?.includes(k)) ?? "failed";

export async function sendSpaceMessage(body: string, replyTo: number | null): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await getUserId())) return { ok: false, error: "auth" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("space_chat_send", { p_body: String(body ?? "").slice(0, 1000), p_reply: replyTo });
  if (error) {
    if (code(error.message) === "failed") console.error("space_chat_send failed:", error.message);
    return { ok: false, error: code(error.message) };
  }
  return { ok: true };
}

export async function deleteSpaceMessage(id: number): Promise<boolean> {
  if (!(await getUserId()) || !Number.isFinite(id)) return false;
  const supabase = await createClient();
  const { data } = await supabase.rpc("space_chat_delete", { p_id: id });
  return data === true;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function muteSpaceMember(userId: string, hours: number): Promise<{ ok: boolean; error?: string }> {
  if (!(await getUserId()) || !UUID_RE.test(userId)) return { ok: false, error: "failed" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("space_chat_mute", { p_user: userId, p_hours: Math.max(0, Math.min(720, Math.floor(hours))) });
  return error ? { ok: false, error: code(error.message) } : { ok: true };
}
