//Notion API通信共通で使用
//役割:認証ヘッダーの作成、fetchのラップ、エラー処理、デバッグログの出力など

const defaultNotionVersion = "2022-06-28";

function buildHeaders(accessToken: string): Record<string, string> {
  if (!accessToken) {
    throw new Error("accessToken is required for Notion API authentication");
  }
  return {
    Authorization: `Bearer ${accessToken}`,
    "Notion-Version": defaultNotionVersion,
    "Content-Type": "application/json",
  };
}

export async function fetchNotionJson(
  url: string,
  accessToken: string,
  body?: Record<string, any>,
  method = "POST"
): Promise<any> {
  const response = await fetch(url, {
    method,
    headers: buildHeaders(accessToken),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Notion API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  return response.json();
}

