# Phone enquiry intake sheet

_Generated from `lib/intake/sheet.ts` — edit there, then run `npm run docs:intake`._

Every enquiry call works through this sheet. Callers often don't volunteer details, so the agent asks for each field, combining two related questions where it sounds natural. The server tracks what's captured and won't let the agent decide while required fields are still unasked.

**If the caller doesn't know or won't say,** that's fine. The agent acknowledges it, marks the field "not known", and moves on. It never pushes or asks twice. To protect the 5-minute limit, the server sends the agent back for missing fields at most twice, and never after the 4:15 wrap-up point. Whatever is still missing goes to the designer as **"Not captured on the call: …"**.

**Never invented:** name, callback time, budget and dates must come from the caller's own words. The server rejects a callback time the caller didn't say.

| # | Field | What the agent asks | Required | Rubric criterion | Why it matters |
|---|---|---|---|---|---|
| 1 | **Caller name** | May I have your name, please? | Always | — | Booking, SMS confirmation and the designer's first call. |
| 2 | **Why they're calling** | What can I help you with today — a new project, something about an existing project, or reaching a particular designer? | Always | — | Routes the call: new enquiries go through this sheet; existing-project issues get a senior callback; updates and named-designer requests become a message; anything else goes to the helpdesk. |
| 3 | **What they want done** | What would you like done — which rooms or areas, and are you looking for full design and execution? | Always | real project | Criterion 1 (real project) and the excluded-engagement rule (advice-only, decor-only, Vastu-only, structural). |
| 4 | **Type of space** | Is this for a home, or an office, clinic or studio? | Always | — | Residential vs commercial rules; excluded categories (restaurant, hotel, retail, gym). |
| 5 | **Locality** | Which area is it in — so we can confirm we cover it and match you with a nearby designer? | Always | area | Criterion 2 (service area: Pune city + PCMC). |
| 6 | **PIN code** | And the PIN code? | Always | area | Confirms the service area when the locality name is ambiguous or unfamiliar. |
| 7 | **Size of the area to be done** | Roughly how big is the area we'd be working on — its carpet area, or how many rooms? | Always | — | Commercial size limits; scope for the designer. |
| 8 | **Site status / possession** | Is the site available to work on now, or are you waiting for possession? | Always | timeline | Criterion 3: the site must be available for execution within 8–10 weeks. |
| 9 | **When it must be complete** | When would you need the project complete? | Always | timeline | Criterion 3 and the 6-week minimum lead time. "No fixed deadline" is a valid answer. |
| 10 | **Decision-maker** | Will you be the one deciding on this, or is someone else involved? | Always | decision maker | Criterion 5. Never pushed — an unclear answer is flagged for the designer. |
| 11 | **Ballpark budget** | Do you have a ballpark budget in mind for this? | If ASK_BUDGET is on | budget | Criterion 4 and deal health. Repeated back to confirm (speech recognition confuses 1.5 and 15 lakh). Asked on every call while ASK_BUDGET is on; a refusal is accepted. |
| 12 | **Seen our website / work** | Have you had a chance to look at our website or any of our past work? | Always | — | Deal health: callers who've already looked at the studio's work convert better. Any referral mentioned is noted too. |
| 13 | **General free times** | When are you generally free to take a call? | Review / redirect leads | — | Review, callback and redirect leads get a call back as soon as possible — no time is promised; the caller's usual free times help the team reach them. Must come from the caller. |
| 14 | **Site visit wanted** | Would you like the first consultation at your site? | Optional | — | Chooses the site-visit event type when booking. |

## Shortcuts
- **Hard decline early:** if what they want is clearly out of scope (restaurant, gym, advice only, outside Pune/PCMC…), the agent closes politely without collecting the rest.
- **Existing-client complaint:** apologise, promise a senior callback within 15 minutes, escalate, end. No intake needed.
- **Price questions** never count against the caller and never get a figure.
