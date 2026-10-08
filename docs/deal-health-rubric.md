# Deal health rubric

_Generated from `lib/deal-health/score.ts` — edit there, then run `npm run docs:deal-health`._

**What it is:** an estimate of how likely a **qualified or approved** lead is to become a won project. It is scored 0–100 and shown on the dashboard, on each lead, and in HubSpot as the deal's priority (High / Medium / Low).

**Cost:** zero. It's a fixed rubric over fields the call already captured, with no AI call per lead.

| Factor | Max points | How points are given |
|---|---|---|
| Budget fits scope | 20 | Their budget fits the scope 20 · no budget but comfortable with the typical range 15 · tight 10 · not given 5 · not comfortable with the typical range 2 |
| Real, workable timeline | 15 | Deadline 6–26 weeks out, or site ready within 10 weeks 15 · no deadline but site ready 10 · further out / vague 5 |
| Decision-maker on the call | 15 | Caller decides or is authorised 15 · calling for someone else 5 · unknown 3 |
| Committed next step | 15 | Consultation booked 10, +5 if they asked for a site visit |
| Has seen our website / work | 10 | Yes 10 · unknown 3 · no 0 |
| Referred to us | 10 | Referred by a past client, friend or builder 10 · none 0 |
| Scope size | 10 | Full home / villa / office fit-out 10 · 2+ rooms 7 · single room 4 |
| Information captured | 5 | Nothing missing 5 · 1–2 fields missing 2 · 3+ missing 0 |
| At risk (penalty) | −5 | Frustrated repeat caller who wasn't followed up |
| **Total** | **100** | |

**Bands:** High ≥ 70 · Medium 45–69 · Low < 45 (editable in Settings → DEAL_HEALTH_BANDS).

**Budget** is compared with the studio's internal floor, but only the verdict ("fits scope", "tight") is ever shown. The floor figure isn't.

**Calibration:** the weights are a starting point drawn from the September enquiries. In those, referrals, a decider on the call, and a clear timeline marked the strongest leads. Once Won/Lost outcomes come back from HubSpot, the dashboard shows the actual win rate for each band. If High doesn't win clearly more often than Low, adjust the weights.

**Recalculated** when a call is processed, when a review or callback lead is approved, and when a booking is made or changed.
