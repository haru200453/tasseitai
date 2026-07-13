import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { collectNotionPageInfo, queryDatabase, searchNotionPages } from "../notion";
import { authOptions } from "../auth/[...nextauth]/route";
import { resolveNotionApiKey } from "@/lib/notionAuth";

const defaultPageSize = 50;
const defaultMaxPages = 3;

function normalizeNumber(value: unknown, fallback: number) {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? Math.max(1, Math.floor(numberValue)) : fallback;
}

export async function POST(request: Request) {
  try {
    // NextAuthのセッションからaccessTokenを取得
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
    }

    const accessToken = (session as any)?.accessToken;
    if (!accessToken) {
      return NextResponse.json(
        { error: "Notion access tokenが取得できません。Notionで再度ログインしてください。" },
        { status: 401 }
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const pageSize = normalizeNumber(body.pageSize, defaultPageSize);
    const maxPages = normalizeNumber(body.maxPages, defaultMaxPages);
    const databaseId = typeof body.databaseId === "string" ? body.databaseId.trim() : "";
    const searchType = typeof body.searchType === "string" ? body.searchType : "workspace";

    if (searchType === "database" && databaseId) {
      const rows = await queryDatabase(accessToken, databaseId, false);
      const results = rows.map((row: any) => {
        const properties: Record<string, any> = {};

        for (const [key, value] of Object.entries(row || {})) {
          if (!key || key.startsWith("__")) continue;

          if (key === "ステータス" || key === "状態") {
            properties[key] = { name: value ?? "" };
          } else if (key === "期日" || key === "日時") {
            properties[key] = { start: value ?? null };
          } else {
            properties[key] = value;
          }
        }

        return {
          id: row.__page_id,
          title: row["タイトル"] || row["予定"] || row["タスク名"] || "",
          properties,
        };
      });

      return NextResponse.json({
        source: "database",
        count: results.length,
        results,
      });
    }

    const pages = await searchNotionPages(accessToken, query, pageSize, maxPages);
    const results = pages.map((page) => collectNotionPageInfo(page));

    return NextResponse.json({
      source: "workspace",
      count: results.length,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーです";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as any;
    const apiKey = await resolveNotionApiKey();
    const pageId = typeof body.pageId === "string" ? body.pageId.trim() : "";
    const status = typeof body.status === "string" ? body.status.trim() : "";

    if (!apiKey) {
      return NextResponse.json({ error: "Notionと連携されていません" }, { status: 401 });
    }

    if (!pageId) {
      return NextResponse.json({ error: "pageId が必要です" }, { status: 400 });
    }

    const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify({
        properties: {
          ステータス: {
            status: {
              name: status,
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json({ error }, { status: response.status });
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーです";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
