import test from "node:test";
import assert from "node:assert/strict";
import { streakMilestone, activeDaysInWeek, weekGoalPct, computeStreak, pct, buildSeries, chartCoords, lastMonths, monthEnd, hm } from "../src/lib/home-stats.ts";

test("streak: ends today or yesterday and breaks on a gap", () => {
  assert.equal(computeStreak(["2026-10-25", "2026-10-24", "2026-10-23"], "2026-10-25"), 3);
  assert.equal(computeStreak(["2026-10-24", "2026-10-23"], "2026-10-25"), 2);
  assert.equal(computeStreak(["2026-10-22"], "2026-10-25"), 0);
  assert.equal(computeStreak(["2026-10-25", "2026-10-23"], "2026-10-25"), 1);
  assert.equal(computeStreak([], "2026-10-25"), 0);
});

test("percentage and time", () => {
  assert.equal(pct(1, 3), 33);
  assert.equal(pct(0, 0), 0);
  assert.deepEqual(hm(6 * 3_600_000 + 5 * 60_000), { h: 6, m: 5 });
});

test("months", () => {
  assert.equal(monthEnd("2026-02"), "2026-02-28");
  assert.deepEqual(lastMonths("2026-01", 3), ["2026-01", "2025-12", "2025-11"]);
});

test("cumulative series and chart coordinates", () => {
  const rows = [
    { day: "2026-10-01", correct: true },
    { day: "2026-10-01", correct: false },
    { day: "2026-10-31", correct: true },
    { day: "2026-09-30", correct: false }, // outside the month
  ];
  const s = buildSeries(rows, "2026-10", 9);
  assert.equal(s.length, 9);
  assert.equal(s[0].pct, 50);
  assert.equal(s[8].pct, 67);
  const c = chartCoords(s);
  assert.equal(c[0].x, 30);
  assert.equal(c[8].x, 330);
  assert.equal(c[0].y, 80); // 150 - 50*1.4
  assert.equal(buildSeries([], "2026-10")[3].pct, null);
});

test("milestones and weekly goal", () => {
  assert.equal(streakMilestone(7), 7);
  assert.equal(streakMilestone(8), null);
  assert.equal(activeDaysInWeek(["2026-10-19", "2026-10-19", "2026-10-21", "2026-10-26"], "2026-10-19"), 2);
  assert.equal(weekGoalPct(4), 80);
  assert.equal(weekGoalPct(7), 100);
});
