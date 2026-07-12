import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth/next";
import { generateText, generateTextWithNotionWorkflow } from "./groq";
import { authOptions } from "../auth/[...nextauth]/route";

export const runtime = "nodejs";

// type Topic = { id: string; label: string };

// function topicChoices(unresolved: string[] = []) {
//   return NOTION_TOPICS.filter((topic: Topic) => !unresolved.includes(topic.id)).map((topic: Topic) => ({
//     id: topic.id,
//     label: topic.label,
//   }));
// }

// function handleRegisterAtTopic(topic: Topic, originalMessage: string) {
//   const preview = buildRegistrationPreview(topic.id, originalMessage);
//   return { content: preview.message, pendingItem: preview.item };
// }

// async function handleReadForTopics(
//   topics: Topic[],
//   message: string,
//   notionApiKey: string,
//   databaseMap: Record<string, string>
// ) {
//   const content = await generateTextFromNotionData(message, topics, notionApiKey, databaseMap);
//   return { content };
// }

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    const question =
      typeof body?.question === "string"
        ? body.question.trim()
        : typeof body?.message === "string"
          ? body.message.trim()
          : "";

    let content;
    let res = "";

    if (question) {
      // セッションからaccessTokenを取得
      const session = await getServerSession(authOptions);
      if (!session) {
        return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
      }
      const accessToken = (session as any)?.accessToken;
      if (!accessToken) {
        return NextResponse.json(
          { error: "Notion access tokenが取得できません。Notionで再度ログインしてください。" },
          { status: 401 }
        );
      }

      //理想の処理:contentにNotionデータを見たうえでの回答が入る
      const cookieStore = await cookies();
      const notionParentId = cookieStore.get("notion_page_id")?.value ?? "";

      const workflowResult = await generateTextWithNotionWorkflow(question, accessToken, notionParentId);

      res = typeof workflowResult === "string" ? workflowResult : workflowResult?.content || "";
      content = res;

      cookieStore.set("notion_pending_update", "", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
    } else if (prompt) {
      content = await generateText(prompt);
      res = typeof content === "string" ? content : "";
    } else {
      return NextResponse.json({ error: "prompt または question が必要です" }, { status: 400 });
    }

    return NextResponse.json({ content: res || content });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "不明なエラーです";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
