import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/authOptions";
import { getWorkspaceSchema } from "@/app/api/notion";
import HomeClient from "./HomeClient";

const DEFAULT_DATABASE_IDS = {
  schedule: ["38fa15fd-a3c1-80fa-a200-d99ac64b3409"],
  todo: ["38fa15fd-a3c1-80bd-98d9-ddcfe8406a93"],
} as const;

async function resolveDatabaseIds(accessToken: string) {
  try {
    const workspaceSchema = await getWorkspaceSchema(accessToken);

    const todoDatabaseIds = workspaceSchema
      .filter((schema) => schema.databaseTitle === "進捗管理")
      .map((schema) => schema.databaseId)
      .filter(Boolean);

    const scheduleDatabaseIds = workspaceSchema
      .filter((schema) => ["日々の予定", "アルバイト", "就職活動"].includes(schema.databaseTitle))
      .map((schema) => schema.databaseId)
      .filter(Boolean);

    return {
      todoDatabaseIds: todoDatabaseIds.length > 0 ? [...todoDatabaseIds] : [...DEFAULT_DATABASE_IDS.todo],
      scheduleDatabaseIds: scheduleDatabaseIds.length > 0 ? [...scheduleDatabaseIds] : [...DEFAULT_DATABASE_IDS.schedule],
    };
  } catch (error) {
    console.warn("[home] failed to resolve database ids from workspace schema", error);
    return {
      todoDatabaseIds: [...DEFAULT_DATABASE_IDS.todo],
      scheduleDatabaseIds: [...DEFAULT_DATABASE_IDS.schedule],
    };
  }
}

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    redirect("/login");
  }

  const { todoDatabaseIds, scheduleDatabaseIds } = await resolveDatabaseIds(session.accessToken);

  return (
    <HomeClient
      scheduleDatabaseIds={scheduleDatabaseIds}
      todoDatabaseIds={todoDatabaseIds}
      scheduleUnresolved={false}
      todoUnresolved={false}
    />
  );
}
