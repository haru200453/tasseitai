import NextAuth, { type AuthOptions } from "next-auth";
import type { Account, Session } from "next-auth";
import type { OAuthConfig } from "next-auth/providers/oauth";
import type { JWT } from "next-auth/jwt";

type ExtendedToken = JWT & {
  accessToken?: string;
};

type ExtendedSession = Session & {
  accessToken?: string;
  userId?: string;
  user?: NonNullable<Session["user"]> & {
    id?: string;
  };
};

const normalizeBaseUrl = (value?: string) => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");

  try {
    const parsed = new URL(withoutTrailingSlash);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return withoutTrailingSlash;
  }
};

const getBaseUrl = () => {
  const configuredUrl = normalizeBaseUrl(
    process.env.NEXTAUTH_URL ||
      process.env.AUTH_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined)
  );

  return configuredUrl ?? "https://tasseitai-d.vercel.app";
};

const notionRedirectUri = `${getBaseUrl()}/api/auth/callback/notion`;

const notionProvider: OAuthConfig<any> = {
  id: "notion",
  name: "Notion",
  type: "oauth",

  clientId: process.env.NOTION_CLIENT_ID!,
  clientSecret: process.env.NOTION_CLIENT_SECRET!,

  authorization: {
    url: "https://api.notion.com/v1/oauth/authorize",
    params: {
      owner: "user",
      response_type: "code",
      redirect_uri: notionRedirectUri,
    },
  },

  token: {
    async request({ params }: { params: { code?: string } }) {
      const response = await fetch("https://api.notion.com/v1/oauth/token", {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              `${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`
            ).toString("base64"),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code: params.code,
          redirect_uri: notionRedirectUri,
        }),
      });

      const tokens = await response.json();

      return {
        tokens,
      };
    },
  },

  userinfo: {
    async request({ tokens }: { tokens: { access_token?: string } }) {
      return {
        id: tokens.access_token || "notion-user",
        name: "Notion User",
      };
    },
  },

  profile(profile: { id?: string; name?: string | null }) {
    return {
      id: profile.id ?? "notion-user",
      name: profile.name ?? "Notion User",
    };
  },
};

export const authOptions: AuthOptions = {
  debug: true,

  pages: {
    signIn: "/login",
    error: "/login",
  },

  providers: [notionProvider],

  callbacks: {
    async jwt({ token, account }: { token: ExtendedToken; account?: Account | null }) {
      if (account?.access_token) {
        token.accessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }: { session: Session; token: ExtendedToken }) {
      const extendedSession = session as ExtendedSession;
      if (extendedSession.user) {
        extendedSession.user.id = token.sub ?? extendedSession.user.id;
      }
      extendedSession.accessToken = token.accessToken as string | undefined;
      extendedSession.userId = token.sub;
      return extendedSession;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };