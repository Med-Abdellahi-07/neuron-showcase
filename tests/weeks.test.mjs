// Run: npm test  (node --test, no libraries)
import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays, dateInZone, defaultWeekMonday, formatWeekRange, isStudyDay, isoWeekday, mondayOf, studyDateFrom, weekNumber,
} from "../src/lib/weeks.ts";

const START = "2026-10-12"; // S3 start (Monday)

test("weekdays for the week of 12-18 October 2026 (Monday..Sunday)", () => {
  const days = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"];
  assert.deepEqual(days.map(isoWeekday), [1, 2, 3, 4, 5, 6, 7]);
});

test("default week: Monday-Saturday = the current week (12 October)", () => {
  for (const d of ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]) {
    assert.equal(defaultWeekMonday(d), "2026-10-12", d);
  }
});

test("default week: Sunday = next week (18 October -> 19 October)", () => {
  assert.equal(defaultWeekMonday("2026-10-18"), "2026-10-19");
  assert.equal(defaultWeekMonday("2026-10-25"), "2026-10-26");
});

test("first study day: Sunday -> Monday, otherwise the same day", () => {
  assert.equal(studyDateFrom("2026-10-18"), "2026-10-19");
  assert.equal(studyDateFrom("2026-10-17"), "2026-10-17");
  assert.equal(studyDateFrom("2026-10-12"), "2026-10-12");
});

test("session tomorrow: Saturday evening is not sent (tomorrow is Sunday), Sunday evening is sent (tomorrow is Monday)", () => {
  const sat = "2026-10-17", sun = "2026-10-18", fri = "2026-10-16";
  assert.equal(isStudyDay(addDays(sat, 1)), false);
  assert.equal(isStudyDay(addDays(sun, 1)), true);
  assert.equal(isStudyDay(addDays(fri, 1)), true);
});

test("week numbering: 12 October = 1, 19 = 2, 17 (Saturday of week 1) = 1", () => {
  assert.equal(weekNumber("2026-10-12", START), 1);
  assert.equal(weekNumber(mondayOf("2026-10-17"), START), 1);
  assert.equal(weekNumber("2026-10-19", START), 2);
  assert.equal(weekNumber("2026-10-26", START), 3);
  assert.equal(weekNumber("2027-01-04", START), 13);
});

test("Sunday 18 October shows week number 2", () => {
  assert.equal(weekNumber(defaultWeekMonday("2026-10-18"), START), 2);
});

test("before the semester starts or with no date: no number", () => {
  assert.equal(weekNumber("2026-10-05", START), null);
  assert.equal(weekNumber("2026-10-12", null), null);
  assert.equal(weekNumber("2026-10-12", undefined), null);
  assert.equal(weekNumber("2026-10-12", ""), null);
});

test("semester starts mid-week: week 1 is the one that contains it", () => {
  assert.equal(weekNumber("2026-10-12", "2026-10-14"), 1);
  assert.equal(weekNumber("2026-10-19", "2026-10-14"), 2);
});

test("today in APP_TIMEZONE, not UTC: midnight in Honolulu (UTC-10)", () => {
  const tz = "Pacific/Honolulu";
  // 23:59:59 Saturday 17 October in Honolulu = 09:59:59 UTC Sunday 18
  const satNight = new Date("2026-10-18T09:59:59Z");
  const sunMidnight = new Date("2026-10-18T10:00:00Z");
  assert.equal(dateInZone(satNight, tz), "2026-10-17");
  assert.equal(dateInZone(sunMidnight, tz), "2026-10-18");
  assert.equal(defaultWeekMonday(dateInZone(satNight, tz)), "2026-10-12");
  assert.equal(defaultWeekMonday(dateInZone(sunMidnight, tz)), "2026-10-19");
  // In UTC itself both instants fall on "Sunday" - the bug we are avoiding
  assert.equal(dateInZone(satNight, "UTC"), "2026-10-18");
});

test("midnight to the east (Tokyo UTC+9) and Nouakchott (UTC+0)", () => {
  const before = new Date("2026-10-17T14:59:59Z"); // 23:59:59 Saturday in Tokyo
  const after = new Date("2026-10-17T15:00:00Z"); // 00:00 Sunday in Tokyo
  assert.equal(defaultWeekMonday(dateInZone(before, "Asia/Tokyo")), "2026-10-12");
  assert.equal(defaultWeekMonday(dateInZone(after, "Asia/Tokyo")), "2026-10-19");
  assert.equal(dateInZone(new Date("2026-10-18T00:00:00Z"), "Africa/Nouakchott"), "2026-10-18");
});

test("Monday 00:00 starts a new week in the zone's time", () => {
  const tz = "Pacific/Honolulu";
  const monNight = new Date("2026-10-19T09:59:59Z"); // 23:59:59 Sunday in Honolulu
  const monStart = new Date("2026-10-19T10:00:00Z"); // Monday 00:00
  assert.equal(defaultWeekMonday(dateInZone(monNight, tz)), "2026-10-19");
  assert.equal(defaultWeekMonday(dateInZone(monStart, tz)), "2026-10-19");
  assert.equal(weekNumber(defaultWeekMonday(dateInZone(monStart, tz)), START), 2);
});

test("week range format in the three languages", () => {
  assert.equal(formatWeekRange("2026-10-19", "ar"), "19–24 أكتوبر");
  assert.equal(formatWeekRange("2026-10-19", "fr"), "19–24 oct.");
  assert.equal(formatWeekRange("2026-10-19", "en"), "Oct 19–24");
});

test("week range across two months", () => {
  assert.equal(formatWeekRange("2026-10-26", "fr"), "26–31 oct."); // same month
  assert.equal(formatWeekRange("2026-10-28", "en"), "Oct 28–Nov 2");
  assert.equal(formatWeekRange("2026-10-28", "fr"), "28 oct.–2 nov.");
  assert.equal(formatWeekRange("2026-10-28", "ar"), "28 أكتوبر–2 نوفمبر");
});
