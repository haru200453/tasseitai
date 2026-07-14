'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import styles from '@/app/settings/settings.module.css'; // 設定画面と同じCSSを再利用
import {
  checkPushSupport,
  registerServiceWorker,
  getOrCreateSubscription,
  persistSubscription,
} from '@/app/components/pushSubscription';

// ========================================
// 型定義
// ========================================

type SupportState = 'checking' | 'supported' | 'unsupported';
type SwState = 'idle' | 'registering' | 'ready' | 'error';

type SubscriptionState = {
  endpoint: string;
  raw: PushSubscription;
} | null;

// ========================================
// 定数
// ========================================

const publicVapidKey = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY;

const NOTIFICATION_CONFIG = {
  title: 'Journee push test',
  body: 'Service Worker経由のテスト通知です。',
  icon: '/icon-512x512.png',
  badge: '/icon-512x512.png',
  tag: 'journee-push-test',
} as const;

const ERROR_MESSAGES = {
  noServiceWorker: 'Service Workerが準備できていません',
  noPermission: '通知権限を許可してください',
  noVapidKey: 'VAPID公開鍵が設定されていません',
  noSubscription: 'まず購読を作成してください',
  unsupportedBrowser: 'このブラウザではプッシュ通知を利用できません。',
} as const;

// ========================================
// ユーティリティ関数
// ========================================

function extractErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function showLocalNotification(
  registration: ServiceWorkerRegistration
): Promise<void> {
  await registration.showNotification(NOTIFICATION_CONFIG.title, {
    body: NOTIFICATION_CONFIG.body,
    icon: NOTIFICATION_CONFIG.icon,
    badge: NOTIFICATION_CONFIG.badge,
    tag: NOTIFICATION_CONFIG.tag,
  });
}

// ========================================
// サーバー通信
// ========================================

async function requestServerPush(subscription: PushSubscription): Promise<void> {
  const response = await fetch('/api/push/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error || 'サーバー通知の送信に失敗しました');
  }
}

// ========================================
// メインコンポーネント
// ========================================

const NotificationDemoPage: React.FC = () => {
  const [supportState, setSupportState] = useState<SupportState>('checking');
  const [swState, setSwState] = useState<SwState>('idle');
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionState>(null);
  const [message, setMessage] = useState('');
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [isSendingServer, setIsSendingServer] = useState(false);

  useEffect(() => {
    if (typeof Notification !== 'undefined') {
      setPermission(Notification.permission);
    }

    if (!checkPushSupport()) {
      setSupportState('unsupported');
      setMessage(ERROR_MESSAGES.unsupportedBrowser);
      return;
    }

    setSupportState('supported');
    setSwState('registering');

    const initialize = async () => {
      try {
        const { registration: reg, existingSubscription } = await registerServiceWorker();
        
        setRegistration(reg);
        
        if (existingSubscription) {
          setSubscription({
            endpoint: existingSubscription.endpoint,
            raw: existingSubscription,
          });
        }
        
        setSwState('ready');
      } catch (error) {
        setSwState('error');
        setMessage(extractErrorMessage(error, 'Service Worker登録に失敗しました'));
      }
    };

    initialize();
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    
    const result = await Notification.requestPermission();
    setPermission(result);
  }, []);

  const sendLocalNotification = useCallback(async () => {
    if (!registration) {
      setMessage(ERROR_MESSAGES.noServiceWorker);
      return;
    }

    if (permission !== 'granted') {
      setMessage(ERROR_MESSAGES.noPermission);
      return;
    }

    try {
      await showLocalNotification(registration);
      setMessage('ローカル通知を送信しました');
    } catch (error) {
      setMessage(extractErrorMessage(error, '通知送信に失敗しました'));
    }
  }, [registration, permission]);

  const subscribePush = useCallback(async () => {
    if (!registration) {
      setMessage(ERROR_MESSAGES.noServiceWorker);
      return;
    }
    
    if (!publicVapidKey) {
      setMessage(ERROR_MESSAGES.noVapidKey);
      return;
    }

    const currentPermission =
      permission === 'default' ? await Notification.requestPermission() : permission;
    setPermission(currentPermission);

    if (currentPermission !== 'granted') {
      setMessage(ERROR_MESSAGES.noPermission);
      return;
    }

    setIsSubscribing(true);
    try {
      const { subscription: sub, isExisting } = await getOrCreateSubscription(
        registration,
        publicVapidKey
      );

      setSubscription({ endpoint: sub.endpoint, raw: sub });
      await persistSubscription(sub);
      setMessage(isExisting ? '既存の購読を再利用します（サーバーにも保存済み）' : '購読を作成し、サーバーに保存しました');
    } catch (error) {
      setMessage(extractErrorMessage(error, '購読に失敗しました'));
    } finally {
      setIsSubscribing(false);
    }
  }, [permission, registration]);

  const sendServerPush = useCallback(async () => {
    if (!subscription) {
      setMessage(ERROR_MESSAGES.noSubscription);
      return;
    }

    setIsSendingServer(true);
    try {
      await requestServerPush(subscription.raw);
      setMessage('サーバーから通知を送信しました');
    } catch (error) {
      setMessage(extractErrorMessage(error, 'サーバー通知の送信に失敗しました'));
    } finally {
      setIsSendingServer(false);
    }
  }, [subscription]);

  const supportLabel =
    supportState === 'checking'
      ? '確認中'
      : supportState === 'supported'
        ? 'サポートされています'
        : '未対応のブラウザです';

  const swLabel =
    swState === 'registering'
      ? '登録中'
      : swState === 'ready'
        ? '準備完了'
        : swState === 'error'
          ? 'エラー'
          : '未開始';

  return (
    <div className={styles.container}>
      {/* ヘッダー：設定画面のコンポーネントとデザインを統一 */}
      <div className={styles.header}>
        <Link href="/settings" className={styles.backBtn} style={{ textDecoration: 'none' }}>
          ←
        </Link>
        <h1 className={styles.title}>通知テスト</h1>
      </div>

      {/* テストメインコンテンツエリア */}
      <div className="min-h-screen bg-gray-50 rounded-xl overflow-hidden mt-4">
        <div className="max-w-3xl mx-auto px-4 py-8">
          <div className="bg-white shadow-sm border border-gray-200 rounded-xl p-6">
            <p className="text-gray-600 text-sm">
              PWA環境でのローカル通知とWeb Push（サーバー送信）の双方を確認します。
            </p>

            {/* ステータス表示エリア */}
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="p-4 border border-gray-200 rounded-lg bg-gray-50">
                <p className="text-sm text-gray-500">ブラウザ対応状況</p>
                <p className="text-base font-semibold text-gray-800">{supportLabel}</p>
              </div>
              <div className="p-4 border border-gray-200 rounded-lg bg-gray-50">
                <p className="text-sm text-gray-500">Service Worker</p>
                <p className="text-base font-semibold text-gray-800">{swLabel}</p>
              </div>
              <div className="p-4 border border-gray-200 rounded-lg bg-gray-50">
                <p className="text-sm text-gray-500">通知権限</p>
                <p className="text-base font-semibold text-gray-800">{permission}</p>
              </div>
              <div className="p-4 border border-gray-200 rounded-lg bg-gray-50">
                <p className="text-sm text-gray-500">メッセージ</p>
                <p className="text-base font-semibold text-gray-800 break-words">
                  {message || '—'}
                </p>
              </div>
              <div className="p-4 border border-gray-200 rounded-lg bg-gray-50 md:col-span-2">
                <p className="text-sm text-gray-500">購読エンドポイント</p>
                <p className="text-xs text-gray-700 break-all">{subscription?.endpoint || '未購読'}</p>
              </div>
            </div>

            {/* アクションボタンエリア */}
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={requestPermission}
                className="inline-flex items-center px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 text-sm font-medium"
                disabled={permission === 'granted' || supportState !== 'supported'}
              >
                通知を許可する
              </button>
              <button
                type="button"
                onClick={sendLocalNotification}
                className="inline-flex items-center px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-700 focus:ring-offset-2 disabled:opacity-50 text-sm font-medium"
                disabled={permission !== 'granted' || !registration || swState !== 'ready'}
              >
                ローカル通知を送信
              </button>
              <button
                type="button"
                onClick={subscribePush}
                className="inline-flex items-center px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50 text-sm font-medium"
                disabled={isSubscribing || swState !== 'ready'}
              >
                {isSubscribing ? '購読処理中...' : 'Web Pushを購読'}
              </button>
              <button
                type="button"
                onClick={sendServerPush}
                className="inline-flex items-center px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 text-sm font-medium"
                disabled={isSendingServer || !subscription}
              >
                {isSendingServer ? '送信中...' : 'サーバー通知を送信'}
              </button>
            </div>

            {/* 使い方説明エリア */}
            <div className="mt-10 border-t border-gray-100 pt-6">
              <h2 className="text-lg font-semibold text-gray-900">使い方</h2>
              <ol className="mt-3 list-decimal list-inside space-y-2 text-sm text-gray-700">
                <li>このページにアクセスするとService Workerを自動登録します。</li>
                <li>「通知を許可する」を押してブラウザの権限を付与します。</li>
                <li>「Web Pushを購読」で鍵ペアを用いた購読情報（トークン）を作成します。</li>
                <li>「ローカル通知を送信」で端末内での即時通知テストを行います。</li>
                <li>「サーバー通知を送信」で実際のAPIサーバーを経由したプッシュ通知を検証します。</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotificationDemoPage;