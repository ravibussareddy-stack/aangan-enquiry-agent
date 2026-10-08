# Service area — for founder review

Source of truth: [`lib/qualify/data/service-area.ts`](../lib/qualify/data/service-area.ts).
PIN data: India Post directory via api.postalpincode.in, fetched 2026-10-07 (raw: [`seed/pin-directory.json`](../seed/pin-directory.json)).

## How a caller's location is judged

| Caller says | Result |
|---|---|
| A recognised Pune/PCMC locality (below) | **In area** |
| An allowlisted PIN | **In area** |
| Talegaon, Lonavala, Nashik, Mumbai, or another city | **Declined** (hard rule) |
| A Talegaon/Lonavala PIN and no locality | **Declined** |
| Anything else (e.g. Wagholi, an unknown society name, a conflicting PIN) | **Unclear** → the agent asks once → still unclear → **designer review**. Never auto-declined. |

## Please confirm

1. **PIN allowlist** — every 4110xx PIN the India Post lists under Pune City, plus:
   - **411060 Undri/Mohammadwadi** — missing from the India Post API data; added because services.md names Undri.
   - **412101 Ravet/Kiwale/Dehu Road** — services.md names Ravet.
2. **Adjoining PINs that I left OUT (they go to review)** — should any be in?
   | PIN | Area |
   |---|---|
   | 411024 | Khadakwasla |
   | 411025 | Khanapur / Donje (Sinhagad, rural) |
   | 412105 | Moshi, Alandi, Charholi |
   | 412115 | Pirangut, Bhugaon, Bhukum |
   | 412207 | Wagholi, Kesnand |
   | 412307 | Manjari |
   | 412308 | Phursungi, Uruli Devachi |
   | 410501 | Chakan |
3. **Localities not named in services.md that I treat as in area** (all inside allowlisted PINs): Kharadi (T10), Wadgaon Sheri, Yerwada, Shivajinagar, Model Colony, Gokhale Nagar, Pashan, Bavdhan, Balewadi, Karve Nagar, Sinhagad Road, Anand Nagar, Vadgaon Budruk, Dhayari, Nanded City, Dhankawadi, Katraj, Bibwewadi, Market Yard, Salisbury Park, Swargate, the central peths, Camp, Wanowrie, Fatima Nagar, Ghorpadi, Mundhwa, Keshav Nagar, Amanora, Mohammadwadi, Lohegaon, Dhanori, Vishrantwadi, Tingre Nagar, Khadki, Dapodi, Bopodi, Sangvi, Pimple Gurav, Kasarwadi, Bhosari, Akurdi, Nigdi, Pradhikaran, Thergaon, Kalewadi, Rahatani, Punawale, Tathawade, Marunji, Chikhali.
4. **Denylist** — Talegaon, Lonavala, Khandala, Kamshet, Nashik, Mumbai, Thane, Panvel, Satara, Kolhapur, Sangli, Solapur, Ahmednagar, Aurangabad, Nagpur, Lavasa, Baramati, Goa, Bengaluru, Hyderabad, Delhi NCR, Chennai, Kolkata, Ahmedabad.

## Allowlisted PINs

| PIN | Area | | PIN | Area |
|---|---|---|---|---|
| 411001 | Camp, Koregaon Park | | 411032 | Airport, Lohegaon |
| 411002 | Central peths | | 411033 | Chinchwadgaon, Punawale, Tathawade, Thergaon |
| 411003 | Khadki | | 411034 | Kasarwadi |
| 411004 | Deccan, Erandwane | | 411035 | Akurdi |
| 411005 | Shivajinagar | | 411036 | Mundhwa |
| 411006 | Yerwada, Kalyani Nagar | | 411037 | Bibwewadi, Market Yard |
| 411007 | Aundh | | 411038 | Kothrud |
| 411008 | Baner Road, Pashan | | 411039 | Bhosari gaon |
| 411009 | Parvati | | 411040 | Wanowrie |
| 411011 | Kasba / Mangalwar Peth | | 411041 | Dhayari, Nanded City |
| 411012 | Dapodi | | 411042 | Swargate |
| 411013 | Hadapsar I.E., Magarpatta | | 411043 | Dhankawadi |
| 411014 | Viman Nagar, Kharadi | | 411044 | Nigdi, Pradhikaran |
| 411015 | Vishrantwadi, Dhanori | | 411045 | Baner, Balewadi |
| 411016 | Model Colony | | 411046 | Katraj |
| 411017 | Pimpri, Kalewadi | | 411047 | Lohegaon |
| 411018 | Pimpri Colony | | 411048 | Kondhwa, NIBM |
| 411019 | Chinchwad East | | 411051 | Anand Nagar |
| 411020 | Range Hills | | 411052 | Karve Nagar |
| 411021 | Bavdhan, Sus | | 411057 | Hinjewadi, Wakad |
| 411022 | SRPF (Wanowrie) | | 411058 | Warje |
| 411023 | Shivane, Uttamnagar | | 411060 | Undri, Mohammadwadi |
| 411026 | Bhosari | | 411061 | Pimple Gurav |
| 411027 | Sangvi, Pimple Saudagar, Pimple Nilakh | | 411062 | Chikhali, Talawade |
| 411028 | Hadapsar | | 412101 | Ravet, Kiwale |
| 411030 | Sadashiv / Narayan Peth | | | |
| 411031 | CME Dapodi | | | |
