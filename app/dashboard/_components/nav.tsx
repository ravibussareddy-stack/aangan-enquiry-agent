"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const ICONS: Record<string, React.ReactNode> = {
  today: (
    <svg viewBox="0 0 24 24" {...stroke}><path d="M4 11.5 12 5l8 6.5" /><path d="M6 10v9h12v-9" /><path d="M10 19v-5h4v5" /></svg>
  ),
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
  designer: (
    <svg viewBox="0 0 24 24" {...stroke}><path d="M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z" /><path d="M13.5 7.5l3 3" /></svg>
  ),
  desk: (
    <svg viewBox="0 0 24 24" {...stroke}><path d="M5 4.5h3l1.5 4-2 1.2a10 10 0 0 0 6.8 6.8l1.2-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6.5a2 2 0 0 1 2-2z" /></svg>
  ),
  mic: (
    <svg viewBox="0 0 24 24" {...stroke}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>
  ),
  signout: (
    <svg viewBox="0 0 24 24" {...stroke}><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M10 16l-4-4 4-4M6 12h10" /></svg>
  ),
};

/** What each page is for — shown in the hover bubble. */
const TIPS: Record<string, string> = {
  "/dashboard": "Your day: safety, suggestions, to-do list and the AI summary",
  "/dashboard/overview": "Pipeline value, booking rate, cost and speed vs the last period",
  "/dashboard/designer": "Consultations, reviews, leads and messages for a designer",
  "/dashboard/desk": "Callbacks, complaints, messages and today's consultations",
  "/dashboard/review": "Enquiries waiting for a designer, admin or helpdesk decision",
  "/dashboard/leads": "Every enquiry the AI handled, with its outcome",
  "/dashboard/messages": "Messages callers left for a designer or the studio",
  "/dashboard/test-call": "Talk to the live AI agent from your browser",
  "/dashboard/settings": "Integrations, qualification rules, wording and rates",
};

export function Nav({ role }: { role: "founder" | "designer" | "frontdesk" }) {
  const path = usePathname();
  const founder = role === "founder";
  const items = [
    ...(founder
      ? [
          { href: "/dashboard", label: "Today", icon: "today" },
          { href: "/dashboard/overview", label: "KPIs", icon: "overview" },
        ]
      : []),
    ...(role !== "frontdesk" ? [{ href: "/dashboard/designer", label: founder ? "Designer view" : "My day", icon: "designer" }] : []),
    ...(role !== "designer" ? [{ href: "/dashboard/desk", label: founder ? "Front desk view" : "Front desk", icon: "desk" }] : []),
    { href: "/dashboard/review", label: role === "frontdesk" ? "Callback queue" : "Review queue", icon: "review" },
    { href: "/dashboard/leads", label: "Leads", icon: "leads" },
    { href: "/dashboard/messages", label: "Messages", icon: "messages" },
    ...(founder ? [{ href: "/dashboard/test-call", label: "Test call", icon: "mic" }] : []),
    ...(founder ? [{ href: "/dashboard/settings", label: "Settings", icon: "settings" }] : []),
  ];
  return (
    <nav aria-label="Dashboard">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          className="has-tip"
          data-label={i.label}
          data-tip={TIPS[i.href] ?? ""}
          aria-label={i.label}
          aria-description={TIPS[i.href]}
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
