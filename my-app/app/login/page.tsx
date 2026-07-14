"use client";

import { signIn } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, Suspense } from "react";
import styles from "./login.module.css";

function LoginContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const error = searchParams.get("error");

  useEffect(() => {
    if (error) {
      router.replace("/notion-logout");
    }
  }, [error, router]);

  const handleLogin = async () => {
    await signIn("notion", {
      callbackUrl: "/home",
    });
  };

  if (error) {
    return (
      <main className="container">
        <div className={styles.card}>
          <p>別アカウントへ切り替え中...</p>
        </div>
      </main>
    );
  }

  return (
    // 元の "container" を styles.container に変更し、背景色などを適用できるようにしました
    <main className={styles.container}>
      <div className={styles.card}>
        <div className={styles.logoWrapper}>
        <img 
            src="/icon-512x512.png" 
            alt="AI秘書ロゴ" 
            width={80} 
            height={80} 
            style={{ borderRadius: '16px', marginBottom: '16px' }} 
          />
          <h1 className={styles.title}>AI秘書</h1>
        </div>

        <p className={styles.subtitle}>
          Notionと連携して、
          <br />
          あなた専属のAI秘書としてタスク・予定・メモを管理します。
        </p>

        <button
          className={styles.loginButton}
          onClick={handleLogin}
        >
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
