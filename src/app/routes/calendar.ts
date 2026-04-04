import { Router } from "express";
import { google } from "googleapis";
import { getAuthClient, ACCOUNTS, AccountKey } from "./auth";

export const calendarRouter = Router();

interface CalendarEvent {
  id: string;
  title: string;
  start: string;       // ISO文字列
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  account: AccountKey;
  accountLabel: string;
  calendarName?: string;
}

async function fetchEventsForAccount(
  account: AccountKey,
  date: Date
): Promise<CalendarEvent[]> {
  const auth = getAuthClient(account);
  if (!auth) return [];

  const cal = google.calendar({ version: "v3", auth });

  // その日の 0:00〜23:59 JST
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  try {
    // カレンダー一覧を取得（複数カレンダー対応）
    const calList = await cal.calendarList.list({ minAccessRole: "reader" });
    const calendars = calList.data.items || [];

    const events: CalendarEvent[] = [];

    for (const calendar of calendars) {
      // 非表示カレンダーはスキップ
      if (calendar.selected === false) continue;

      const res = await cal.events.list({
        calendarId: calendar.id!,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
      });

      for (const e of res.data.items || []) {
        const allDay = !!e.start?.date;
        events.push({
          id: `${account}-${e.id}`,
          title: e.summary || "(タイトルなし)",
          start: e.start?.dateTime || e.start?.date || "",
          end:   e.end?.dateTime   || e.end?.date   || "",
          allDay,
          location:    e.location    || undefined,
          description: e.description || undefined,
          account,
          accountLabel: ACCOUNTS[account].label,
          calendarName: calendar.summary || undefined,
        });
      }
    }

    return events;
  } catch (err: any) {
    console.error(`[calendar] ${account} 取得エラー:`, err.message);
    return [];
  }
}

// GET /api/calendar/today?date=YYYY-MM-DD  (省略時は今日)
calendarRouter.get("/today", async (req, res) => {
  const dateStr = req.query.date as string | undefined;
  const date = dateStr ? new Date(dateStr) : new Date();

  const [mozuEvents, personalEvents] = await Promise.all([
    fetchEventsForAccount("mozu", date),
    fetchEventsForAccount("personal", date),
  ]);

  // マージして時系列ソート（終日イベントを先頭に）
  const all = [...mozuEvents, ...personalEvents].sort((a, b) => {
    if (a.allDay && !b.allDay) return -1;
    if (!a.allDay && b.allDay) return 1;
    return a.start.localeCompare(b.start);
  });

  res.json({ date: date.toISOString().slice(0, 10), events: all });
});
