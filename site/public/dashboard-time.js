const formatterCache = new Map();

export function dashboardDateTimeFormatter(options = {}, locale = 'ja-JP') {
  const normalizedOptions = { timeZone: 'Asia/Tokyo', ...options };
  const key = `${locale}:${JSON.stringify(normalizedOptions)}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, normalizedOptions);
    formatterCache.set(key, formatter);
  }
  return formatter;
}

export const JST_TIME_HM = dashboardDateTimeFormatter({
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export const JST_DATE_YMD = dashboardDateTimeFormatter({
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const JST_DATE_TIME_MDHM = dashboardDateTimeFormatter({
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export const JST_DATE_TIME_YMDHMS = dashboardDateTimeFormatter({
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export const JST_MONTH_DAY = dashboardDateTimeFormatter({
  month: '2-digit',
  day: '2-digit',
});

export const JST_DATE_EN_CA = dashboardDateTimeFormatter({
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}, 'en-CA');
