import { getUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** QCM results completed offline (practice only, no ranking). The real validation is inside the record_offline_scores RPC (0025). */
export async function POST(req: Request) {
  if (!(await getUserId())) return Response.json({ error: "auth" }, { status: 401 });
  let body: { scores?: { clientId: string; lessonId: string; at: number; correct: number; total: number }[] };
  try { body = await req.json(); } catch { return Response.json({ error: "bad" }, { status: 400 }); }
  const list = Array.isArray(body.scores) ? body.scores.slice(0, 100) : [];
  if (!list.length) return Response.json({ saved: [] });
  const payload = list.map((s) => ({
    client_id: s.clientId,
    lesson_id: s.lessonId,
    correct: s.correct,
    total: s.total,
    taken_at: new Date(s.at).toISOString(),
  }));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_offline_scores", { p_scores: payload });
  if (error) return Response.json({ error: "rpc" }, { status: 502 });
  // data = array of client_ids that were handled (accepted or finally rejected), which are removed from the outbox.
  return Response.json({ saved: Array.isArray(data) ? data : list.map((s) => s.clientId) });
}
