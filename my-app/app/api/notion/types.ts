//interface定義をまとめる

export interface RichTextItem {
  plain_text?: string;
  [key: string]: any;
}


export interface NotionFetchOptions {
  accessToken?: string;
  query: string;
  searchType: "search" | "workspace";
  pageSize: number;
  maxPages: number;
}

export interface NotionPagesOutput {
  source: string;
  count: number;
  results: any[];
}

export interface NotionPageInfo {
  id: string;
  object: any;
  url: string | null;
  title: string;
  parent: any;
  created_time: string | null;
  last_edited_time: string | null;
  icon: any;
  cover: any;
  properties: Record<string, any>;
  propertiesList: string[];
}

export interface DbSchemaProperty {
  name: string;
  type: string;
}

export interface DbSchema {
  id: string;
  title: string;
  properties: DbSchemaProperty[];
}

export interface NotionQueryRow {
  __page_id: string;
  __body?: string;
  [key: string]: any;
}

export interface FetchNotionPagesOptions {
  accessToken: string;
  query?: string;
  searchType?: "workspace" | "search";
  pageSize?: number;
  maxPages?: number;
}

export interface FetchNotionPagesResult {
  source: string;
  count: number;
  results: NotionPageInfo[];
}