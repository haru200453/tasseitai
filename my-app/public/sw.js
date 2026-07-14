// Service worker for Journee push notifications
const NOTIFICATION_TAG = 'journee-push';

// インストール時の処理
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker');
  self.skipWaiting();
});

// アクティベート時の処理
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker');
  event.waitUntil(self.clients.claim());
});

// プッシュ通知受信時の処理
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');

  let title = 'Journee';
  let body = '新しい通知があります';
  let data = {};

  if (event.data) {
    try {
      const payload = event.data.json();
      title = payload.title || title;
      body = payload.body || body;
      data = payload.data || {};
    } catch (error) {
      console.error('[SW] Failed to parse push data as JSON:', error);
      body = event.data.text() || body;
    }
  }

  const options = {
    body,
    icon: '/icon-512x512.png',
    badge: '/icon-512x512.png',
    tag: NOTIFICATION_TAG,
    requireInteraction: false,
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      url: data.url || '/',
      ...data,
    },
  };

  event.waitUntil(
    self.registration.showNotification(title, options).catch((error) => {
      console.error('[SW] Failed to show notification:', error);
    })
  );
});

// 通知クリック時の処理
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked');
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients
      .matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      .then((clientList) => {
        // 既に開いているタブを探す
        for (const client of clientList) {
          if (client.url === new URL(urlToOpen, self.location.origin).href) {
            if ('focus' in client) {
              return client.focus();
            }
          }
        }

        // 開いているタブがあればそこに移動
        if (clientList.length > 0) {
          const client = clientList[0];
          if ('focus' in client) {
            client.focus();
          }
          if ('navigate' in client) {
            return client.navigate(urlToOpen);
          }
        }

        // 新しいウィンドウを開く
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }

        return undefined;
      })
      .catch((error) => {
        console.error('[SW] Failed to handle notification click:', error);
      })
  );
});

self.addEventListener('notificationclose', (event) => {
  console.log('[SW] Notification closed', event.notification.tag);
});

self.addEventListener('error', (event) => {
  console.error('[SW] Service worker error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[SW] Unhandled promise rejection:', event.reason);
});