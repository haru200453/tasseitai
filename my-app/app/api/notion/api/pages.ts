//ページ情報成形

import { 
    plainTextFromRichText
} from "../utils/notion-utils";

import {
    NotionPageInfo
} from "../types";

import {
    extractNotionProperties,
    formatNotionPropertiesList
} from "../schema/properties";

import {
    fetchNotionJson
} from "./client";

export function extractNotionTitle(page: any): string {
  const titleProperty = Object.values(page.properties || {}).find(
    (property: any) => property?.type === "title"
  );
  if (titleProperty) {
    return plainTextFromRichText((titleProperty as any).title);
  }

  if (Array.isArray(page.title)) {
    return plainTextFromRichText(page.title);
  }

  return page.url || page.id || "";
}

export function collectNotionPageInfo(page: any): NotionPageInfo {
  return {
    id: page.id,
    object: page.object ?? null,
    url: page.url ?? null,
    title: extractNotionTitle(page),
    parent: page.parent ?? null,
    created_time: page.created_time ?? null,
    last_edited_time: page.last_edited_time ?? null,
    icon: page.icon ?? null,
    cover: page.cover ?? null,
    properties: extractNotionProperties(page.properties),
    propertiesList: formatNotionPropertiesList(page.properties),
  };
}

export async function fetchPageBodyText(accessToken: string, pageId: string): Promise<string> {
  if (!accessToken || !pageId) {
    return "";
  }

  try {
    const data = await fetchNotionJson(
      `https://api.notion.com/v1/blocks/${pageId}/children?page_size=10`,
      accessToken,
      undefined,
      "GET"
    );

    const texts: string[] = [];
    const results = Array.isArray(data?.results) ? data.results : [];

    for (const block of results) {
      const richText = block?.[block?.type]?.rich_text || [];
      for (const item of richText) {
        if (item?.plain_text) {
          texts.push(item.plain_text);
        }
      }
    }

    return texts.join(" ").slice(0, 500);
  } catch (error) {
    console.warn("[notion] fetchPageBodyText failed", error);
    return "";
  }
}