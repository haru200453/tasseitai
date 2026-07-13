//汎用ユーティリティ
import { RichTextItem } from "../types";


export function safeParseJson(value: unknown): any {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeKey(value: unknown): string {
  return normalizeText(value)
    .replace(/[_\s-]+/g, " ")
    .trim()
    .toLowerCase();
}

export function plainTextFromRichText(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return (items as RichTextItem[]).map((item) => item?.plain_text || "").join("");
}

export function normalizeNotionTextValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeNotionTextValue(item))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value).trim();
}

export function formatNotionPropertyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item === null || item === undefined) return "";
        return typeof item === "object" ? JSON.stringify(item) : String(item);
      })
      .filter((item) => item !== "")
      .join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

export function parseDateValue(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  const text = normalizeText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function parseInput(argv: string[], name: string, envName: string): string | undefined {
  const prefix = `${name}=`;
  const arg = argv.find((value) => value.startsWith(prefix));
  if (arg) {
    return arg.slice(prefix.length);
  }
  return process.env[envName];
}

