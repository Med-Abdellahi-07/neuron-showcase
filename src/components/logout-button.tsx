"use client";

import { wipeAll } from "@/lib/offline/db";

/** الخروج: يمسح بيانات الجهاز (جدول، دروس محفوظة، نتائج) قبل إرسال النموذج. */
export function LogoutForm({ action, label }: { action: () => void | Promise<void>; label: string }) {
  return (
    <form
      action={action}
      onSubmit={async (e) => {
        const form = e.currentTarget;
        if (form.dataset.wiped) return;
        e.preventDefault();
        await Promise.race([wipeAll().catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
        form.dataset.wiped = "1";
        form.requestSubmit();
      }}
    >
      <button className="btn btn-danger w-full">{label}</button>
    </form>
  );
}
