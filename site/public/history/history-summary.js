// Summary metrics for archive periods and listening parties.
import { finiteNumber as finite, integerFormat as integer, setText } from '../dashboard-ui-common.js?v=20260930.1';
import { durationLabel } from '../official-listening-party-ui.js?v=20261001.1';

export function createHistorySummary(state, dataMode, numberText) {
  function average(rows, key) {
    const values = rows.map((row) => finite(row?.[key])).filter((value) => value != null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  function setSummary(labels, values) {
    if (!state.data) values = { periods: '—', max: '—', stream: '—', member: '—' };
    setText('periodLabel', labels.period);
    setText('maxLabel', labels.max);
    setText('streamLabel', labels.stream);
    setText('memberLabel', labels.member);
    setText('periods', values.periods);
    setText('maxListener', values.max);
    setText('streamGrowth', values.stream);
    setText('memberGrowth', values.member);
  }

  function updateSummary() {
    const rows = state.rows;
    const mode = dataMode();
    if (mode === 'broadcasts') {
      const maximums = rows.map((row) => finite(row?.listener_max)).filter((value) => value != null);
      const durations = rows.map((row) => {
        const start = finite(row?.started_at);
        const end = finite(row?.ended_at);
        return start == null || end == null || end < start ? null : (end - start) / 60_000;
      }).filter((value) => value != null);
      setSummary(
        { period: '期間数', max: '平均同接', stream: '最大同接', member: '平均所要時間' },
        {
          periods: numberText(rows.length),
          max: numberText(average(rows, 'listener_avg')),
          stream: maximums.length ? integer.format(Math.max(...maximums)) : '—',
          member: durations.length ? durationLabel(durations.reduce((sum, value) => sum + value, 0) / durations.length) : '—',
        },
      );
      return;
    }

    setSummary(
      { period: '期間数', max: '平均同接', stream: '平均再生数増加量', member: '平均メンバー増加数' },
      {
        periods: numberText(rows.length),
        max: numberText(average(rows, 'listener_avg')),
        stream: numberText(average(rows, 'stream_growth')),
        member: numberText(average(rows, 'member_growth')),
      },
    );
  }

  return { updateSummary };
}
