import { readFileSync, writeFileSync } from 'node:fs';

const path = '.github/scripts/apply-daily-summary-rebuild.mjs';
let source = readFileSync(path, 'utf8');

const before = `source = source.replace(
\`  const daily = await insertDailyOnce(db, minuteDb, otherDb, period, now);\n  const weekly = await insertWeeklyOnce(otherDb, utcWeeklyRange(period.key), now);\n  const monthly = await insertMonthlyOnce(otherDb, utcMonthlyRange(period.key), now);\`,
\`  const daily = await rebuildDailyWhenComplete(db, minuteDb, otherDb, period, now);\n  const weekRange = utcWeeklyRange(period.key);\n  const weekly = await refreshWeekly(otherDb, weekRange, now, daily.rebuilt === true);\n  const monthRange = utcMonthlyRange(period.key);\n  const monthly = await refreshMonthly(\n    otherDb,\n    monthRange,\n    now,\n    daily.rebuilt === true || weekly.rebuilt === true,\n  );\`,
);`;

const after = `source = source.replace(
\`  const daily = await insertDailyOnce(db, minuteDb, otherDb, period, now);\n  const weekly = await insertWeeklyOnce(otherDb, utcWeeklyRange(period.key), now);\n  const monthly = await insertMonthlyOnce(otherDb, utcMonthlyRange(period.key), now);\`,
\`  const minuteFactsRepair = await runMinuteFactsRepair({ DB: db, MINUTE_DB: minuteDb }, now);\n  if (!minuteFactsRepair.complete) {\n    return {\n      skipped: true,\n      reason: 'minute-facts-rebuild-pending',\n      periodKey: period.key,\n      minuteFactsRepair,\n    };\n  }\n  const daily = await rebuildDailyWhenComplete(db, minuteDb, otherDb, period, now);\n  const weekRange = utcWeeklyRange(period.key);\n  const weekly = await refreshWeekly(otherDb, weekRange, now, daily.rebuilt === true);\n  const monthRange = utcMonthlyRange(period.key);\n  const monthly = await refreshMonthly(\n    otherDb,\n    monthRange,\n    now,\n    daily.rebuilt === true || weekly.rebuilt === true,\n  );\`,
);`;

if (!source.includes(before)) throw new Error('daily summary replacement block missing');
source = source.replace(before, after);
source = source.replace(
  `  assert.match(source, /rollupDaily\\(minuteDb, otherDb, period, now\\)/);`,
  `  assert.match(source, /runMinuteFactsRepair\\(\\{ DB: db, MINUTE_DB: minuteDb \\}, now\\)/);\n  assert.match(source, /minute-facts-rebuild-pending/);\n  assert.match(source, /rollupDaily\\(minuteDb, otherDb, period, now\\)/);`,
);
source = source.replace(
  `unlinkSync('.github/scripts/apply-daily-summary-rebuild.mjs');`,
  `unlinkSync('.github/scripts/adjust-daily-summary-rebuild-order.mjs');\nunlinkSync('.github/scripts/apply-daily-summary-rebuild.mjs');`,
);
writeFileSync(path, source);
