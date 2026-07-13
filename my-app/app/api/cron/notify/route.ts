import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { getWorkspaceSchema, queryDatabase } from "../../notion";
import { generateText, executeNotionSearch } from "../../groq/groq";
import { getAllNotionUserIds, getNotionToken } from "@/lib/notionTokenStore";
import { getPushSubscriptions, removePushSubscription } from "@/lib/pushSubscriptions";
import { resolveNotionApiKey } from "@/lib/notionAuth";

export const runtime = "nodejs";

type NotionTopicId = "shopping" | "todo" | "schedule" | "jobhunting" | "memo";

const DEFAULT_DATABASE_IDS: Record<NotionTopicId, string[]> = {
  shopping: ["38fa15fd-a3c1-8049-8041-ebf679d048b2"],
  todo: ["38fa15fd-a3c1-80bd-98d9-ddcfe8406a93"],
  schedule: ["38fa15fd-a3c1-80fa-a200-d99ac64b3409"],
  jobhunting: ["38fa15fd-a3c1-8076-80ad-dc57719ac014"],
  memo: ["38fa15fd-a3c1-80ed-b95d-ea990af2b963"],
};

// 天気のデフォルト地域（ホーム画面のデフォルトと同じ大阪。cronはサーバー側実行のためユーザーごとの設定は参照できない）
const DEFAULT_WEATHER_LAT = "34.6937";
const DEFAULT_WEATHER_LON = "135.5023";
const DEFAULT_WEATHER_NAME = "大阪";

// 6〜22時はこの順で1時間ごとにサイクルする。23時は「今日もお疲れ様」専用枠。
const CYCLE_CATEGORIES = ["shopping", "weather", "schedule", "todo", "news", "jobhunting"] as const;
type Category = (typeof CYCLE_CATEGORIES)[number];

const CATEGORY_LABELS: Record<Category, string> = {
  shopping: "🛒 買い物リスト",
  weather: "☀️ 天気予報",
  schedule: "📅 スケジュール",
  todo: "📋 進捗管理",
  news: "📰 ニュース",
  jobhunting: "💼 就活",
};

const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY;
const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
const contact = process.env.WEB_PUSH_CONTACT;

if (publicKey && privateKey && contact) {
  webpush.setVapidDetails(contact, publicKey, privateKey);
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${secret}`) return true;

  const querySecret = request.nextUrl.searchParams.get("secret");
  return querySecret === secret;
}

// JST（日本時間）の現在時刻を取得する（Vercelのサーバーは基本UTCで動くため）
function getJstNow(): Date {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
}

// 現在時刻(JST)に応じて、今回送るべきカテゴリ（もしくは終業メッセージ）を決める
function getCurrentSlot(jstHour: number): Category | "wrapup" | null {
  if (jstHour < 6 || jstHour > 23) return null; // 6時〜23時の対象時間外
  if (jstHour === 23) return "wrapup";
  const index = (jstHour - 6) % CYCLE_CATEGORIES.length;
  return CYCLE_CATEGORIES[index];
}

async function resolveDatabaseIds(accessToken: string): Promise<Record<NotionTopicId, string[]>> {
  const resolved = { ...DEFAULT_DATABASE_IDS };

  try {
    const workspaceSchema = await getWorkspaceSchema(accessToken);
    const todoDatabaseIds = workspaceSchema
      .filter((schema) => schema.databaseTitle === "進捗管理")
      .map((schema) => schema.databaseId)
      .filter(Boolean);
    const scheduleDatabaseIds = workspaceSchema
      .filter((schema) => ["日々の予定", "アルバイト", "就職活動"].includes(schema.databaseTitle))
      .map((schema) => schema.databaseId)
      .filter(Boolean);

    if (todoDatabaseIds.length > 0) {
      resolved.todo = todoDatabaseIds;
    }
    if (scheduleDatabaseIds.length > 0) {
      resolved.schedule = scheduleDatabaseIds;
    }
  } catch (error) {
    console.warn("[cron/notify] failed to resolve database ids from workspace schema", error);
  }

  return resolved;
}

async function queryAllDatabases(apiKey: string, databaseIds: string[]): Promise<any[]> {
  if (!databaseIds.length) return [];

  const results = await Promise.all(databaseIds.map((databaseId) => queryDatabase(apiKey, databaseId)));
  return results.flat();
}

async function getShoppingItems(apiKey: string, databaseIds: string[]): Promise<string[]> {
  const rows = await queryAllDatabases(apiKey, databaseIds);
  return rows
    .map((row: any) => row["商品名"])
    .filter(Boolean);
}

async function getWeatherDescription(): Promise<string> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${DEFAULT_WEATHER_LAT}&longitude=${DEFAULT_WEATHER_LON}&current=temperature_2m,weather_code,precipitation_probability,wind_speed_10m&timezone=Asia%2FTokyo&forecast_days=1`;
  const res = await fetch(url);
  if (!res.ok) return "";
  const data = await res.json();
  const current = data?.current;
  if (!current) return "";
  return `${DEFAULT_WEATHER_NAME}の現在の気温${current.temperature_2m}℃、天気コード${current.weather_code}、風速${current.wind_speed_10m}m/s`;
}

async function getScheduleToday(apiKey: string, databaseIds: string[]): Promise<{ name: string; time: string }[]> {
  const events = await queryAllDatabases(apiKey, databaseIds);

  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  return events
    .filter((event: any) => {
      const start = event["日時"];
      if (!start) return false;
      const startDate = new Date(start);
      return startDate >= now && startDate <= endOfDay;
    })
    .map((event: any) => {
      const start = new Date(event["日時"]);
      const time = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
      return { name: event["予定"] || event["タイトル"] || "無題", time };
    });
}

// 「完了していない」かつ「期限超過」または「2日以内に期日が来る」タスク（＝遅れそう・遅れているタスク）
async function getAtRiskTasks(apiKey: string, databaseIds: string[]): Promise<string[]> {
  const tasks = await queryAllDatabases(apiKey, databaseIds);
  
  const now = new Date();
  const soonThreshold = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

  return tasks
    .filter((task: any) => {
      const statusName = task["ステータス"] || "";
      if (statusName === "完了") return false;
      const overdue = Boolean(task["期限超過"]);
      if (overdue) return true;
      const dueDate = task["期日"];
      if (!dueDate) return false;
      return new Date(dueDate) <= soonThreshold;
    })
    .map((task: any) => task["タスク名"] || "無題");
}

async function getNewsHeadlines(): Promise<string[]> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) return [];
  const res = await fetch(
    `https://gnews.io/api/v4/top-headlines?category=general&lang=ja&country=jp&max=5&apikey=${apiKey}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data?.articles || []).map((article: any) => article.title).filter(Boolean);
}

// 就活データベースのうち、期日が7日以内に迫っているもの
async function getUpcomingJobHunting(apiKey: string, databaseIds: string[]): Promise<string[]> {
  const entries = await queryAllDatabases(apiKey, databaseIds);

  const now = new Date();
  const soonThreshold = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  return entries
    .filter((entry: any) => {
      const dueDate = entry["期日"];
      if (!dueDate) return false;
      const due = new Date(dueDate);
      return due >= now && due <= soonThreshold;
    })
    .map((entry: any) => {
      const statusName = entry["ステータス"] || "";
      const company = entry["会社名"] || "無題";
      return `${company}（${statusName}）`;
    });
}

// weather/news はNotionを使わないため全ユーザー共通の内容にする。それ以外は各ユーザー自身のNotionを見る必要がある。
const SHARED_SLOTS = new Set<Category>(["weather", "news"]);

// カテゴリごとの生データを、Noirに渡す説明文にまとめる。
// データが無い場合も「何も無い」という状態自体をNoirに伝え、必ず何かしら通知を作ってもらう。
async function buildCategoryContext(
  category: Category,
  apiKey?: string | null,
  databaseIds?: Record<NotionTopicId, string[]>
): Promise<string | null> {
  const safeApiKey = apiKey ?? "";

  switch (category) {
    case "shopping": {
      if (!safeApiKey) return null;
      const items = await getShoppingItems(safeApiKey, databaseIds?.shopping ?? DEFAULT_DATABASE_IDS.shopping);
      return items.length > 0
        ? `買い物リストの中身: ${items.slice(0, 8).join("、")}`
        : "買い物リストは今のところ空っぽ";
    }
    case "weather": {
      return (await getWeatherDescription()) || "天気情報が取得できなかった";
    }
    case "schedule": {
      return await executeNotionSearch(safeApiKey, "本日の予定");
    }
    case "todo": {
      return await executeNotionSearch(safeApiKey, "期限が2日以内のタスク");
    }
    case "news": {
      const headlines = await getNewsHeadlines();
      return headlines.length > 0
        ? `最新ニュースの見出し: ${headlines.join("、")}`
        : "ニュースが取得できなかった";
    }
    case "jobhunting": {
      return await executeNotionSearch(safeApiKey, "就活案件");
    }
    default:
      return null;
  }
}

// Noir（Groqの人格つきgenerateText）を使って、短いプッシュ通知文を作る
async function composeNotificationBody(context: string): Promise<string> {
  const prompt = [
    "以下の情報をもとに、スマホのプッシュ通知として送る短い一言を作ってください。",
    "1〜2文、40〜80文字程度で、日時や項目名など重要な情報は残しつつ簡潔にまとめてください。",
    "",
    context,
  ].join("\n");

  return generateText(prompt);
}

async function composeWrapUpBody(apiKey?: string | null, databaseIds?: Record<NotionTopicId, string[]>): Promise<string> {
  if (!apiKey) {
    return "Notion accessToken が設定されていません。";
  }

  const tasks = await getAtRiskTasks(apiKey, databaseIds?.todo ?? DEFAULT_DATABASE_IDS.todo);
  const context =
    tasks.length > 0
      ? `今日時点で遅れている・期日が近いタスクが${tasks.length}件残っている: ${tasks.slice(0, 5).join("、")}`
      : "遅れているタスクは特に無い、順調な1日だった";

  const prompt = [
    "1日の終わり（23時）に送る、スマホのプッシュ通知として短い一言を作ってください。",
    "「今日もお疲れ様」というねぎらいを込めつつ、1〜2文、40〜80文字程度でまとめてください。",
    "毎回同じ文面にならないよう、少し表現を変えてください。",
    "",
    context,
  ].join("\n");

  return generateText(prompt);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(publicKey && privateKey && contact)) {
    return NextResponse.json({ error: "VAPID keys are not configured on the server" }, { status: 500 });
  }

  const jstNow = getJstNow();
  const jstHour = jstNow.getHours();

  // テスト用：?force=1 を付けると時間帯制限を無視して実行する（任意で &slot=weather のように指定可能）
  const forceTest = request.nextUrl.searchParams.get("force") === "1";
  const requestedSlot = request.nextUrl.searchParams.get("slot");
  const isValidSlot = (value: string | null): value is Category | "wrapup" =>
    value !== null && ((CYCLE_CATEGORIES as readonly string[]).includes(value) || value === "wrapup");

  const slot = forceTest
    ? isValidSlot(requestedSlot)
      ? requestedSlot
      : CYCLE_CATEGORIES[jstHour % CYCLE_CATEGORIES.length]
    : getCurrentSlot(jstHour);

  if (!slot) {
    return NextResponse.json({ sent: false, reason: "outside notification hours", jstHour });
  }
  const userIds = await getAllNotionUserIds();

  async function sendToUser(userId: string, title: string, body: string): Promise<number> {
    const subscriptions = await getPushSubscriptions(userId);
    const payload = JSON.stringify({ title, body });
    let count = 0;
    for (const { raw, subscription } of subscriptions) {
      try {
        await webpush.sendNotification(subscription, payload);
        count += 1;
      } catch (error: any) {
        // 期限切れ・無効な購読は保存先から削除しておく
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await removePushSubscription(userId, raw);
        } else {
          console.error("[cron/notify] sendNotification failed", error);
        }
      }
    }
    return count;
  }

  // weather/newsはNotionを使わないので、全員に同じ内容を送る
  if (slot !== "wrapup" && SHARED_SLOTS.has(slot)) {
    const notificationTitle = CATEGORY_LABELS[slot];
    const context = await buildCategoryContext(slot, null, undefined);
    const notificationBody = context ? await composeNotificationBody(context) : null;

    if (!notificationBody) {
      return NextResponse.json({ sent: false, reason: "no content for this slot", slot });
    }

    let sentCount = 0;
    for (const userId of userIds) {
      sentCount += await sendToUser(userId, notificationTitle, notificationBody);
    }

    return NextResponse.json({ sent: true, sentCount, slot, notificationBody });
  }

  // それ以外（shopping/schedule/todo/jobhunting/wrapup）は各ユーザー自身のNotionを見て個別に通知を作る
  const notificationTitle = slot === "wrapup" ? "🌙 今日もお疲れ様" : CATEGORY_LABELS[slot];
  let sentCount = 0;
  let usersNotified = 0;

  for (const userId of userIds) {
    const subscriptions = await getPushSubscriptions(userId);
    if (subscriptions.length === 0) continue;

    const apiKey = await getNotionToken(userId);
    if (!apiKey) continue;

    try {
      const databaseIds = await resolveDatabaseIds(apiKey);
      const notificationBody =
        slot === "wrapup"
          ? await composeWrapUpBody(apiKey, databaseIds)
          : await (async () => {
              const context = await buildCategoryContext(slot, apiKey, databaseIds);
              return context ? await composeNotificationBody(context) : null;
            })();

      if (!notificationBody) continue;

      usersNotified += 1;
      sentCount += await sendToUser(userId, notificationTitle, notificationBody);
    } catch (error) {
      console.error(`[cron/notify] user ${userId} 向け通知の作成に失敗:`, error);
    }
  }

  return NextResponse.json({ sent: sentCount > 0, sentCount, usersNotified, slot });
}
