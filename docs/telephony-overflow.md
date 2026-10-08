# AI answers only when staff can't (overflow mode)

The AI agent costs about ₹5 per minute, so it should only take calls the front desk can't. This is set up **on the studio's phone line**, not in code. `ANSWER_MODE` in Settings only records the intent and labels each call.

## Routing

| When | What happens |
|---|---|
| Office hours (Mon–Sat, 10am–7pm), front desk free | Front desk answers. The AI is not involved, so there is **no cost**. |
| Office hours, line **busy** | Forward to the Vaani number (conditional forwarding: busy). |
| Office hours, **no answer** after ~4 rings (about 20 s) | Forward to the Vaani number (conditional forwarding: no answer). |
| **After hours**, Sundays and holidays | Forward everything to the Vaani number (time-based routing, or switch on unconditional forwarding at close). |

## How to set it up

- **Mobile or landline (Jio, Airtel, Vi, BSNL):** turn on *conditional call forwarding* to the Vaani number:
  - when busy: dial `**67*<vaani number>#`;
  - when not answered: dial `**61*<vaani number>**20#` (forwards after 20 seconds);
  - when unreachable: dial `**62*<vaani number>#`.

  For after hours, switch on *unconditional forwarding* (`**21*<vaani number>#`) at closing time and off (`##21#`) at opening. Most phones can schedule this, or the front desk does it at close.
- **Cloud/IVR number (Exotel, Knowlarity, MyOperator…):** add a time-based rule (outside 10am–7pm → Vaani number), plus "if no agent answers in 20 s or all busy → Vaani number".

Check the codes with your operator; they vary slightly.

## What the system does with this
- Every call the AI handles is tagged **after hours** or **overflow (staff busy)** using the office hours in Settings. The dashboard shows the split.
- Cost per call and per booking on the dashboard therefore only counts calls staff couldn't take.
- In overflow mode, a "redirect" caller (unsure whether they want a project) gets a callback task, never a transfer back to a busy front desk.
