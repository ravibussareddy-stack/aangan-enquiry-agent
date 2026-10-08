# Eval labels — for approval

Cases: `eval/cases/*.json` (transcripts parsed from `seed/enquiries-sep-2026.pdf`; labels from `eval/labels.ts`).
Run: `npm run eval`. CI fails if any labelled **declined** or **complaint** case flips.

## Real phone transcripts

| Case | Label | Reason / flags | Changed from brief? |
|---|---|---|---|
| T01 | qualified | Kothrud 3BHK, 1,400 sq ft, by March | |
| T02 | qualified | Wakad 2BHK · flags: asked about price, decision-maker unclear | |
| T03 | declined | area (Nashik) | |
| T04 | declined | engagement (advice only) — beats "just exploring" | |
| T05 | qualified | Koregaon Park 4BHK · flags: decision-maker unclear, site visit | |
| T06 | qualified | Baner office 800 sq ft, founder | |
| T07 | declined | timeline (Diwali "three weeks away") — see note 1. LLM mode also accepts review/redirect (safe: no booking) | |
| T08 | excluded | missed call, no content | |
| T09 | complaint | existing client, designer unresponsive | |
| T10 | declined | budget: ₹1.5 L vs ₹7 L floor (2 rooms × ₹3.5 L); Kharadi resolves as in area | |
| T11 | qualified | rented Baner 2BHK, no structural work | |
| T12 | qualified | Kalyani Nagar villa · flag: site visit | |
| T13 | qualified | Aundh 3BHK · flag: asked about price | |
| T14 | qualified | Hadapsar · flag: decision-maker unclear (son calling for parents) | |
| T15 | qualified | Undri, possession in 6 weeks | |
| **T16** | **review** | scope never captured in this transcript → criterion 1 unclear · flags: repeat caller, frustrated | **Yes — was qualified.** See note 2. The LLM consistently says qualified; consider reverting. |
| T17 | qualified | Pimple Saudagar; first call dropped | |
| T18 | review | 180 sq ft pod · flag: commercial below minimum — see note 3 | |
| T19 | declined | category (restaurant) | |
| T20 | qualified | Magarpatta 2BHK | |

## Synthetic phone cases (scored separately)

Adapted from the WhatsApp / web-form enquiries, for paths the phone calls never hit.

| Case | From | Label |
|---|---|---|
| S01 | W10 — "just exploring" | redirect |
| S02 | F03 — Talegaon Dabhade | declined (area) |
| S03 | F08 — guests in 3 weeks | declined (timeline) |
| S04 | Wagholi (adjoining, not allowlisted) | review (area unclear) |
| S05 | F02 + volunteered ₹6 L for 2 rooms | qualified (budget tight) |
| S06 | W07 — gym | declined (category) |
| S07 | W03 — Hindi/English code-mixed | qualified |
| S08 | temple hall (no hard rule; agent 0.85 out of scope) | declined (out of scope) |

## Notes

1. **T07 / Diwali.** The front desk said Diwali was "about three weeks away" on 8 Sept. Diwali 2026 is 8 Nov — about 9 weeks away, which would *pass* the 6-week rule. I labelled the case as recorded. In live calls the agent will resolve festival dates from the calendar, so a real "before Diwali" caller on 8 Sept would pass the hard rule. Design (3–4 weeks) plus execution (8+ weeks) still couldn't finish by then, so the rule may need to be stricter. **Founder call:** keep "at least 6 weeks" (services.md), or use "design + minimum execution time" (about 11 weeks)?
2. **T16.** The caller only says "my 3BHK in Viman Nagar". Scope, timeline and engagement are never stated, so under the rubric criterion 1 is unclear and the lead goes to review. In a live call the agent asks the scope question (step 3) and the lead would qualify. If you'd rather the eval measure "would this caller have qualified", I'll switch it back.
3. **T18** is review only while `COMMERCIAL_MIN_SQFT` is unconfirmed. Once the founder confirms 500 sq ft and sets `COMMERCIAL_MIN_SQFT_MODE = decline`, T18 becomes **declined (commercial_size)**. The eval test checks this.
4. **Fixture mode tests the decision logic, not the LLM.** These goldens are what a correct extraction *should* say. Phase 3 adds `--mode llm`, which extracts from the raw transcript and scores against the same labels. That is the real accuracy number, and the one used to calibrate `SCOPE_THRESHOLD`.
