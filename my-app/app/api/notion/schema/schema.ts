//DBスキーマ処理

import {
  parseDateValue,
  normalizeKey
} from "../utils/notion-utils";

import { DbSchema, DbSchemaProperty } from "../types";

import { 
  inferNotionPropertyType,
  createFallbackTitle
 } from "./properties";

import { fetchNotionJson } from "../api/client";


function normalizeSchemaPropertiesInput(schemaProperties: unknown): Record<string, any> {
  if (!schemaProperties) return {};
  if (Array.isArray(schemaProperties)) {
    try {
      return Object.fromEntries(
        schemaProperties
          .filter((p: any) => p && typeof p.name === "string")
          .map((p: any) => [p.name, p.type || "rich_text"])
      );
    } catch {
      return {};
    }
  }
  if (schemaProperties && typeof schemaProperties === "object" && Array.isArray((schemaProperties as any).properties)) {
    try {
      return Object.fromEntries(
        (schemaProperties as any).properties
          .filter((p: any) => p && typeof p.name === "string")
          .map((p: any) => [p.name, p.type || (p && p.type) || "rich_text"])
      );
    } catch {
      return {};
    }
  }
  if (typeof schemaProperties === "object") return schemaProperties as Record<string, any>;
  return {};
}

export function buildNotionSchemaMap(schemaProperties: unknown) {
  const exactMatches = new Map<string, { name: string; type: string }>();
  const groupedByType: Record<string, Array<{ name: string; type: string }>> = {};

  const normalized = normalizeSchemaPropertiesInput(schemaProperties);
  if (!normalized || typeof normalized !== "object") {
    return { exactMatches, groupedByType };
  }

  Object.entries(normalized).forEach(([name, value]) => {
    const type = typeof value === "string" ? value : inferNotionPropertyType(name, value);
    const key = normalizeKey(name);
    exactMatches.set(key, { name, type });
    groupedByType[type] = groupedByType[type] || [];
    groupedByType[type].push({ name, type });
  });

  return { exactMatches, groupedByType };
}

export function ensureRequiredProperties(properties: Record<string, any>, schemaProperties: unknown = {}, payload: unknown = {}) {
  const normalized = normalizeSchemaPropertiesInput(schemaProperties);
  if (!normalized || typeof normalized !== "object") return properties;

  const schemaEntries = Object.entries(normalized).map(([name, val]) => {
    const type = typeof val === "string" ? val : (val && (val as any).type) || inferNotionPropertyType(name, val);
    return { name, type };
  });

  for (const { name, type } of schemaEntries) {
    if (properties[name]) {
      if (type === "date") {
        const hasDate = properties[name] && properties[name].date && parseDateValue(properties[name].date.start);
        if (!hasDate) {
          properties[name] = { date: { start: new Date().toISOString() } };
        }
      }
      continue;
    }

    switch (type) {
      case "title":
        //properties配下のキーに登録されている文字列を用いるため、実際に登録されている文字列を取得する。
        //properties[name] = { title: { text: "testdata"}};
        break;
      case "date":
        properties[name] = { date: { start: new Date().toISOString() } };
        break;
      case "number":
        properties[name] = { number: 0 };
        break;
      case "select":
        properties[name] = { select: { name: "Uncategorized" } };
        break;
      case "multi_select":
        properties[name] = { multi_select: [] };
        break;
      case "checkbox":
        properties[name] = { checkbox: false };
        break;
      default:
        properties[name] = { rich_text: [{ type: "text", text: { content: "" } }] };
        break;
    }
  }

  const hasTitle = Object.values(properties).some((p) => p && (p as any).title);
  if (!hasTitle) {
    properties.Title = createFallbackTitle(payload);
  }

  return properties;
}

export async function fetchDbSchema(accessToken: string, id: string): Promise<DbSchema | null> {
  if (!accessToken || !id) {
    return null;
  }

  try {
    const db = await fetchNotionJson(
      `https://api.notion.com/v1/databases/${id}`,
      accessToken,
      undefined,
      "GET"
    );
    const title =
      Array.isArray(db?.title) && db.title.length > 0
        ? db.title[0]?.plain_text || db.title[0]?.text?.content || "無題"
        : "無題";

    const rawProperties = db?.properties && typeof db.properties === "object" ? db.properties : {};
    const properties: DbSchemaProperty[] = Object.entries(rawProperties).map(([name, prop]: [string, any]) => ({
      name,
      type: prop?.type || prop?.config?.type || "unknown",
    }));

    return {
      id,
      title,
      properties,
    };
  } catch (error) {
    console.warn("[notion] fetchDbSchema failed", error);
    return null;
  }
}

export async function searchDatabases(accessToken: string): Promise<DbSchema[]> {
  if (!accessToken) {
    return [];
  }

  try {
    const data = await fetchNotionJson(
      "https://api.notion.com/v1/search",
      accessToken,
      { page_size: 100 },
      "POST"
    );
    if (!data || !Array.isArray(data.results)) {
      console.warn("[notion] searchDatabases returned invalid results");
      return [];
    }

    const allDatabases: DbSchema[] = [];
    const seenIds = new Set<string>();
    const dbIdsToTry = new Set<string>();
    const pageIdsToTraverse = new Set<string>();

    for (const result of data.results) {
      const objectType = result?.object;
      const parent = result?.parent;
      const id = result?.id;

      if (!id) continue;

      if (objectType === "database") {
        dbIdsToTry.add(id);
        if (parent?.type === "page_id") {
          pageIdsToTraverse.add(parent.page_id);
        }
        if (parent?.type === "database_id") {
          dbIdsToTry.add(parent.database_id);
        }
      } else if (objectType === "page") {
        if (parent?.type === "database_id") {
          dbIdsToTry.add(parent.database_id);
        } else {
          pageIdsToTraverse.add(id);
        }

        if (parent?.type === "page_id") {
          pageIdsToTraverse.add(parent.page_id);
        }
      }
    }

    for (const dbId of dbIdsToTry) {
      if (seenIds.has(dbId)) continue;
      seenIds.add(dbId);
      const schema = await fetchDbSchema(accessToken, dbId);
      if (schema) allDatabases.push(schema);
    }

    for (const pageId of pageIdsToTraverse) {
      const pageKey = `page:${pageId}`;
      if (seenIds.has(pageKey)) continue;
      seenIds.add(pageKey);
      const nestedSchemas = await findChildDatabases(accessToken, pageId, seenIds);
      allDatabases.push(...nestedSchemas);
    }

    return allDatabases;
  } catch (error) {
    console.warn("[notion] searchDatabases failed", error);
    return [];
  }
}

export async function findChildDatabases(
  accessToken: string,
  pageId: string,
  seen?: Set<string>,
  depth = 0
): Promise<DbSchema[]> {
  if (!accessToken || !pageId || depth > 5) {
    return [];
  }

  const seenSet = seen instanceof Set ? seen : new Set<string>(seen || []);

  try {
    const data = await fetchNotionJson(
      `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`,
      accessToken,
      undefined,
      "GET"
    );

    const schemas: DbSchema[] = [];
    const results = Array.isArray(data?.results) ? data.results : [];

    for (const block of results) {
      const blockId = block?.id;
      if (!blockId) continue;

      if (block?.type === "child_database") {
        if (!seenSet.has(blockId)) {
          seenSet.add(blockId);
          const schema = await fetchDbSchema(accessToken, blockId);
          if (schema) schemas.push(schema);
        }
      }

      if (block?.type === "child_page") {
        const pageKey = `page:${blockId}`;
        if (!seenSet.has(pageKey)) {
          seenSet.add(pageKey);
          const nestedSchemas = await findChildDatabases(accessToken, blockId, seenSet, depth + 1);
          schemas.push(...nestedSchemas);
        }
      }
    }

    return schemas;
  } catch (error) {
    console.warn("[notion] findChildDatabases failed", error);
    return [];
  }
}

export async function getWorkspaceSchema(
  accessToken: string
) {
  const databases = await searchDatabases(accessToken);

  return databases.map((db) => ({
    databaseId: db.id,
    databaseTitle: db.title,
    properties: db.properties,
  }));
}