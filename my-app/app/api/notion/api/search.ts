//検索機能

import { fetchNotionJson } from "../api/client";
import { collectNotionPageInfo } from "./pages";
import { FetchNotionPagesOptions, FetchNotionPagesResult } from "../types";

export async function searchNotionWorkspace(
  accessToken: string,
  query = "",
  pageSize = 50,
  maxPages = 3
): Promise<any[]> {
  const results: any[] = [];
  let nextCursor: string | null = null;
  const safePageSize = Math.min(Math.max(pageSize, 1), 100);
  const safeMaxPages = Math.min(Math.max(maxPages, 1), 10);
  let requestCount = 0;

  do {
    const body: Record<string, any> = {
      query,
      page_size: safePageSize,
    };
    if (nextCursor) body.start_cursor = nextCursor;

    const data = await fetchNotionJson("https://api.notion.com/v1/search", accessToken, body);

    if (Array.isArray(data.results)) {
      results.push(...data.results);
    }
    nextCursor = data.next_cursor;
    requestCount += 1;
  } while (nextCursor && requestCount < safeMaxPages);

  return results;
}

export async function searchNotionPages(
  accessToken: string,
  query = "",
  pageSize = 50,
  maxPages = 3
): Promise<any[]> {
  return searchNotionWorkspace(accessToken, query, pageSize, maxPages);
}

export async function fetchNotionPages({
  accessToken,
  query = "",
  searchType = "workspace",
  pageSize = 50,
  maxPages = 3,
}: FetchNotionPagesOptions): Promise<FetchNotionPagesResult> {
  if (!accessToken) {
    throw new Error("accessToken is required to fetch Notion pages.");
  }

  const source = searchType === "search" ? "search" : "workspace";
  const pages = await searchNotionWorkspace(accessToken, query, pageSize, maxPages);

  const results = pages.map((page) => collectNotionPageInfo(page));
  return {
    source,
    count: results.length,
    results,
  };

}