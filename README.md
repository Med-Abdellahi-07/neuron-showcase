# Neuron

تطبيق ويب PWA لطلاب الذكاء الاصطناعي (S3/S4) — Next.js + Supabase. المواصفات الكاملة في `neuron-spec.md` (مشروع Claude).

**الحالة:** المرحلة 1 (النواة): الحسابات والأدوار، المواد والحصص والتقدم، التمارين والاستيراد الجماعي، الجدول والعدّاد، لوحة المشرف والموافقة، العربية/الفرنسية، الوضع الداكن.

## الإعداد (مرة واحدة)

1. **قاعدة البيانات:** في Supabase → SQL Editor نفّذ بالترتيب:
   - `supabase/migrations/0001_phase1_core.sql` (الجداول وسياسات RLS ومخزن الملفات ومواد S3 ودفعة افتراضية).
   - `supabase/migrations/0002_grants.sql` (صلاحيات الجداول للأدوار). **ضروري** إذا عطّلتَ «Automatically expose new tables» عند إنشاء المشروع، وإلا يفشل الدخول بخطأ عام. كل ملف migration قادم يتضمن GRANT لجداوله الجديدة لهذا السبب.
2. **المفاتيح:** انسخ `.env.example` إلى `.env.local` وعبّئه (Supabase → Project Settings → API). ضع القيم نفسها في Vercel → Settings → Environment Variables. **لا تُرسل `SUPABASE_SERVICE_ROLE_KEY` لأي شخص ولا في أي دردشة.**
3. **أول مدير:**
   ```bash
   npm install
   node --env-file=.env.local scripts/create-admin.mjs "الاسم الكامل" you@example.com "كلمة-سر-قوية"
   ```
4. **الدخول:** `npm run dev` ثم `http://localhost:3000/login`. من لوحة المشرف ← الحسابات أنشئ المشرفين والطلاب.
5. **استعادة كلمة السر بالبريد:** في Supabase → Authentication → URL Configuration أضف عنوان موقعك في Vercel إلى Redirect URLs (مثل `https://neuron.vercel.app/auth/callback`).
6. **إبقاء Supabase نشطاً:** أضف السرّين `SUPABASE_URL` و`SUPABASE_ANON_KEY` في GitHub → Settings → Secrets → Actions؛ سير العمل `keep-alive.yml` يعمل كل 3 أيام.

## ملاحظات تصميمية

- **الدخول بالهاتف:** الهاتف معرّف فقط بلا SMS؛ يُحوَّل داخلياً إلى بريد `<digits>@phone.neuron.local`. عند الدخول تُطابَق آخر 8 أرقام، فيصح `+222…` أو بدون مفتاح الدولة.
- **النشر:** ما يرفعه المشرف يصبح «بانتظار الموافقة» (trigger في قاعدة البيانات) إلا لمن مُنح «نشر مباشر». الطلاب لا يرون إلا المنشور (RLS).
- **رفع الملفات:** من المتصفح مباشرة إلى Supabase Storage (حد 50MB)، والتحميل بروابط موقّعة لمدة ساعة.
- **المنطقة الزمنية:** يحسب عدّاد الحصص المنجزة حسب `APP_TIMEZONE` (الافتراضي UTC).
- **Next.js 16:** `middleware` صار `src/proxy.ts`، و`cacheComponents` معطّل لأن كل الصفحات خلف تسجيل الدخول.

## البنية

```
src/proxy.ts                 تحديث الجلسة + إعادة التوجيه لصفحة الدخول
src/app/(app)/…              الصفحات المحمية (الرئيسية، المواد، تدرّب، الجدول، الملف، admin)
src/app/actions/…            Server Actions
src/lib/i18n/…               القواميس عربي/فرنسي
supabase/migrations/…        المخطط وسياسات RLS
scripts/create-admin.mjs     إنشاء أول مدير
```

## القادم

المرحلة 2: Arena والترتيب والأخطاء والمراجعة. المرحلة 3: المساعد الذكي (RAG). المرحلة 4: التسجيلات وDuel والإشعارات.
