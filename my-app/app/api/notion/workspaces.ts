//ワークスペース全体操作

import { NotionFetchOptions, NotionPagesOutput } from "./types";
import { fetchNotionPages } from "./api/search";
import { parseInput } from "./utils/notion-utils";


export async function runNotionFetchTest(
  argv = process.argv,
  env = process.env as Record<string, string | undefined>
): Promise<NotionPagesOutput> {
  const options = getNotionFetchOptions(argv, env);
  if (!options.accessToken) {
    throw new Error("accessToken が必要です。例: node test.js accessToken=your-token");
  }

  const result = await getNotionPagesOutput(options);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

export function getNotionFetchOptions(
  argv = process.argv,
  env = process.env as Record<string, string | undefined>
): NotionFetchOptions {
  const accessToken = parseInput(argv, "accessToken", "NOTION_ACCESS_TOKEN");
  const query = parseInput(argv, "query", "NOTION_QUERY") || "";
  const searchType = parseInput(argv, "searchType", "NOTION_SEARCH_TYPE") === "search" ? "search" : "workspace";
  const pageSize = Number(parseInput(argv, "pageSize", "NOTION_PAGE_SIZE") || 10);
  const maxPages = Number(parseInput(argv, "maxPages", "NOTION_MAX_PAGES") || 2);

  return {
    accessToken,
    query,
    searchType,
    pageSize,
    maxPages,
  };
}

export async function getNotionPagesOutput(options: Partial<NotionFetchOptions> = {}): Promise<NotionPagesOutput> {
  const {
    accessToken,
    query = "",
    searchType = "workspace",
    pageSize = 50,
    maxPages = 3,
  } = options;

  const formatted = await fetchNotionPages({
    accessToken: accessToken || "",
    query,
    searchType: searchType as "workspace" | "search",
    pageSize,
    maxPages,
  });

  return formatted;
}