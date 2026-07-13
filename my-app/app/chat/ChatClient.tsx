"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import styles from "./chat.module.css";

// 1. データ構造に image プロパティ（任意）を追加
type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  image?: string; // 送信された画像のURLを保持する用
};

type PendingItem = {
  topicId: string;
  title: string;
  values?: Record<string, unknown>;
  multiDates?: string[];
};
type TopicChoice = { id: string; label: string };

export default function ChatClient() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Notion登録の確認待ちアイテム（会話履歴とは別に、確認フローのためだけに1件だけ保持する）
  const [pendingItem, setPendingItem] = useState<PendingItem | null>(null);
  // どのトピック（データベース）の話か曖昧なときに、選択肢とその元メッセージを保持する
  const [topicChoices, setTopicChoices] = useState<TopicChoice[]>([]);
  const [pendingOriginalMessage, setPendingOriginalMessage] = useState("");

  const handlePlusClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleSend = async () => {
    const question = message.trim();
    if (!question && !selectedFile) return;

    // 2. ローカルで表示するための画像URLを作成
    let imageUrl = "";
    if (selectedFile && selectedFile.type.startsWith("image/")) {
      imageUrl = URL.createObjectURL(selectedFile);
    }

    // 会話はログとして残さず、直前の1往復だけを表示する（新しい質問で前のやり取りは消える）
    setMessages([{ role: "user", text: question, image: imageUrl }]);
    // 登録確認・トピック選択はボタンでのみ行うため、メッセージを送るということは確認待ちを打ち切る扱いにする
    setPendingItem(null);
    setTopicChoices([]);
    setPendingOriginalMessage("");

    setMessage("");
    setSelectedFile(null);

    try {
      // NOTE: GroqなどのLLMへ画像データを送信して認識させたい場合は、
      // 将来的にここを FormData 形式にするか、Base64に変換して body に含める必要があります。
      // 現状は既存のテキスト送信ロジックを維持しています。
      // Notionを参照するかどうかの判定はサーバー側で行う。会話履歴は送信しない（1問1答のまま）。
      const response = await fetch("/api/groq", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question }),
      });

      if (response.status === 401) {
        router.push("/login");
        return;
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "API request failed");
      }

      applyServerResponse(data);
    } catch (error) {
      console.error("チャット送信エラー:", error);
      showErrorMessage(error);
    }
  };

  // API呼び出しが失敗したとき、コンソールに沈めるだけでなく画面にも表示する
  const showErrorMessage = (error: unknown) => {
    const text = error instanceof Error ? error.message : "エラーが発生しました。もう一度試してみてください。";
    setMessages((prev) => [...prev, { role: "assistant", text }]);
  };

  // サーバーからのレスポンスに含まれる、確認待ち状態（登録待ち・トピック選択待ち）とメッセージ本文を反映する
  const applyServerResponse = (data: any) => {
    setPendingItem(
      data?.pendingItem && typeof data.pendingItem === "object" ? data.pendingItem : null
    );
    setTopicChoices(Array.isArray(data?.topicChoices) ? data.topicChoices : []);
    setPendingOriginalMessage(typeof data?.originalMessage === "string" ? data.originalMessage : "");

    const assistantText = typeof data.content === "string" ? data.content : "";
    const hasChoices = Array.isArray(data?.topicChoices) && data.topicChoices.length > 0;
    const hasPendingItem = data?.pendingItem && typeof data.pendingItem === "object";
    if (assistantText.trim()) {
      setMessages((prev) => [...prev, { role: "assistant", text: assistantText }]);
    } else if (!hasChoices && !hasPendingItem) {
      // サーバーが本文なし・選択肢なし・登録待ちなしを返した場合、ユーザーには何も起きていないように
      // 見えてしまうため、必ず何かしらのフィードバックを表示する
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "うまく取得できなかったみたい。もう一度試してみてね。" },
      ]);
    }
  };

  // トピック選択ボタン用：選ばれたトピックで元のメッセージを処理し直す
  const handleTopicChoice = async (topicId: string) => {
    if (!pendingOriginalMessage) return;

    try {
      const response = await fetch("/api/groq", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: pendingOriginalMessage,
          topicId,
        }),
      });

      if (response.status === 401) {
        router.push("/login");
        return;
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "API request failed");
      }

      applyServerResponse(data);
    } catch (error) {
      console.error("トピック選択エラー:", error);
      showErrorMessage(error);
    }
  };

  // 登録確認ボタン用：はい/やめる の選択を受けて処理する
  const handleConfirmRegistration = async (confirmed: boolean) => {
    if (!pendingItem) return;

    if (!confirmed) {
      setPendingItem(null);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "登録をやめておいたよ。また必要になったら教えてね。" },
      ]);
      return;
    }

    try {
      const response = await fetch("/api/groq", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: pendingOriginalMessage || "登録を確定します",
          confirmRegistration: pendingItem,
        }),
      });

      if (response.status === 401) {
        router.push("/login");
        return;
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "API request failed");
      }

      applyServerResponse(data);
    } catch (error) {
      console.error("登録確定エラー:", error);
      showErrorMessage(error);
    }
  };

  return (
    <main className={styles.container}>
      {/* ヘッダー */}
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => router.back()}>
          ←
        </button>
      </div>

      {/* チャット履歴エリア */}
      <div className={styles.chatArea}>
        {messages.map((msg, index) => (
          <div
            key={index}
            className={
              msg.role === "assistant"
                ? styles.messageRowAssistant
                : styles.messageRowUser
            }
          >
            {/* 役割ラベル */}
            <div className={styles.roleLabel}>
              {msg.role === "assistant" ? "Noir" : "User"}
            </div>

            {/* メッセージの吹き出し */}
            <div
              className={
                msg.role === "assistant"
                  ? styles.assistantBubble
                  : styles.userBubble
              }
            >
              {/* 3. メッセージ内に画像URLがあれば、先に画像を表示 */}
              {msg.image && (
                <div className={styles.sentImageWrapper}>
                  <img src={msg.image} alt="Sent" className={styles.sentImage} />
                </div>
              )}
              {/* テキストがあれば表示 */}
              {msg.text && <div>{msg.text}</div>}
            </div>
          </div>
        ))}

        {/* Notion登録の確認ボタン（メッセージではなく選択式にする） */}
        {pendingItem && (
          <div className={styles.confirmRow}>
            <button
              type="button"
              className={styles.confirmYesBtn}
              onClick={() => handleConfirmRegistration(true)}
            >
              はい、登録する
            </button>
            <button
              type="button"
              className={styles.confirmNoBtn}
              onClick={() => handleConfirmRegistration(false)}
            >
              やめる
            </button>
          </div>
        )}

        {/* どのデータベースの話か曖昧なときの選択ボタン */}
        {topicChoices.length > 0 && (
          <div className={styles.confirmRow}>
            {topicChoices.map((topic) => (
              <button
                key={topic.id}
                type="button"
                className={styles.confirmNoBtn}
                onClick={() => handleTopicChoice(topic.id)}
              >
                {topic.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ボトム入力エリア */}
      <div className={styles.inputArea}>

        {/* 画像が選択されている場合のプレビュー表示 */}
        {selectedFile && (
          <div className={styles.filePreview}>
            {selectedFile.type.startsWith("image/") ? (
              <img
                src={URL.createObjectURL(selectedFile)}
                alt="preview"
                className={styles.previewImage}
                onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
              />
            ) : (
              <span>📎 {selectedFile.name}</span>
            )}
            <button type="button" onClick={() => setSelectedFile(null)} className={styles.clearFileBtn}>
              ✕
            </button>
          </div>
        )}

        {/* カプセル型の入力枠コンテナ */}
        <div className={styles.inputWrapper}>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            style={{ display: "none" }}
            accept="image/*,application/pdf"
          />

          <button
            type="button"
            className={styles.plusBtn}
            onClick={handlePlusClick}
          >
            ＋
          </button>

          <input
            type="text"
            placeholder="Message Noir..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleSend();
              }
            }}
            className={styles.textField}
          />

          <button className={styles.sendBtn} onClick={handleSend}>
            ▶
          </button>
        </div>
      </div>
    </main>
  );
}
