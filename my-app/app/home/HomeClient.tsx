'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import styles from './home.module.css';
import {
  SunnyIcon,
  CloudyIcon,
  RainyIcon,
  SnowIcon,
  ThunderstormIcon,
  MistIcon,
  WindIcon,
  DropIcon,
  SettingsIcon,
  AlertIcon,
} from '@/app/components/icons';
import { autoSubscribeToPush } from '@/app/components/pushSubscription';

const decodeWeather = (code: number) => {
  if (code === 0) return { text: '快晴', icon: SunnyIcon };
  if ([1, 2, 3].includes(code)) return { text: '晴れ/曇', icon: CloudyIcon };
  if ([45, 48].includes(code)) return { text: '霧', icon: MistIcon };
  if ([51, 53, 55, 56, 57].includes(code)) return { text: '小雨', icon: RainyIcon };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { text: '雨', icon: RainyIcon };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { text: '雪', icon: SnowIcon };
  if ([95, 96, 99].includes(code)) return { text: '雷雨', icon: ThunderstormIcon };
  return { text: '不明', icon: CloudyIcon };
};

// 経過時間を計算する関数
const formatLastActivity = (dateString: string) => {
  const now = new Date();
  const past = new Date(dateString);
  const diffMs = now.getTime() - past.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour ago`;
  return `${diffDays} day ago`;
};

// ジャンルIDから表示名にマッピングするオブジェクト
const CATEGORY_NAMES: { [key: string]: string } = {
  general: '総合',
  technology: 'テクノロジー',
  business: 'ビジネス',
  science: 'サイエンス',
  sports: 'スポーツ',
  entertainment: 'エンタメ'
};

// 「許可」「拒否」のどちらかを選ぶまでホームへ進ませない（未決定=defaultのときだけブロック）。
// 一度どちらかに決まっていれば（許可でも拒否でも）ホームへ進める。
type NotificationGateStatus = 'checking' | 'blocked' | 'passed';

type HomeClientProps = {
  scheduleDatabaseIds: string[];
  todoDatabaseIds: string[];
  scheduleUnresolved: boolean;
  todoUnresolved: boolean;
};

export default function HomeClient({
  scheduleDatabaseIds,
  todoDatabaseIds,
  scheduleUnresolved,
  todoUnresolved,
}: HomeClientProps) {
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);
  const [notificationGate, setNotificationGate] = useState<NotificationGateStatus>('checking');

  const [weather, setWeather] = useState<any>({
    text: '読み込み中...',
    icon: CloudyIcon,
    temp: '--',
    windSpeed: '--',
    pop: '--',
    tomorrow: {
      text: '',
      icon: CloudyIcon,
      temp: '--',
      pop: '--'
    }
  });

  // 画面に選択された地域名を表示するためのState（デフォルトは大阪）
  const [currentRegionName, setCurrentRegionName] = useState('Osaka');

  // 画面に選択されたジャンル名を表示するためのState
  const [currentCategoryName, setCurrentCategoryName] = useState('総合');

  const [newsArticles, setNewsArticles] = useState<any[]>([
    { title: 'ニュースを読み込み中...', url: '#' },
    { title: 'しばらくお待ちください...', url: '#' }
  ]);

  const [projectActivities, setProjectActivities] = useState<any[]>([
    { name: '読み込み中...', action: '', time: '--', status: 'offline' }
  ]);

  // 現在表示中のリポジトリ名を画面（JSX）に反映するためのState
  const [currentRepoName, setCurrentRepoName] = useState('読み込み中...');

  // Notion「スケジュール」データベースから取得した予定（現在時刻〜6時間後）
  const [scheduleDateLabel, setScheduleDateLabel] = useState('');
  const [scheduleTimeMarkers, setScheduleTimeMarkers] = useState(['--:--', '--:--', '--:--', '--:--']);
  const [scheduleEvents, setScheduleEvents] = useState<any[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleError, setScheduleError] = useState('');
  const [currentTimePercent, setCurrentTimePercent] = useState<number | null>(null);

  // Notion「進捗管理」データベースから取得したタスク一覧
  const [todoTasks, setTodoTasks] = useState<any[]>([]);
  const [todoLoading, setTodoLoading] = useState(true);
  const [todoError, setTodoError] = useState('');

  useEffect(() => {
    setIsMounted(true);

    // 通知の許可・拒否のどちらかが決まるまでホーム画面を表示しない強制ゲート。
    // 一度決まっていれば（拒否でも）ホームへ進める。非対応ブラウザは素通しする。
    if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) {
      setNotificationGate('passed');
    } else if (Notification.permission === 'default') {
      setNotificationGate('blocked');
    } else {
      setNotificationGate('passed');
      if (Notification.permission === 'granted') {
        autoSubscribeToPush().catch((error) => {
          console.error('プッシュ通知の自動購読に失敗:', error);
        });
      }
    }

    setTimeout(() => {
      // --- 天気APIの取得 ---
      const savedRegionName = localStorage.getItem('setting_weatherName') || 'Osaka';
      const savedLat = localStorage.getItem('setting_weatherLat') || '34.6937';
      const savedLon = localStorage.getItem('setting_weatherLon') || '135.5023';
      setCurrentRegionName(savedRegionName);

      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${savedLat}&longitude=${savedLon}&current=temperature_2m,weather_code,surface_pressure,wind_speed_10m&hourly=precipitation_probability&daily=weather_code,temperature_2m_max,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=2`;

      fetch(weatherUrl)
        .then((res) => res.json())
        .then((data) => {
          if (data && data.current) {
            const currentDecoded = decodeWeather(data.current.weather_code);
            const currentHour = new Date().getHours();
            const currentPop = data.hourly?.precipitation_probability?.[currentHour] ?? '--';
            const tomorrowWeatherCode = data.daily?.weather_code?.[1] ?? 0;
            const tomorrowDecoded = decodeWeather(tomorrowWeatherCode);
            const tomorrowMaxTemp = data.daily?.temperature_2m_max?.[1] ?? '--';
            const tomorrowPop = data.daily?.precipitation_probability_max?.[1] ?? '--';

            setWeather({
              text: currentDecoded.text,
              icon: currentDecoded.icon,
              temp: `${Math.round(data.current.temperature_2m)}°C`,
              windSpeed: `${data.current.wind_speed_10m} m/s`,
              pop: `${currentPop}%`,
              tomorrow: {
                text: tomorrowDecoded.text,
                icon: tomorrowDecoded.icon,
                temp: `${Math.round(tomorrowMaxTemp)}°C`,
                pop: `${tomorrowPop}%`
              }
            });
          }
        })
        .catch(() => setWeather({
          text: 'エラー',
          icon: CloudyIcon,
          temp: '--',
          windSpeed: '--',
          pop: '--',
          tomorrow: { text: 'エラー', icon: CloudyIcon, temp: '--', pop: '--' }
        }));

      // --- ニュースAPIの取得 ---
      const savedCategory = localStorage.getItem('setting_newsCategory') || 'general';
      setCurrentCategoryName(CATEGORY_NAMES[savedCategory] || '総合');
      const cacheData = localStorage.getItem('cache_newsData');
      const cacheTimestamp = localStorage.getItem('cache_newsTimestamp');
      const now = new Date().getTime();
      const CACHE_LIMIT = 60 * 60 * 1000;

      if (cacheData && cacheTimestamp && now - parseInt(cacheTimestamp) < CACHE_LIMIT) {
        setNewsArticles(JSON.parse(cacheData));
      } else {
        fetch(`/api/news?category=${savedCategory}`)
          .then((res) => res.json())
          .then((data) => {
            if (data && data.articles && data.articles.length > 0) {
              const articles = data.articles.map((article: any) => ({
                title: article.title,
                url: article.url
              }));
              setNewsArticles(articles);
              localStorage.setItem('cache_newsData', JSON.stringify(articles));
              localStorage.setItem('cache_newsTimestamp', now.toString());
            } else {
              setNewsArticles([{ title: 'ニュースが見つかりませんでした', url: '#' }]);
            }
          })
          .catch(() => {
            if (cacheData) setNewsArticles(JSON.parse(cacheData));
          });
      }

      // GitHub設定のチェック & 実際のデータフェッチ
      const savedRepo = localStorage.getItem('setting_githubRepo'); // デフォルト値の `|| '...'` を削除しました

      // 未設定（空っぽ）の場合の処理
      if (!savedRepo) {
        console.log("GitHubリポジトリが設定されていません。");
        setCurrentRepoName("未設定");
        setProjectActivities([{ name: 'リポジトリが設定されていません', action: '設定画面から登録してください', time: '--', status: 'offline' }]);
      }
      // 設定されているが、形式が「ユーザー名/リポジトリ名」として正しいかチェック
      else if (savedRepo.includes('/') && savedRepo.split('/')[0] && savedRepo.split('/')[1]) {
        const repoTitle = savedRepo.split('/')[1];
        setCurrentRepoName(repoTitle); // カードのタイトルにはリポジトリ名だけを表示

        // 実際にGitHubからコミット履歴を取得する
        fetch(`https://api.github.com/repos/${savedRepo}/commits`)
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            return res.json();
          })
          .then((commits) => {
            if (commits && Array.isArray(commits) && commits.length > 0) {
              const formattedActivities = commits.slice(0, 5).map((item: any) => {
                const authorName = item.author?.login || item.commit?.author?.name || 'Unknown';
                const commitDate = item.commit?.author?.date || new Date().toISOString();

                return {
                  name: authorName,
                  action: 'コードをコミット',
                  time: formatLastActivity(commitDate),
                  status: 'online'
                };
              });
              setProjectActivities(formattedActivities);
            } else {
              setProjectActivities([{ name: 'コミット履歴なし', action: '', time: '--', status: 'offline' }]);
            }
          })
          .catch((err) => {
            console.error('GitHubデータの取得に失敗:', err);
            setProjectActivities([{ name: '読み込み失敗', action: 'API制限またはリポジトリが見つかりません', time: '--', status: 'offline' }]);
          });
      }
      // スラッシュが入っていないなど、入力が不完全な場合
      else {
        setCurrentRepoName("設定不完全");
        setProjectActivities([{ name: '設定不完全', action: '「ユーザー名/リポジトリ名」の形で正しく入力してください', time: '--', status: 'offline' }]);
      }

      // Notion「スケジュール」データベースから予定を取得（今日〜明日の2日間）
      const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
      const formatHHMM = (date: Date) =>
        `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

      const scheduleWindowStart = new Date();
      scheduleWindowStart.setMinutes(0, 0, 0);
      const scheduleWindowEnd = new Date(scheduleWindowStart.getTime() + 24 * 60 * 60 * 1000);
      const scheduleWindowMs = scheduleWindowEnd.getTime() - scheduleWindowStart.getTime();

      const endDate = new Date(scheduleWindowEnd);
      setScheduleDateLabel(
        `${scheduleWindowStart.getMonth() + 1}月${scheduleWindowStart.getDate()}日 ${String(scheduleWindowStart.getHours()).padStart(2, '0')}:00 〜 ${endDate.getMonth() + 1}月${endDate.getDate()}日 ${String(endDate.getHours()).padStart(2, '0')}:00`
      );
      setScheduleTimeMarkers(
        [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24].map((hourOffset) =>
          formatHHMM(new Date(scheduleWindowStart.getTime() + hourOffset * 60 * 60 * 1000))
        )
      );

      const scheduleDbIds = Array.isArray(scheduleDatabaseIds) ? scheduleDatabaseIds.filter(Boolean) : [];

      if (scheduleUnresolved || scheduleDbIds.length === 0) {
        setScheduleError('Notionで「スケジュール」という名前のデータベースを連携すると、ここに表示されます');
        setScheduleLoading(false);
      } else {
        const fetchDatabaseResults = async (databaseId: string) => {
          const res = await fetch('/api/notion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              databaseId,
              searchType: 'database',
              pageSize: 50,
            }),
          });

          if (res.status === 401) {
            router.push('/login');
            throw new Error('NOTION_UNAUTHORIZED');
          }
          if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

          const data = await res.json();
          return Array.isArray(data.results) ? data.results : [];
        };

        Promise.allSettled(scheduleDbIds.map(fetchDatabaseResults))
          .then((results) => {
            const rawResults = results.flatMap((result, index) => {
              if (result.status === 'fulfilled') return result.value;
              if (result.reason?.message === 'NOTION_UNAUTHORIZED') return [];
              console.error(`NotionスケジュールDBの取得に失敗: ${scheduleDbIds[index]}`, result.reason);
              return [];
            });

            const parseNotionDate = (value: string) => {
              // 日付のみ（例: "2026-07-09"）はUTC 0時として解釈されてしまうため、
              // ローカル日付として明示的に組み立てる
              const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
              if (dateOnlyMatch) {
                const [, y, m, d] = dateOnlyMatch;
                return { date: new Date(Number(y), Number(m) - 1, Number(d)), isDateOnly: true };
              }
              return { date: new Date(value), isDateOnly: false };
            };

            const events = rawResults
              .map((item: any) => {
                // プロパティ名が「日時」でない場合に備え、date型（{start, end}を持つ値）を持つプロパティを探す
                const dateProp =
                  item.properties?.['日時'] ??
                  Object.values(item.properties ?? {}).find(
                    (value: any) => value && typeof value === 'object' && typeof value.start === 'string'
                  );
                if (!dateProp || !dateProp.start) return null;
                const { date: start, isDateOnly } = parseNotionDate(dateProp.start);
                const end = dateProp.end
                  ? parseNotionDate(dateProp.end).date
                  : isDateOnly
                  ? new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59)
                  : new Date(start.getTime() + 60 * 60 * 1000);
                const label = item.properties?.['予定'] || item.title || '無題';
                return { id: item.id, label, start, end };
              })
              .filter((event: any) => event && event.end > scheduleWindowStart && event.start < scheduleWindowEnd)
              .sort((a: any, b: any) => a.start.getTime() - b.start.getTime())
              .map((event: any) => {
                const clampedStart = event.start < scheduleWindowStart ? scheduleWindowStart : event.start;
                const clampedEnd = event.end > scheduleWindowEnd ? scheduleWindowEnd : event.end;
                const leftPercent = ((clampedStart.getTime() - scheduleWindowStart.getTime()) / scheduleWindowMs) * 100;
                const widthPercent = Math.max(
                  ((clampedEnd.getTime() - clampedStart.getTime()) / scheduleWindowMs) * 100,
                  12
                );
                return {
                  id: event.id,
                  label: `${formatHHMM(event.start)} - ${event.label}`,
                  leftPercent,
                  widthPercent,
                };
              });

            setScheduleEvents(events);

            const now = new Date();
            const currentTimePercent = ((now.getTime() - scheduleWindowStart.getTime()) / scheduleWindowMs) * 100;
            const isCurrentTimeInRange = now >= scheduleWindowStart && now <= scheduleWindowEnd;

            if (isCurrentTimeInRange && currentTimePercent >= 0 && currentTimePercent <= 100) {
              setCurrentTimePercent(currentTimePercent);
            } else {
              setCurrentTimePercent(null);
            }

            setScheduleLoading(false);
          })
          .catch((err) => {
            if (err?.message === 'NOTION_UNAUTHORIZED') return;
            console.error('Notionスケジュールの取得に失敗:', err);
            setScheduleError('読み込みに失敗しました');
            setScheduleLoading(false);
          });
      }

      // Notion「進捗管理」データベースからタスクを取得
      const todoDbIds = Array.isArray(todoDatabaseIds) ? todoDatabaseIds.filter(Boolean) : [];

      if (todoUnresolved || todoDbIds.length === 0) {
        setTodoError('Notionで「進捗管理」という名前のデータベースを連携すると、ここに表示されます');
        setTodoLoading(false);
      } else {
        const fetchDatabaseResults = async (databaseId: string) => {
          const res = await fetch('/api/notion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              databaseId,
              searchType: 'database',
              pageSize: 50,
            }),
          });

          if (res.status === 401) {
            router.push('/login');
            throw new Error('NOTION_UNAUTHORIZED');
          }
          if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

          const data = await res.json();
          return Array.isArray(data.results) ? data.results : [];
        };

        Promise.allSettled(todoDbIds.map(fetchDatabaseResults))
          .then((results) => {
            const rawResults = results.flatMap((result, index) => {
              if (result.status === 'fulfilled') return result.value;
              if (result.reason?.message === 'NOTION_UNAUTHORIZED') return [];
              console.error(`NotionタスクDBの取得に失敗: ${todoDbIds[index]}`, result.reason);
              return [];
            });

            const tasksList = rawResults
              .map((item: any) => {
                const statusName = item.properties?.['ステータス']?.name || '';
                const dueDate = item.properties?.['期日']?.start || null;
                return {
                  id: item.id,
                  name: item.properties?.['タスク名'] || item.title || '無題',
                  done: statusName === '完了',
                  status: statusName,
                  overdue: Boolean(item.properties?.['期限超過']),
                  dueDate,
                };
              })
              .filter((task: any) => task.status !== '完了')
              .sort((a: any, b: any) => {
                if (!a.dueDate) return 1;
                if (!b.dueDate) return -1;
                return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
              })
              .slice(0, 12);

            console.log('Notionタスクの取得結果:', tasksList);

            setTodoTasks(tasksList);
            setTodoLoading(false);
          })
          .catch((err) => {
            if (err?.message === 'NOTION_UNAUTHORIZED') return;
            console.error('Notionタスクの取得に失敗:', err);
            setTodoError('読み込みに失敗しました');
            setTodoLoading(false);
          });
      }
    }, 0); // 0秒ディレイで画面描画の直後に実行

  }, [router, scheduleDatabaseIds, todoDatabaseIds, scheduleUnresolved, todoUnresolved]);

  // ポップアップのボタン用：ブラウザのネイティブ許可ダイアログを表示させ、
  // 「許可」「拒否」どちらが選ばれてもホームへ進む（未決定のまま進めることだけを防ぐ）
  const handleEnableNotifications = async () => {
    await autoSubscribeToPush();
    setNotificationGate('passed');
  };

  if (!isMounted || notificationGate === 'checking') {
    return <div className={styles.container} style={{ background: '#3b3a4e' }}></div>;
  }

  if (notificationGate !== 'passed') {
    return (
      <div className={styles.container}>
        <div className={styles.notificationGateOverlay}>
          <div className={styles.notificationGateCard}>
            <p>予定やタスクのリマインドを受け取るために、通知の許可・拒否を選択してください。</p>
            <button type="button" onClick={handleEnableNotifications} className={styles.notificationBannerBtn}>
              通知の設定をする
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Link href="/settings" className={styles.iconBtn} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px' }}>
          <SettingsIcon size={20} color="#a9a9a9" />
        </Link>
      </div>

      {/* モックアップ用の2カラム全体グリッド */}
      <div className={styles.mainGrid}>

        {/* 左カラム（AI、天気、GitHub） */}
        <div className={styles.leftColumn}>

          {/* AIチャットカード「Noir」 */}
          <Link href="/chat" className={styles.aiChatFullCard}>
            <div className={styles.chatLinkContentRow}>
              <span className={styles.chatTextLarge}>Noir</span>
            </div>
          </Link>

          {/* 天気予報 */}
          <div className={`${styles.card} ${styles.weatherCard}`}>
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
              <div>
                <a
                  href="https://weathernews.jp/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.cardTitle}
                  style={{ textDecoration: 'none', color: '#e5c158', cursor: 'pointer', display: 'inline-block' }}
                >
                  Weather ({currentRegionName})
                </a>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '6px 0' }}>
                  <div style={{ width: '28px', height: '28px' }}>
                    <weather.icon size={28} color="#e5c158" />
                  </div>
                  <p className={styles.weatherInfo}>{weather.text}</p>
                </div>
                <p className={styles.weatherDetail} style={{ fontSize: '1rem', fontWeight: 'bold', margin: '2px 0 6px 0' }}>{weather.temp}</p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '4px', paddingBottom: '4px' }}>
                <p className={styles.weatherDetail} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '16px', height: '16px', display: 'flex', alignItems: 'center' }}>
                    <DropIcon size={16} color="#87ceeb" />
                  </span>
                  降水確率: {weather.pop}
                </p>
                <p className={styles.weatherDetail} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '16px', height: '16px', display: 'flex', alignItems: 'center' }}>
                    <WindIcon size={16} color="#87ceeb" />
                  </span>
                  風速: {weather.windSpeed}
                </p>
              </div>

              {weather.tomorrow.text && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '6px', marginTop: '2px' }}>
                  <p className={styles.weatherDetail} style={{ opacity: 0.6, fontSize: '0.65rem', marginBottom: '2px' }}>明日の予報</p>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <div style={{ width: '20px', height: '20px' }}>
                        <weather.tomorrow.icon size={20} color="#e5c158" />
                      </div>
                      <span>{weather.tomorrow.text}</span>
                    </div>
                    <span>{weather.tomorrow.temp} ({weather.tomorrow.pop})</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* GitHubプロジェクトアクティビティ */}
          <div className={styles.githubFullCard}>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.githubTitle}
              style={{ textDecoration: 'none', color: '#e5c158', cursor: 'pointer', display: 'inline-block' }}
            >
              GitHub ({currentRepoName})
            </a>
            <p className={styles.githubSub}>last activity</p>
            <p className={styles.githubSub}>Member</p>
            <div className={styles.memberList}>
              {projectActivities.map((activity, index) => (
                <div key={index} className={styles.memberItem}>
                  <div className={styles.memberMain}>
                    <span className={`${styles.statusDot} ${styles[activity.status]}`}></span>
                    <span>{activity.name}</span>
                    {activity.action && <span style={{ fontSize: '0.75rem', fontWeight: 'normal', opacity: 0.8 }}>({activity.action})</span>}
                  </div>
                  <span className={styles.lastActivity}>Last activity: {activity.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 右カラム（Quick link、スケジュールエリア、ニュース） */}
        <div className={styles.rightColumn}>

          {/* スケジュールとToDoを横に並べる中間グリッド */}
          <div className={styles.scheduleTodoGrid}>

            {/* スケジュール（Notionの「スケジュール」データベースから現在時刻から24時間の予定を取得） */}
            <div className={styles.scheduleCard}>
              <a
                href="https://calendar.notion.so"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.scheduleTitle}
                style={{ textDecoration: 'none', cursor: 'pointer', display: 'inline-block' }}
              >
                Schedule
              </a>
              <p className={styles.scheduleDate}>{scheduleDateLabel}</p>

              <div className={styles.timelineContainer}>
                <div className={styles.timelineHeader}>
                  {scheduleTimeMarkers.map((label, index) => (
                    <span key={index}>{label}</span>
                  ))}
                </div>
                <div className={styles.timelineBarWrapper} style={{ position: 'relative' }}>
                  {scheduleLoading ? (
                    <p className={styles.notionStatus}>読み込み中...</p>
                  ) : scheduleError ? (
                    <p className={styles.notionStatus}>{scheduleError}</p>
                  ) : scheduleEvents.length === 0 ? (
                    <p className={styles.notionStatus}>予定はありません</p>
                  ) : (
                    scheduleEvents.map((event) => (
                      <div
                        key={event.id}
                        className={styles.timelineBar}
                        style={{ marginLeft: `${event.leftPercent}%`, width: `${event.widthPercent}%` }}
                      >
                        {event.label}
                      </div>
                    ))
                  )}
                  {currentTimePercent !== null && (
                    <div
                      style={{
                        position: 'absolute',
                        left: `${currentTimePercent}%`,
                        top: 0,
                        bottom: 0,
                        width: '3px',
                        backgroundColor: '#ff6b6b',
                        boxShadow: '0 0 8px rgba(255, 107, 107, 0.8)',
                        zIndex: 10,
                        borderRadius: '2px',
                        transform: 'translateX(-50%)'
                      }}
                      title={`現在時刻`}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* ToDo（Notionの「進捗管理」データベースから取得） */}
            <div className={styles.todoCard}>
              <a
                href="https://notion.so/38fa15fda3c180bd98d9ddcfe8406a93"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.todoTitle}
                style={{ textDecoration: 'none', cursor: 'pointer', display: 'inline-block' }}
              >
                ToDo
              </a>
              {todoLoading ? (
                <p className={styles.notionStatus}>読み込み中...</p>
              ) : todoError ? (
                <p className={styles.notionStatus}>{todoError}</p>
              ) : todoTasks.length === 0 ? (
                <p className={styles.notionStatus}>タスクはありません</p>
              ) : (
                <>
                  <div className={styles.todoList}>
                    {todoTasks.slice(0, 5).map((task) => (
                      <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'space-between', width: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                          <span
                            className={task.done ? styles.completed : ''}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.name}</span>
                            {task.overdue && (
                              <span style={{ width: '16px', height: '16px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                                <AlertIcon size={16} color="#ff6b6b" />
                              </span>
                            )}
                          </span>
                          {task.dueDate && (
                            <span style={{ fontSize: '0.85rem', opacity: 0.8, whiteSpace: 'nowrap', minWidth: '90px', textAlign: 'right' }}>
                              {new Date(task.dueDate).getMonth() + 1}月{new Date(task.dueDate).getDate()}日
                            </span>
                          )}
                        </div>
                        <select
                          value={task.status || ''}
                          onChange={async (e) => {
                            try {
                              const newStatus = e.target.value;
                              await fetch('/api/notion', {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  pageId: task.id,
                                  status: newStatus,
                                }),
                              });

                              setTodoTasks((prevTasks) =>
                                prevTasks.map((t) =>
                                  t.id === task.id ? { ...t, status: newStatus, done: newStatus === '完了' } : t
                                )
                              );
                            } catch (error) {
                              console.error('ステータス更新に失敗しました:', error);
                            }
                          }}
                          style={{
                            padding: '6px 10px',
                            borderRadius: '4px',
                            border: '1px solid #e5c158',
                            backgroundColor: 'rgba(51, 65, 85, 0.8)',
                            color: '#ffffff',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontFamily: 'inherit',
                            minWidth: '120px',
                            flexShrink: 0,
                          }}
                        >
                          <option value="未着手">未着手</option>
                          <option value="進行中">進行中</option>
                          <option value="完了">完了</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ニュース */}
          <div className={styles.newsCard}>
            <a
              href="https://news.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.cardTitle}
              style={{ fontSize: '1rem', opacity: 1, textDecoration: 'none', color: '#e5c158', cursor: 'pointer', display: 'inline-block' }}
            >
              News
            </a>
            <ul className={styles.newsList}>
              {newsArticles.map((article, index) => (
                <li key={index} className={styles.newsItem}>
                  {article.url && article.url !== '#' ? (
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.newsLink}
                    >
                      • {article.title}
                    </a>
                  ) : (
                    <span>{article.title}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

      </div>
    </div>
  );
}
