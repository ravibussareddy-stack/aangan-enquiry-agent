"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Nav({ founder }: { founder: boolean }) {
  const path = usePathname();
  const items = [
    ...(founder ? [{ href: "/dashboard", label: "Overview" }] : []),
    { href: "/dashboard/review", label: "Review queue" },
    { href: "/dashboard/leads", label: "Leads" },
    { href: "/dashboard/messages", label: "Messages" },
    ...(founder ? [{ href: "/dashboard/settings", label: "Settings" }] : []),
  ];
  return (
    <nav className="nav" aria-label="Dashboard">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={(i.href === "/dashboard" ? path === i.href : path.startsWith(i.href)) ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
