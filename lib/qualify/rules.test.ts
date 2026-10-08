import { describe, expect, it } from "vitest";
import { defaultQualifyConfig } from "./config";
import { checkCategory, checkCommercialSize, checkEngagement, checkTimeline } from "./rules";
import { CALL_AT, makeLead } from "./test-helpers";

const cfg = defaultQualifyConfig();

describe("excluded categories", () => {
  it.each(["restaurant", "cafe", "hotel", "retail", "gym"] as const)("declines %s", (category) => {
    const r = checkCategory(makeLead({ project_type: "commercial", category }));
    expect(r.status).toBe("fail");
    expect(r.declineReason).toBe("category");
  });

  it.each(["apartment", "villa", "office", "clinic", "studio", "coworking"] as const)("allows %s", (category) => {
    expect(checkCategory(makeLead({ category })).status).toBe("pass");
  });
});

describe("excluded engagements", () => {
  it.each(["advice_only", "decor_only", "furniture_sourcing_only", "vastu_only", "self_execution", "structural"] as const)(
    "declines %s",
    (engagement) => {
      const r = checkEngagement(makeLead({ engagement }));
      expect(r.status).toBe("fail");
      expect(r.declineReason).toBe("engagement");
    },
  );

  it("declines a design+execution request that also needs structural work", () => {
    expect(checkEngagement(makeLead({ structural_work_requested: true })).status).toBe("fail");
  });

  it("is unclear when the engagement is unknown", () => {
    expect(checkEngagement(makeLead({ engagement: "unknown" })).status).toBe("unclear");
  });
});

describe("commercial size", () => {
  const commercial = (carpet_sqft: number | null) =>
    makeLead({ project_type: "commercial", category: "office", scope_kind: "commercial_fitout", carpet_sqft });

  it("declines above 3,000 sq ft", () => {
    expect(checkCommercialSize(commercial(3001), cfg).status).toBe("fail");
  });

  it("accepts exactly 3,000 and exactly the minimum", () => {
    expect(checkCommercialSize(commercial(3000), cfg).status).toBe("pass");
    expect(checkCommercialSize(commercial(500), cfg).status).toBe("pass");
  });

  it("sends below-minimum to review while the minimum is unconfirmed (T18)", () => {
    expect(checkCommercialSize(commercial(180), cfg).status).toBe("soft_fail");
  });

  it("hard-declines below-minimum once the founder switches mode to decline", () => {
    const r = checkCommercialSize(commercial(180), defaultQualifyConfig({ commercialMinSqftMode: "decline" }));
    expect(r.status).toBe("fail");
    expect(r.declineReason).toBe("commercial_size");
  });

  it("does not cap residential size", () => {
    expect(checkCommercialSize(makeLead({ carpet_sqft: 5500 }), cfg).status).toBe("pass");
  });

  it("is unclear when commercial area is unknown", () => {
    expect(checkCommercialSize(commercial(null), cfg).status).toBe("unclear");
  });
});

describe("timeline", () => {
  // CALL_AT = 2026-10-07 (Wednesday)
  it("declines a 3-week deadline", () => {
    const r = checkTimeline(makeLead({ completion_by: "2026-10-28" }), cfg, CALL_AT);
    expect(r.status).toBe("fail");
    expect(r.declineReason).toBe("timeline");
  });

  it("declines just under 6 weeks", () => {
    expect(checkTimeline(makeLead({ completion_by: "2026-11-17" }), cfg, CALL_AT).status).toBe("fail");
  });

  it("accepts 6 weeks or more", () => {
    expect(checkTimeline(makeLead({ completion_by: "2026-11-19" }), cfg, CALL_AT).status).toBe("pass");
  });

  it("passes when no deadline is stated", () => {
    const r = checkTimeline(makeLead({ completion_by: null, timeline_text: null }), cfg, CALL_AT);
    expect(r.status).toBe("pass");
  });

  it("accepts a site available within 10 weeks (T15: possession in 6 weeks)", () => {
    const r = checkTimeline(makeLead({ completion_by: null, site_available_from: "2026-11-18" }), cfg, CALL_AT);
    expect(r.status).toBe("pass");
  });

  it("sends a site only available after 10 weeks to review, not decline", () => {
    const r = checkTimeline(makeLead({ completion_by: null, site_available_from: "2027-02-01" }), cfg, CALL_AT);
    expect(r.status).toBe("soft_fail");
  });
});
