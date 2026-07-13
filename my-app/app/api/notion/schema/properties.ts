//プロパティ変換処理
import {
  normalizeNotionTextValue,
  normalizeText,
  normalizeKey,
  formatNotionPropertyValue,
  parseDateValue,
  plainTextFromRichText,
  safeParseJson,
} from "../utils/notion-utils";

import { 
  buildNotionSchemaMap,
  ensureRequiredProperties
} from "./schema";

export function extractNotionProperties(properties: Record<string, any> = {}): Record<string, any> {
  if (!properties || typeof properties !== "object") return {};
  return Object.entries(properties).reduce((acc: Record<string, any>, [name, property]) => {
    acc[name] = simplifyPropertyValue(property);
    return acc;
  }, {});
}

export function formatNotionPropertiesList(properties: Record<string, any> = {}): string[] {
  const simplified = extractNotionProperties(properties);
  return Object.entries(simplified).map(([name, value]) => `${name}: ${formatNotionPropertyValue(value)}`);
}


export function simplifyPropertyValue(property: any): any {
  if (!property || typeof property !== "object") return null;

  switch (property.type) {
    case "title":
      return plainTextFromRichText(property.title);
    case "rich_text":
      return plainTextFromRichText(property.rich_text);
    case "number":
    case "checkbox":
    case "url":
    case "email":
    case "phone_number":
    case "created_time":
    case "last_edited_time":
      return property[property.type];
    case "select":
      return property.select ? property.select.name : null;
    case "multi_select":
      return Array.isArray(property.multi_select)
        ? property.multi_select.map((item: any) => item.name)
        : [];
    case "date":
      return property.date || null;
    case "people":
      return Array.isArray(property.people)
        ? property.people
            .map((person: any) => person?.name || person?.email || null)
            .filter(Boolean)
        : [];
    case "files":
      return Array.isArray(property.files)
        ? property.files.map(
            (file: any) => file.name || file.file?.url || file.external?.url
          )
        : [];
    case "relation":
      return Array.isArray(property.relation)
        ? property.relation.map((relation: any) => relation.id)
        : [];
    case "formula":
      if (!property.formula) return null;
      return (
        property.formula.string ??
        property.formula.number ??
        property.formula.boolean ??
        property.formula.date ??
        null
      );
    case "rollup":
      if (!property.rollup) return null;
      return (
        property.rollup.array ??
        property.rollup.number ??
        property.rollup.string ??
        property.rollup.date ??
        null
      );
    case "created_by":
    case "last_edited_by":
      return property[property.type]?.name || property[property.type]?.email || null;
    default:
      return property[property.type] ?? null;
  }
}


export function buildNotionProperties(payload: unknown = {}, schemaProperties: unknown = {}) {
  const normalizedPayload = typeof payload === "string" ? safeParseJson(payload) || { content: payload } : payload || {};
  const schemaMap = buildNotionSchemaMap(schemaProperties);
  const properties: Record<string, any> = {};

  Object.entries(normalizedPayload as Record<string, any>).forEach(([key, value]) => {
    const propertyInfo = lookupNotionProperty(key, schemaMap, value);
    const notionValue = buildNotionPropertyValue(propertyInfo.type, value);
    if (!notionValue) return;
    if (!properties[propertyInfo.name]) {
      properties[propertyInfo.name] = notionValue;
    }
  });

  const hasTitle = Object.values(properties).some((property) => property?.title);
  if (!hasTitle) {
    properties.Title = createFallbackTitle(normalizedPayload);
  }

  return ensureRequiredProperties(properties, schemaProperties, normalizedPayload);
}

export function buildNotionPropertyValue(type: string, rawValue: unknown) {
  const valueText = normalizeNotionTextValue(rawValue);

  switch (type) {
    case "title":
      return buildTitleProperty(valueText);
    case "rich_text":
      return { rich_text: [{ type: "text", text: { content: valueText } }] };
    case "number": {
      const numberValue = Number(rawValue);
      return Number.isFinite(numberValue)
        ? { number: numberValue }
        : { number: 0 };
    }
    case "checkbox":
      return { checkbox: Boolean(rawValue) };
    case "url":
      return { url: valueText || null };
    case "email":
      return { email: valueText || null };
    case "phone_number":
      return { phone_number: valueText || null };
    case "date": {
      const parsed = parseDateValue(rawValue);
      return { date: { start: parsed || new Date().toISOString() } };
    }
    case "select":
      return {
        select: {
          name: valueText || String(rawValue) || "Uncategorized",
        },
      };
    case "multi_select": {
      const items = Array.isArray(rawValue)
        ? rawValue
        : typeof rawValue === "string"
        ? rawValue.split(/[,;]+/)
        : [rawValue];
      return {
        multi_select: items
          .map((item) => ({ name: normalizeNotionTextValue(item) }))
          .filter((item) => item.name),
      };
    }
    default:
      return { rich_text: [{ type: "text", text: { content: valueText } }] };
  }
}


export function buildNotionSavePayload(
  mappings: Array<{
    propertyName: string;
    value: string;
  }>,
  schemaProperties: unknown = {}
) {
  const payload = Object.fromEntries(
    mappings.map(item => [
      item.propertyName,
      item.value
    ])
  );

  return buildNotionProperties(
    payload,
    schemaProperties
  );
}


export function createFallbackTitle(payload: unknown) {
  const values = Array.isArray(payload)
    ? payload.map(normalizeNotionTextValue)
    : Object.values(payload || {}).map(normalizeNotionTextValue);
  const titleText = values.filter(Boolean).join(" / ").trim();
  return buildTitleProperty(titleText || "Notion update");
}

export function buildTitleProperty(content: string) {
  return {
    title: [
      {
        text: {
          content: normalizeText(content) || "Untitled",
        },
      },
    ],
  };
}


export function inferNotionPropertyType(propertyKey: string, rawValue: unknown): string {
  const key = normalizeKey(propertyKey);
  if (!key) return "rich_text";

  if (/(^title$|^name$|subject|headline|heading)/.test(key)) return "title";
  if (/(description|content|body|note|memo|summary|detail|comment|message|sentence|prompt|question)/.test(key)) return "rich_text";
  if (/(status|state|stage|type|category|priority|label|role|topic|level)/.test(key)) return "select";
  if (/(tags|labels|categories|genres|topics|people|assignees)/.test(key)) return "multi_select";
  if (/(date|due|deadline|created|updated|finished|time|start|end)/.test(key)) return "date";
  if (/(url|link|website|homepage|page|path)/.test(key)) return "url";
  if (/(email|mail)/.test(key)) return "email";
  if (/(phone|tel|mobile|contact)/.test(key)) return "phone_number";
  if (/(^(is|has|should|was|can|did|do|done)|_(is|has|done)$|checkbox|completed|active|enabled)/.test(key) || typeof rawValue === "boolean") return "checkbox";
  if (Array.isArray(rawValue)) return "multi_select";
  if (typeof rawValue === "number") return "number";
  return "rich_text";
}

export function lookupNotionProperty(rawKey: string, schemaMap: ReturnType<typeof buildNotionSchemaMap>, rawValue: unknown) {
  const normalizedKey = normalizeKey(rawKey);
  const exact = schemaMap.exactMatches.get(normalizedKey);
  if (exact) return exact;

  const inferredType = inferNotionPropertyType(rawKey, rawValue);
  const fallbackByType = schemaMap.groupedByType[inferredType];
  if (Array.isArray(fallbackByType) && fallbackByType.length > 0) {
    return fallbackByType[0];
  }

  return { name: rawKey.trim() || "Title", type: inferredType };
}