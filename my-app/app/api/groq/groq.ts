import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchNotionPages,
  searchDatabases,
  queryDatabase,
  fetchPageBodyText,
  fetchDbSchema,
  buildNotionSavePayload,
  getWorkspaceSchema
} from "../notion";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

interface NotionDebugState {
  requestBody: Record<string, unknown> | null;
  error: {
    message: string;
    status?: number;
    statusText?: string;
    responseText?: string;
  } | null;
}

let lastNotionDebugState: NotionDebugState = {
  requestBody: null,
  error: null,
};

async function loadPromptTemplate(fileName: string): Promise<string> {
  const candidatePaths = [
    path.join(currentDir, fileName),
    path.join(currentDir, "..", "notion", fileName),
    path.join(currentDir, "..", "groq", fileName),
  ];

  let lastError: Error | undefined;
  for (const candidatePath of candidatePaths) {
    try {
      return await readFile(candidatePath, "utf8");
    } catch (error) {
      lastError = error as Error;
    }
  }

  throw lastError ?? new Error(`Prompt template not found: ${fileName}`);
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeToolName(rawText: unknown): "notion_search" | "notion_update" | null {
  const text = normalizeText(rawText).toLowerCase();
  if (!text) return null;
  const match = text.match(/\b(notion_search|notion_update)\b/);
  if (Array.isArray(match) && match[1]) {
    return match[1] as "notion_search" | "notion_update";
  }
  if (text.includes("notion_update")) return "notion_update";
  if (text.includes("notion_search")) return "notion_search";
  if (/(none|不要|なし|not needed|tool not needed)/.test(text)) return null;
  return null;
}

function normalizeKey(value: unknown): string {
  return normalizeText(value)
    .replace(/[_\s-]+/g, " ")
    .trim()
    .toLowerCase();
}


function inferNotionPropertyType(propertyKey: string, rawValue: unknown): string {
  const key = normalizeKey(propertyKey);
  if (!key) return "rich_text";

  if (/(^title$|^name$|subject|headline|heading)/.test(key)) return "title";
  if (
    /(description|content|body|note|memo|summary|detail|comment|message|sentence|prompt|question)/.test(
      key
    )
  )
    return "rich_text";
  if (/(status|state|stage|type|category|priority|label|role|topic|level)/.test(key))
    return "select";
  if (/(tags|labels|categories|genres|topics|people|assignees)/.test(key))
    return "multi_select";
  if (/(date|due|deadline|created|updated|finished|time|start|end)/.test(key))
    return "date";
  if (/(url|link|website|homepage|page|path)/.test(key)) return "url";
  if (/(email|mail)/.test(key)) return "email";
  if (/(phone|tel|mobile|contact)/.test(key)) return "phone_number";
  if (
    /(^(is|has|should|was|can|did|do|done)|_(is|has|done)$|checkbox|completed|active|enabled)/.test(
      key
    ) ||
    typeof rawValue === "boolean"
  )
    return "checkbox";
  if (Array.isArray(rawValue)) return "multi_select";
  if (typeof rawValue === "number") return "number";
  return "rich_text";
}

interface SchemaMapItem {
  name: string;
  type: string;
}

function normalizeNotionTextValue(value: unknown): string {
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

interface NotionUpdateContext {
  parentId: string;
  schemaProperties: Record<string, unknown>;
}

// Notionの更新に必要な引数を解決する関数
async function resolveNotionUpdateArgs(
  accessToken: string,
  requestedParentId: string,
  notionData: Record<string, unknown> = {}
): Promise<NotionUpdateContext> {
  let parentId = typeof requestedParentId === "string" ? requestedParentId : "";
  const rawProperties = (notionData as any)?.results?.[0]?.properties;
  const schemaProperties =
    rawProperties && typeof rawProperties === "object" ? rawProperties : {};

  if (!parentId) {
    const databases = await searchDatabases(accessToken);
    if (Array.isArray(databases) && databases.length > 0) {
      parentId = databases[0].id;
      if (!Object.keys(schemaProperties).length && Array.isArray(databases[0].properties)) {
        return {
          parentId,
          schemaProperties: Object.fromEntries(
            databases[0].properties.map((prop: any) => [prop.name, prop.type || "rich_text"])
          ),
        };
      }
    }
  }

  if (parentId && !Object.keys(schemaProperties).length) {
    const rows = await queryDatabase(accessToken, parentId, false);
    if (Array.isArray(rows) && rows.length > 0) {
      const inferredProperties: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rows[0])) {
        if (key.startsWith("__")) continue;
        inferredProperties[key] = value;
      }
      if (Object.keys(inferredProperties).length > 0) {
        return { parentId, schemaProperties: inferredProperties };
      }
    }
  }

  return { parentId, schemaProperties };
}

function normalizeSchemaPropertiesArray(
  schemaProperties: Record<string, unknown> = {}
): SchemaMapItem[] {
  if (Array.isArray(schemaProperties)) return schemaProperties;
  if (schemaProperties && typeof schemaProperties === "object") {
    return Object.entries(schemaProperties).map(([name, value]) => ({
      name,
      type:
        typeof value === "string"
          ? value
          : (value && typeof value === "object" && (value as any).type) ||
            inferNotionPropertyType(name, value),
    }));
  }
  return [];
}

async function createNotionPage(
  accessToken: string,
  parentId: string,
  properties: Record<string, unknown>
): Promise<any> {
  if (!accessToken) {
    throw new Error("accessToken が必要です");
  }
  if (!parentId) {
    throw new Error("parentId が必要です");
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
  };

  const notionUrl = "https://api.notion.com/v1/pages";

  async function postPage(body: Record<string, unknown>): Promise<any> {
    const response = await fetch(notionUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Notion API error: ${response.status} ${response.statusText} - ${responseText}`
      );
    }
    return JSON.parse(responseText);
  }

  try {
    const requestBody = { parent: { database_id: parentId}, properties };
    lastNotionDebugState = {
      requestBody,
      error: null,
    };
    //デバッグログ
    console.log(
      "[Notion] Sending page creation payload:\n",
      JSON.stringify(requestBody, null, 2)
    );
    return await postPage(requestBody);
  } catch (databaseError) {

    const message =
      databaseError instanceof Error ? databaseError.message : String(databaseError);
    const errorDetails = databaseError instanceof Error
      ? {
          message,
          status: (databaseError as Error & { status?: number }).status,
          statusText: (databaseError as Error & { statusText?: string }).statusText,
          responseText: (databaseError as Error & { responseText?: string }).responseText,
        }
      : { message };

    lastNotionDebugState = {
      requestBody: {
        parent: { database_id: parentId},
        properties,
      },
      error: errorDetails,
    };

    if (
      message.includes("database_id") ||
      message.includes("parent") ||
      message.includes("Invalid request")
    ) {
      throw new Error(
        `Notion page creation failed. parentId must be a valid database_id. ${message}`
      );
    }

    throw databaseError;
  }
}

export async function saveToNotion(
  accessToken: string,
  parentId: string,
  payload: Record<string, unknown> = {},
): Promise<any> {
  console.log("[Notion] Save payload:", JSON.stringify(payload, null, 2));
  return createNotionPage(accessToken, parentId, payload);
}

// Notionデータを取得する関数（遅延実行）
async function fetchNotionData(
  accessToken: string,
  query = ""
): Promise<{ results: any[] }> {
  if (!accessToken) {
    throw new Error("accessToken が必要です");
  }

  try {
    const data = await fetchNotionPages({
      accessToken,
      query,
      pageSize: 10,
      maxPages: 2,
    });

    const results = (data?.results || []).map((item: any) => ({
      title: item.title,
      url: item.url,
      lastEdited: item.last_edited_time,
      properties: item.properties,
      propertiesList: item.propertiesList,
      content: "",
    }));

    return { results };
  } catch (error) {
    console.error(
      "Notionデータ取得エラー:",
      error instanceof Error ? error.message : String(error)
    );

    return { results: [] };
  }
}

export function buildNotionSearchText(rows: any[] = [], databaseTitle = ""): string {
  if (!Array.isArray(rows) || rows.length === 0) {
    return "";
  }

  return rows
    .slice(0, 10)
    .map((row, index) => {
      const entries = Object.entries(row || {})
        .filter(([key]) => !key.startsWith("__"))
        .map(([key, value]) => `${key}: ${normalizeNotionTextValue(value)}`)
        .filter((entry) => entry.split(":").slice(1).join(":").trim())
        .join(" / ");
      const body = row?.__body ? `\nbody: ${normalizeNotionTextValue(row.__body)}` : "";
      const prefix = databaseTitle ? `${databaseTitle} | ` : "";
      return `- ${index + 1}. ${prefix}${entries || "内容なし"}${body}`;
    })
    .join("\n");
}

export function matchesNotionQuery(row: Record<string, unknown> = {}, question = ""): boolean {
  const query = normalizeText(question);
  if (!query) return true;

  const terms = query
    .split(/\s+/)
    .map((term) => term.toLowerCase())
    .filter(Boolean);
  if (terms.length === 0) return true;

  const genericQuery = /教えて|内容|一覧|表示|見せ|確認|リスト|何|どんな|どれ|お願い|して/.test(query);
  if (genericQuery) return true;

  const haystack = Object.entries(row || {})
    .filter(([key]) => !key.startsWith("__"))
    .map(([, value]) => normalizeNotionTextValue(value))
    .join(" ")
    .toLowerCase();

  return terms.some((term) => haystack.includes(term));
}

// Notion検索を実行する関数
export async function executeNotionSearch(accessToken: string, question = ""): Promise<string> {
  const searchQuery = normalizeText(question);
  if (!accessToken) {
    return "Notion accessToken が設定されていません。";
  }

  try {
    const databases = await searchDatabases(accessToken);
    if (!Array.isArray(databases) || databases.length === 0) {
      return "Notion でデータベースを見つけられませんでした。";
    }

    const sections: string[] = [];
    for (const database of databases.slice(0, 5)) {
      const rows = await queryDatabase(accessToken, database.id, false);
      const enrichedRows: any[] = [];

      for (const row of rows) {
        const body = await fetchPageBodyText(accessToken, row.__page_id);
        if (body) {
          row.__body = body;
        }
        if (matchesNotionQuery(row, searchQuery)) {
          enrichedRows.push(row);
        }
      }

      const matchedRows = enrichedRows.length > 0 ? enrichedRows : rows;
      const sectionText = buildNotionSearchText(matchedRows, database.title || database.id);
      if (sectionText) {
        sections.push(`データベース: ${database.title || database.id}\n${sectionText}`);
      }
    }

    return sections.length > 0
      ? sections.join("\n\n")
      : "指定条件に一致する Notion データが見つかりませんでした。";
  } catch (error) {
    console.error("Notion search failed:", error);
    return `Notion検索中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`;
  }
}

const NOIR_SYSTEM_PROMPT = [
  "あなたは「Noir」という名前のパーソナルアシスタントAIです。",
  "ユーザーの生活・タスク管理をサポートするのが役目です。",
  "",
  "口調・キャラクター:",
  "- 基本はフレンドリーで親しみやすい口調で接してください。",
  "- ただし、期限を過ぎたタスクを放置している、やるべきことをサボっている様子が見えるときは、遠慮せずはっきりと指摘し、時には厳しく叱咤激励してください（アメとムチ）。",
  "- 順調に進んでいるときや何かを達成できたときは、きちんと労い、褒めてください。",
  "",
  "回答スタイル:",
  "- Notionのデータを渡された場合でも、それをそのまま表やリストとして機械的に列挙するだけの回答はしないでください。",
  "- 必ず、データの内容を踏まえた一言コメント（進み具合への指摘、励まし、次にやるべきことの提案など）を添えてください。",
  "- 簡潔に、会話として自然な文章で答えてください。",
  "- ただし「買い物リストがほしい」のように一覧そのものを求められたときは例外です。Markdownテーブル（|で区切る表）や「- 」のようなハイフンの箇条書きは絶対に使わないでください。必ず全角の中点記号「・」を行頭に使い、「・商品名」の形式で名前だけを示してください（ハイフンは使用禁止、必ず「・」を使うこと）。アイテムを1つずつ改行し、1行につき1アイテムだけを書いてください（複数のアイテムを同じ行に並べたり「・」で連結したりしないこと）。数量やメモなどの詳細は、特に聞かれない限り省略してください。箇条書きを出す場合も、その前後に短い一言コメントは添えてください。",
  "- ただし「スケジュール」「予定」「日時」に関するデータ（日時・期日プロパティを持つもの）は例外中の例外です。名前だけの省略はせず、一覧形式であっても必ず「・予定名 日付 時刻」のように日時（期日）を毎回セットで出力してください。日時が無いと何のための予定か分からず、スケジュール管理として意味がないためです。",
  "- 進捗管理のデータについて聞かれたときは、ステータスが「完了」のタスクは一覧から除外してください。それ以外の未完了タスクは、期日をどれだけ過ぎていても絶対に除外・省略せず全件表示してください（下記の『上位5件まで』という件数制限は進捗管理には適用しません。期日超過の未完了タスクを見せないのはタスク管理として致命的なため）。表示順は「本日」の日付を基準に、期日が本日から近い順に並べてください（過去日・未来日を問わず、本日との差が小さいものを優先。単純に古い期日から並べるのではありません）。期日が無いものは最後にしてください。",
  "- 進捗管理以外のデータ（就活・スケジュールなど、日時・期日プロパティを持つもの）を一覧表示するときは、現在の日時に近いもの（直近の予定・締切）を優先して並べてください。",
  "- 一覧を箇条書きで示すときは、原則として上から5件までにしてください（進捗管理の未完了タスクは例外で、上記の通り件数制限なしで全件表示します）。渡されたデータが5件を超える場合は、箇条書きの後に「他にもN件あります。詳しくはNotionを確認してね」のように残り件数を一言添えてください（Nは実際の残り件数）。ただしユーザーが「全部」「すべて」「全件」のように明示的に全件表示を求めている場合は、件数制限をせず全件を表示してください。",
  "- 渡されたNotionデータに無関係な一般論やアドバイスを付け加えないでください。渡されたデータの範囲内だけで答えてください。",
  "",
  "一覧表示の見本（この形式を真似すること）:",
  "まずは上位5件を抜粋してお届けしますね。",
  "",
  "・猫",
  "・ドリップコーヒーパック",
  "・米",
  "・ヨーグルト",
  "・洗剤",
  "",
].join("\n");

// Node標準fetchを使う
//入力: promptText (string) - ユーザからの質問や指示
//出力: 生成されたテキスト (string) - GROQ APIからの応答
export async function generateText(promptText: string): Promise<string> {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const normalizedPromptText = 
  "現在時刻は" + jst.toLocaleString() + "です。以降の処理に必要であれば利用して。" + normalizeText(promptText);
  if (!normalizedPromptText) {
    throw new Error("generateText requires a non-empty string promptText argument");
  }

  const groqApiKey = (
    process.env.GROQ_API_KEY || process.env.NEXT_PUBLIC_GROQ_API_KEY
  )?.trim();
  if (!groqApiKey) {
    throw new Error(
      "GROQ_API_KEY が設定されていません。Vercel の環境変数に GROQ_API_KEY を追加してください。"
    );
  }

  let res;
  try {
    res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
        messages: [
          { role: "system", content: NOIR_SYSTEM_PROMPT },
          { role: "user", content: normalizedPromptText }
        ],
        reasoning_effort: "low",
        max_completion_tokens: 2048,
      }),
    });
  } catch (error) {
    throw new Error(
      `GROQ API request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error("今ちょっとお話しすぎて混み合ってるみたい。少し時間を置いてからもう一度話しかけてね。");
    }
    const responseText = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${responseText}`);
  }

  const data = (await res.json().catch(() => null)) as any;
  return typeof data?.choices?.[0]?.message?.content === "string"
    ? data.choices[0].message.content.trim()
    : "";
}

//notionに対しsearchかupdateのどちらを使用するべきか判断させる。
//返り値: notion_search か notion_update のいずれかの文字列
export async function buildToolCallPrompt(userMessage: string): Promise<"notion_search" | "notion_update" | null> {
  const template = await loadPromptTemplate("tool_call_prompt.txt");
  const usermessage = normalizeText(userMessage);
  const judgePrompt = `${template}\nユーザー入力:${usermessage}\n判断対象: notion_search もしくは notion_update のどちらを使用すべきかを答えてください。返答はnotion_search か notion_update のいずれかの文字列のみで答えてください.`;
  const rawResult = await generateText(judgePrompt);
  return normalizeToolName(rawResult);
}

export async function buildRecallPrompt(
  userMessage: string,
  toolName: string,
  toolResult: string
): Promise<string> {
  const template = await loadPromptTemplate("re_call_prompt.txt");
  return template
    .replaceAll("{{user_message}}", normalizeText(userMessage))
    .replaceAll("{{tool_name}}", normalizeText(toolName))
    .replaceAll("{{tool_result}}", normalizeText(toolResult));
}

interface GenerateTextWithNotionWorkflowResult {
  content: string;
  pendingUpdate: null;
}

//3-4-1登録処理↓↓
//役割:更新項目の洗い出し,登録対象データベースの判定処理
interface RegistrationTargetResult {
  databaseId: string;
  mappings: Array<{
    propertyName: string;
    value: string;
  }>;
}
export async function resolveRegistrationTarget(
  userMessage: string,
  workspaceSchema: any[]
): Promise<RegistrationTargetResult> {
  const prompt = `
    あなたはNotionの登録先を判断するAIです。

    ユーザー入力から

    1. 登録対象データベースを選択
    2. 登録する値を抽出
    3. データベース項目へマッピング

    を行ってください。

    データベース一覧:
    ${JSON.stringify(workspaceSchema, null, 2)}

    ユーザー入力:
    ${userMessage}

    出力形式:

    {
      "databaseId":"",
      "mappings":[
        {
          "propertyName":"",
          "value":""
        }
      ]
    }

    JSONのみ返してください。
    `;

  const responseText = await generateText(prompt);
  console.log("[resolveRegistrationTarget] AI response:", responseText);
  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error(
    `AI応答をJSON変換できませんでした: ${responseText}`
    );
  }
}
//3-4-1登録処理↑↑



//route.tsから呼び出される関数
//引数: question ユーザーからの質問
//返り値:　notionデータを見たうえでの回答
export async function generateTextWithNotionWorkflow(
  question: string,
  accessToken: string,
  notionParentId = "",
): Promise<GenerateTextWithNotionWorkflowResult> {
  const questionText = normalizeText(question);
  if (!questionText) {
    throw new Error("質問文が必要です");
  }

  // Notionのワークスペーススキーマを取得
  const workspaceSchema = await getWorkspaceSchema(accessToken);
  console.log("[Notion] Workspace schema:", JSON.stringify(workspaceSchema, null, 2));

  const notionData = await fetchNotionData(accessToken, questionText);
  
  //検索or登録判定
  const toolName = await buildToolCallPrompt(questionText);

  if (!toolName) {
    return {
      content: await generateText(questionText),
      pendingUpdate: null,
    };
  }

  if (toolName === "notion_update") {
    const notionUpdateContext = await resolveNotionUpdateArgs(
      accessToken,
      notionParentId,
      notionData
    );

    if (!notionUpdateContext.parentId) {
      return {
        content:
          "Notion page/database ID が設定されていません。設定画面から保存先のIDを登録してください。",
        pendingUpdate: null,
      };
    }



    //3-4-1登録処理:ユーザー入力から登録対象データベースを判定
    const registration = await resolveRegistrationTarget(questionText, workspaceSchema); 
    const dbSchema = await fetchDbSchema(accessToken, registration.databaseId);
    const dbprops = dbSchema?.properties?.length
      ? dbSchema.properties
      : normalizeSchemaPropertiesArray(notionUpdateContext.schemaProperties);
    const savePayload = buildNotionSavePayload(registration.mappings, dbprops);
    
    console.log("[Notion] Save payload:", JSON.stringify(savePayload, null, 2));
    const savedPage = await saveToNotion(
      accessToken,
      registration.databaseId,
      savePayload,
    );

    return {
      content: savedPage?.url
        ? `以下の内容でNotionページを更新しました:\n データベース名: ${dbSchema?.title || "不明"}\n登録項目: ${registration.mappings.map(m => m.propertyName).join(", ")}\n登録値: ${registration.mappings.map(m => m.value).join(", ")}`
        : `Notionページを更新しました: ${savedPage?.id || "保存が完了しました"}`,
      pendingUpdate: null,
    };
  }

  //仮--notion_searchを実行する場合の処理
  const toolResult = await executeNotionSearch(accessToken, questionText);

  // Notion検索結果をもとに、最終的な回答を生成する
  const recallPrompt = await buildRecallPrompt(questionText, toolName, toolResult);

  return {
    content: await generateText(recallPrompt),
    pendingUpdate: null,
  };
}
