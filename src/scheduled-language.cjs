const WEEKDAYS = new Map([
  ["日", 0], ["天", 0], ["一", 1], ["二", 2], ["三", 3],
  ["四", 4], ["五", 5], ["六", 6],
]);

function normalizeClock(period, hourValue, minuteValue = 0) {
  let hour = Number(hourValue);
  const minute = Number(minuteValue || 0);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (/下午|晚上/.test(period) && hour < 12) hour += 12;
  if (/中午/.test(period) && hour < 11) hour += 12;
  if (/凌晨/.test(period) && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function cleanAction(value) {
  return String(value || "").trim().replace(/^[，,。；;：:\s]+/, "").trim();
}

function scheduleName(action, schedule) {
  const prefix = schedule.kind === "interval"
    ? `每 ${schedule.intervalMinutes} 分钟`
    : schedule.kind === "weekly"
      ? `每周${[..."日一二三四五六"][schedule.day]} ${schedule.time}`
      : `每天 ${schedule.time}`;
  return `${prefix} · ${action}`.slice(0, 100);
}

function parseScheduledRequest(input) {
  const source = String(input || "").trim();
  if (!source || source.length > 20_000) return null;

  let match = source.match(/^每天\s*(凌晨|早上|上午|中午|下午|晚上)?\s*(\d{1,2})(?:\s*[:：]\s*(\d{1,2})|\s*点\s*(?:(\d{1,2})\s*分?)?)\s*(.+)$/);
  if (match) {
    const time = normalizeClock(match[1] || "", match[2], match[3] || match[4] || 0);
    const action = cleanAction(match[5]);
    if (!time || !action) return null;
    const schedule = { kind: "daily", time };
    return { name: scheduleName(action, schedule), prompt: action, schedule };
  }

  match = source.match(/^每周\s*([一二三四五六日天])\s*(凌晨|早上|上午|中午|下午|晚上)?\s*(\d{1,2})(?:\s*[:：]\s*(\d{1,2})|\s*点\s*(?:(\d{1,2})\s*分?)?)\s*(.+)$/);
  if (match) {
    const time = normalizeClock(match[2] || "", match[3], match[4] || match[5] || 0);
    const action = cleanAction(match[6]);
    if (!time || !action) return null;
    const schedule = { kind: "weekly", day: WEEKDAYS.get(match[1]), time };
    return { name: scheduleName(action, schedule), prompt: action, schedule };
  }

  match = source.match(/^每隔\s*(\d+)\s*(分钟|小时|天)\s*(.+)$/);
  if (match) {
    const value = Number(match[1]);
    const multiplier = match[2] === "天" ? 1_440 : match[2] === "小时" ? 60 : 1;
    const intervalMinutes = value * multiplier;
    const action = cleanAction(match[3]);
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 43_200 || !action) return null;
    const schedule = { kind: "interval", intervalMinutes };
    return { name: scheduleName(action, schedule), prompt: action, schedule };
  }

  return null;
}

module.exports = { normalizeClock, parseScheduledRequest };
