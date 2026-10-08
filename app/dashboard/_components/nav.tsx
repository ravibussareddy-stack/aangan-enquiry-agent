"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const ICONS: Record<string, React.ReactNode> = {
  overview: (
    <svg viewBox="0 0 24 24" {...stroke}><path d="M21 12a9 9 0 1 1-9-9v9z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15z" /></svg>
  ),
  review: (
    <svg viewBox="0 0 24 24" {...stroke}><path d="M9 11l2.5 2.5L16 9" /><rect x="3.5" y="3.5" width="17" height="17" rx="5" /></svg>
  ),
  leads: (
    <svg viewBox="0 0 24 24" {...stroke}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.6.8 2.6 2.6 3 5.2" /></svg>
  ),
  messages: (
    <svg viewBox="0 0 24 24" {...stroke}><path d="M4 5.5h16v10H9l-5 4z" /></svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
  ),
  signout: (
    <svg viewBox="0 0 24 24" {...stroke}><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M10 16l-4-4 4-4M6 12h10" /></svg>
  ),
};

export function Nav({ founder }: { founder: boolean }) {
  const path = usePathname();
  const items = [
    ...(founder ? [{ href: "/dashboard", label: "Overview", icon: "overview" }] : []),
    { href: "/dashboard/review", label: "Review queue", icon: "review" },
    { href: "/dashboard/leads", label: "Leads", icon: "leads" },
    { href: "/dashboard/messages", label: "Messages", icon: "messages" },
    ...(founder ? [{ href: "/dashboard/settings", label: "Settings", icon: "settings" }] : []),
  ];
  return (
    <nav aria-label="Dashboard">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          title={i.label}
          aria-label={i.label}
          aria-current={(i.href === "/dashboard" ? path === i.href : path.startsWith(i.href)) ? "page" : undefined}
        >
          {ICONS[i.icon]}
        </Link>
      ))}
    </nav>
  );
}

export function SignOutIcon() {
  return ICONS.signout;
}
