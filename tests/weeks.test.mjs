// تشغيل: npm test  (node --test، بلا مكتبات)
import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays, dateInZone, defaultWeekMonday, formatWeekRange, isStudyDay, isoWeekday, mondayOf, studyDateFrom, weekNumber,
} from "../src/lib/weeks.ts";

const START = "2026-10-12"; // بداية S3 (الإثنين)

test("أيام الأسبوع لأسبوع 12–18 أكتوبر 2026 (الإثنين..الأحد)", () => {
  const days = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"];
  assert.deepEqual(days.map(isoWeekday), [1, 2, 3, 4, 5, 6, 7]);
});

test("الأسبوع الافتراضي: الإثنين–السبت = الأسبوع الحالي (12 أكتوبر)", () => {
  for (const d of ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]) {
    assert.equal(defaultWeekMonday(d), "2026-10-12", d);
  }
});

test("الأسبوع الافتراضي: الأحد = الأسبوع القادم (18 أكتوبر ← 19 أكتوبر)", () => {
  assert.equal(defaultWeekMonday("2026-10-18"), "2026-10-19");
  assert.equal(defaultWeekMonday("2026-10-25"), "2026-10-26");
});

test("أول يوم دراسة: الأحد ← الإثنين، غيره ← اليوم نفسه", () => {
  assert.equal(studyDateFrom("2026-10-18"), "2026-10-19");
  assert.equal(studyDateFrom("2026-10-17"), "2026-10-17");
  assert.equal(studyDateFrom("2026-10-12"), "2026-10-12");
});

test("حصة غداً: مساء السبت لا يُرسل (الغد أحد)، مساء الأحد يُرسل (الغد إثنين)", () => {
  const sat = "2026-10-17", sun = "2026-10-18", fri = "2026-10-16";
  assert.equal(isStudyDay(addDays(sat, 1)), false);
  assert.equal(isStudyDay(addDays(sun, 1)), true);
  assert.equal(isStudyDay(addDays(fri, 1)), true);
});

test("ترقيم الأسابيع: 12 أكتوبر = 1، 19 = 2، 17 (سبت الأسبوع 1) = 1", () => {
  assert.equal(weekNumber("2026-10-12", START), 1);
  assert.equal(weekNumber(mondayOf("2026-10-17"), START), 1);
  assert.equal(weekNumber("2026-10-19", START), 2);
  assert.equal(weekNumber("2026-10-26", START), 3);
  assert.equal(weekNumber("2027-01-04", START), 13);
});

test("الأحد 18 أكتوبر يعرض الأسبوع رقم 2", () => {
  assert.equal(weekNumber(defaultWeekMonday("2026-10-18"), START), 2);
});

test("قبل بداية السداسي أو بلا تاريخ: لا رقم", () => {
  assert.equal(weekNumber("2026-10-05", START), null);
  assert.equal(weekNumber("2026-10-12", null), null);
  assert.equal(weekNumber("2026-10-12", undefined), null);
  assert.equal(weekNumber("2026-10-12", ""), null);
});

test("بداية السداسي في منتصف الأسبوع: الأسبوع 1 هو الذي يحتويها", () => {
  assert.equal(weekNumber("2026-10-12", "2026-10-14"), 1);
  assert.equal(weekNumber("2026-10-19", "2026-10-14"), 2);
});

test("اليوم بتوقيت APP_TIMEZONE لا UTC: منتصف الليل في هونولولو (UTC-10)", () => {
  const tz = "Pacific/Honolulu";
  // 23:59:59 السبت 17 أكتوبر في هونولولو = 09:59:59 UTC الأحد 18
  const satNight = new Date("2026-10-18T09:59:59Z");
  const sunMidnight = new Date("2026-10-18T10:00:00Z");
  assert.equal(dateInZone(satNight, tz), "2026-10-17");
  assert.equal(dateInZone(sunMidnight, tz), "2026-10-18");
  assert.equal(defaultWeekMonday(dateInZone(satNight, tz)), "2026-10-12");
  assert.equal(defaultWeekMonday(dateInZone(sunMidnight, tz)), "2026-10-19");
  // بتوقيت UTC نفسه اللحظتان في «الأحد» — وهذا هو الخطأ الذي نتفاداه
  assert.equal(dateInZone(satNight, "UTC"), "2026-10-18");
});

test("منتصف الليل شرقاً (طوكيو UTC+9) ونواكشوط (UTC+0)", () => {
  const before = new Date("2026-10-17T14:59:59Z"); // 23:59:59 السبت في طوكيو
  const after = new Date("2026-10-17T15:00:00Z"); // 00:00 الأحد في طوكيو
  assert.equal(defaultWeekMonday(dateInZone(before, "Asia/Tokyo")), "2026-10-12");
  assert.equal(defaultWeekMonday(dateInZone(after, "Asia/Tokyo")), "2026-10-19");
  assert.equal(dateInZone(new Date("2026-10-18T00:00:00Z"), "Africa/Nouakchott"), "2026-10-18");
});

test("الإثنين 00:00 يبدأ أسبوعاً جديداً بتوقيت المنطقة", () => {
  const tz = "Pacific/Honolulu";
  const monNight = new Date("2026-10-19T09:59:59Z"); // الأحد 23:59:59 في هونولولو
  const monStart = new Date("2026-10-19T10:00:00Z"); // الإثنين 00:00
  assert.equal(defaultWeekMonday(dateInZone(monNight, tz)), "2026-10-19");
  assert.equal(defaultWeekMonday(dateInZone(monStart, tz)), "2026-10-19");
  assert.equal(weekNumber(defaultWeekMonday(dateInZone(monStart, tz)), START), 2);
});

test("تنسيق مدى الأسبوع بالثلاث لغات", () => {
  assert.equal(formatWeekRange("2026-10-19", "ar"), "19–24 أكتوبر");
  assert.equal(formatWeekRange("2026-10-19", "fr"), "19–24 oct.");
  assert.equal(formatWeekRange("2026-10-19", "en"), "Oct 19–24");
});

test("مدى الأسبوع عبر شهرين", () => {
  assert.equal(formatWeekRange("2026-10-26", "fr"), "26–31 oct."); // نفس الشهر
  assert.equal(formatWeekRange("2026-10-28", "en"), "Oct 28–Nov 2");
  assert.equal(formatWeekRange("2026-10-28", "fr"), "28 oct.–2 nov.");
  assert.equal(formatWeekRange("2026-10-28", "ar"), "28 أكتوبر–2 نوفمبر");
});
