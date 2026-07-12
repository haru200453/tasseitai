import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]/route";

export async function GET() {
  const cookieStore = await cookies();
  const pageId = cookieStore.get("notion_page_id")?.value ?? "";
  const accessToken = cookieStore.get("notion_access_token")?.value ?? "";

  return NextResponse.json({
    pageId,
    connected: Boolean(accessToken),
  });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const pageId = typeof body.pageId === "string" ? body.pageId.trim() : "";
  const accessToken = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const cookieStore = await cookies();

  if (pageId) {
    cookieStore.set("notion_page_id", pageId, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  if (accessToken) {
    cookieStore.set("notion_access_token", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return NextResponse.json({
    success: true,
    pageId: pageId || null,
    connected: Boolean(session?.accessToken || accessToken),
  });
}
