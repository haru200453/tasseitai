//データベース操作

import {
    fetchNotionJson
} from "../api/client";

import {
    NotionQueryRow
} from "../types";

import {
    fetchPageBodyText
} from "./pages";

import {
    plainTextFromRichText
} from "../utils/notion-utils";

export async function queryDatabase(
  accessToken: string,
  databaseId: string,
  includeBody = false
): Promise<NotionQueryRow[]> {
  if (!accessToken || !databaseId) {
    return [];
  }

  try {
    const response = await fetchNotionJson(
      `https://api.notion.com/v1/databases/${databaseId}/query`,
      accessToken,
      { page_size: 50 },
      "POST"
    );

    if (!response || !Array.isArray(response.results)) {
      console.warn("[notion] queryDatabase returned invalid results");
      return [];
    }

    const rows: NotionQueryRow[] = [];

    for (const page of response.results) {
      const row: NotionQueryRow = { __page_id: page.id };
      const properties = page.properties || {};

      for (const [key, prop] of Object.entries(properties)) {
        if (!prop || typeof prop !== "object") continue;

        const propAny = prop as any;
        switch (propAny.type) {
          case "title":
            row[key] = plainTextFromRichText(propAny.title);
            break;
          case "rich_text":
            row[key] = plainTextFromRichText(propAny.rich_text);
            break;
          case "checkbox":
            row[key] = propAny.checkbox ? "✓" : "✗";
            break;
          case "date":
            row[key] = propAny.date?.start ?? "";
            break;
          case "select":
            row[key] = propAny.select?.name ?? "";
            break;
          case "number":
            row[key] = propAny.number != null ? String(propAny.number) : "";
            break;
          default:
            break;
        }
      }

      rows.push(row);
    }

    if (includeBody) {
      for (const row of rows) {
        const body = await fetchPageBodyText(accessToken, row.__page_id);
        if (body) {
          row.__body = body;
        }
      }
    }

    return rows;
  } catch (error) {
    console.warn("[notion] queryDatabase failed", error);
    return [];
  }
}