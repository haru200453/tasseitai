"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./Nav.module.css";
import { SettingsIcon } from "./icons"; // SettingsIconのみインポート

const HIDDEN_PATHS = ["/login", "/notion-login-popup", "/notion-logout"];

const NAV_ITEMS = [
  { href: "/", label: "ホーム", iconSrc: "/icon-home.png" },
  { href: "/chat", label: "トーク", iconSrc: "/icon-chat.png" },
  { href: "/settings", label: "設定", Icon: SettingsIcon },
];

export default function Nav() {
  const pathname = usePathname();

  if (HIDDEN_PATHS.includes(pathname)) return null;

  return (
    <nav className={styles.nav}>
      {NAV_ITEMS.map((item) => {
        const isActive = item.href === "/" ? pathname === "/" || pathname === "/home" : pathname.startsWith(item.href);
        
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`${styles.navItem} ${isActive ? styles.navItemActive : ""}`}
          >
            {/* 画像(iconSrc)がある場合はimg、ない場合はコンポーネント(Icon)を表示 */}
            {item.iconSrc ? (
              <img 
                src={item.iconSrc} 
                alt={item.label} 
                width={40} 
                height={40}
                style={{ filter: isActive ? 'none' : 'grayscale(100%) opacity(0.6)' }}
              />
            ) : (
              item.Icon && <item.Icon size={22} color={isActive ? "#e5c158" : "#8b8d99"} />
            )}
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}