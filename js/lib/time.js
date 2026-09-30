// Time: Miami clock, opening hours, "5 min ago".

// Current day (0 = Sunday) and hour (14.5 = 2:30 PM) in Miami, wherever the visitor is.
function miamiNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(date);
  const part = type => parts.find(p => p.type === type).value;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday"));
  return { day, hour: (Number(part("hour")) % 24) + Number(part("minute")) / 60 };
}

function formatHour(h) {
  const hours = Math.floor(h);
  const minutes = Math.round((h - hours) * 60);
  const suffix = hours >= 12 ? "PM" : "AM";
  const twelve = ((hours + 11) % 12) + 1;
  return minutes ? `${twelve}:${String(minutes).padStart(2, "0")} ${suffix}` : `${twelve} ${suffix}`;
}

// What a branch's published hours say right now.
// schedule looks like {"1": [6.5, 16], ...} with day 0 = Sunday.
export function hoursStatus(branch, now = miamiNow()) {
  if (branch.always_open) return { open: true, text: "Open 24/7" };
  if (!branch.schedule) return { open: null, text: "Hours not published" };
  const today = branch.schedule[String(now.day)];
  if (today && now.hour >= today[0] && now.hour < today[1]) return { open: true, text: `Open · closes ${formatHour(today[1])}` };
  if (today && now.hour < today[0]) return { open: false, text: `Closed · opens ${formatHour(today[0])}` };
  return { open: false, text: "Closed now" };
}

export function timeAgo(date) {
  const mins = Math.round((Date.now() - new Date(date).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function formatMinutes(m) {
  if (m < 60) return `${Math.max(1, Math.round(m))} min`;
  const h = m / 60;
  return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
}

export function isToday(date) {
  return Boolean(date) && Date.now() - new Date(date).getTime() < 24 * 3600e3;
}
