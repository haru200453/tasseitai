"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useEffect, Suspense } from "react";
import styles from "./login.module.css";

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const logout = searchParams.get("logout");

  useEffect(() => {
    if (error) {
      signIn("notion", { callbackUrl: "/home" }, { prompt: "login" });
    }
  }, [error]);

  const handleLogin = async () => {
    await signIn("notion", { callbackUrl: "/home" });
  };

  if (error) return null;

  if (logout) {
    return (
      <main className="container">
        <div className={styles.card}>
          <div className={styles.logoWrapper}>
            <div className={styles.logo}>AI</div>
            <h1 className={styles.title}>ログアウト完了</h1>
          </div>

          <p className={styles.subtitle}>
            別のNotionアカウントでログインする場合は、先にNotionからもログアウトしてください。
          </p>

          <a
            href="https://www.notion.so/logout"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.logoutLink}
          >
            Notionからログアウト →
          </a>

          <button className={styles.loginButton} onClick={handleLogin}>
            Notionでログイン
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="container">
      <div className={styles.card}>
        <div className={styles.logoWrapper}>
          <div className={styles.logo}>AI</div>
          <h1 className={styles.title}>AI秘書</h1>
        </div>

        <p className={styles.subtitle}>
          Notionと連携して、
          あなた専属のAI秘書としてタスク・予定・メモを管理します。
        </p>

        <button className={styles.loginButton} onClick={handleLogin}>
          Notionでログイン
        </button>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
