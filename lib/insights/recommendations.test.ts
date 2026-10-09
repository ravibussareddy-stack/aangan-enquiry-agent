import { describe, expect, it } from "vitest";
import { verifyRecommendations } from "./narrative";
import { withSubject, type Signal } from "./signals";

const signals: Signal[] = [
  { key: "review_overdue", severity: 90, title: "Clear the review queue — 8 leads waiting over 24 hours (oldest 50 h)", why: "", href: "/dashboard/review", figures: [8, 50, 24, 7, 1] },
  { key: "book_top_deal:x", severity: 60, title: "Get {lead} booked — about ₹22 lakh", why: "", href: "/dashboard/leads/x", figures: [22, 100], subject: "Ritu Kapoor" },
];

describe("AI recommendations", () => {
  it("keeps a recommendation whose figures all come from its signal", () => {
    const [r] = verifyRecommendations([{ key: "review_overdue", text: "Review the 8 leads waiting over 24 hours.", figures: [8, 24] }], signals);
    expect(r.verified).toBe(true);
  });

  it("rejects an invented figure, even one only in the text", () => {
    const [r] = verifyRecommendations([{ key: "review_overdue", text: "Review the 12 leads waiting.", figures: [] }], signals);
    expect(r.verified).toBe(false);
  });

  it("drops recommendations for signals that don't exist", () => {
    expect(verifyRecommendations([{ key: "made_up", text: "Do something.", figures: [] }], signals)).toEqual([]);
  });

  it("fills the {lead} placeholder locally — names never go to Gemini", () => {
    expect(withSubject("Get {lead} booked — about ₹22 lakh", signals[1])).toBe("Get Ritu Kapoor booked — about ₹22 lakh");
    expect(withSubject("Get {lead} booked", {})).toBe("Get your biggest open lead booked");
  });
});
