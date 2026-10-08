/**
 * Service area — Pune city + PCMC (seed/services.md).
 *
 * DRAFT FOR FOUNDER REVIEW (see docs/service-area-review.md).
 * PINs come from the India Post directory (api.postalpincode.in, fetched
 * 2026-10-07, raw data in seed/pin-directory.json). Localities marked
 * `named` appear in services.md; the rest are Pune city / PCMC areas inside
 * allowlisted PINs ("and adjoining areas").
 *
 * Anything not on either list resolves to `unclear` → one direct question,
 * then designer review. It is never auto-declined.
 */

export interface LocalityEntry {
  name: string;
  aliases?: string[];
  /** Explicitly named in services.md. */
  named?: boolean;
}

export const ALLOWED_LOCALITIES: LocalityEntry[] = [
  // --- Named in services.md -------------------------------------------------
  { name: "Kothrud", named: true },
  { name: "Baner", named: true },
  { name: "Aundh", named: true },
  { name: "Wakad", named: true },
  { name: "Koregaon Park", aliases: ["KP", "Koregaon Pk"], named: true },
  { name: "Kalyani Nagar", named: true },
  { name: "Viman Nagar", named: true },
  { name: "Hadapsar", aliases: ["Hadpsar"], named: true },
  { name: "Magarpatta", aliases: ["Magarpatta City", "Cybercity", "Cyber City"], named: true },
  { name: "NIBM", aliases: ["NIBM Road"], named: true },
  { name: "Kondhwa", aliases: ["Kondhva", "Khondhwa"], named: true },
  { name: "Undri", named: true },
  { name: "Shivane", named: true },
  { name: "Warje", named: true },
  { name: "Erandwane", aliases: ["Erandawane"], named: true },
  { name: "Deccan", aliases: ["Deccan Gymkhana"], named: true },
  { name: "Pimpri", named: true },
  { name: "Chinchwad", named: true },
  { name: "Pimple Saudagar", named: true },
  { name: "Pimple Nilakh", named: true },
  { name: "Ravet", named: true },
  { name: "Hinjewadi", aliases: ["Hinjawadi", "Hinjwadi", "Infotech Park"], named: true },

  // --- Adjoining Pune city / PCMC areas (draft) ---------------------------
  { name: "Kharadi" },
  { name: "Wadgaon Sheri", aliases: ["Vadgaon Sheri"] },
  { name: "Yerwada", aliases: ["Yerawada"] },
  { name: "Shivajinagar", aliases: ["Shivaji Nagar"] },
  { name: "Model Colony" },
  { name: "Gokhale Nagar", aliases: ["Gokhalenagar"] },
  { name: "Pashan" },
  { name: "Bavdhan", aliases: ["Bavdhan Budruk"] },
  { name: "Balewadi" },
  { name: "Karve Nagar", aliases: ["Karvenagar"] },
  { name: "Sinhagad Road", aliases: ["Sinhgad Road"] },
  { name: "Anand Nagar", aliases: ["Anandnagar"] },
  { name: "Vadgaon Budruk", aliases: ["Wadgaon Budruk"] },
  { name: "Dhayari" },
  { name: "Nanded City" },
  { name: "Dhankawadi" },
  { name: "Katraj" },
  { name: "Bibwewadi", aliases: ["Bibvewadi"] },
  { name: "Market Yard" },
  { name: "Salisbury Park" },
  { name: "Swargate" },
  { name: "Sadashiv Peth" },
  { name: "Narayan Peth" },
  { name: "Shaniwar Peth" },
  { name: "Kasba Peth" },
  { name: "Shukrawar Peth" },
  { name: "Camp", aliases: ["Pune Camp", "Pune Cantonment"] },
  { name: "Wanowrie", aliases: ["Wanowarie", "Wanavdi"] },
  { name: "Fatima Nagar" },
  { name: "Ghorpadi" },
  { name: "Mundhwa", aliases: ["Mundhva"] },
  { name: "Keshav Nagar" },
  { name: "Amanora" },
  { name: "Mohammadwadi", aliases: ["Mohammed Wadi"] },
  { name: "Lohegaon", aliases: ["Lohgaon"] },
  { name: "Dhanori" },
  { name: "Vishrantwadi" },
  { name: "Tingre Nagar" },
  { name: "Khadki", aliases: ["Kirkee"] },
  { name: "Dapodi" },
  { name: "Bopodi" },
  { name: "Sangvi", aliases: ["Sangavi", "New Sangvi"] },
  { name: "Pimple Gurav" },
  { name: "Kasarwadi" },
  { name: "Bhosari" },
  { name: "Akurdi" },
  { name: "Nigdi" },
  { name: "Pradhikaran" },
  { name: "Thergaon" },
  { name: "Kalewadi" },
  { name: "Rahatani" },
  { name: "Punawale" },
  { name: "Tathawade", aliases: ["Thathawade"] },
  { name: "Marunji" },
  { name: "Chikhali" },
];

/**
 * Explicitly out of area. services.md names Talegaon, Lonavala, Nashik and
 * Mumbai; the rest are other cities callers commonly mention.
 */
export const DENIED_PLACES: string[] = [
  "Talegaon",
  "Talegaon Dabhade",
  "Lonavala",
  "Khandala",
  "Kamshet",
  "Nashik",
  "Nasik",
  "Mumbai",
  "Bombay",
  "Thane",
  "Panvel",
  "Satara",
  "Kolhapur",
  "Sangli",
  "Solapur",
  "Ahmednagar",
  "Ahilyanagar",
  "Aurangabad",
  "Sambhajinagar",
  "Nagpur",
  "Lavasa",
  "Baramati",
  "Goa",
  "Bengaluru",
  "Bangalore",
  "Hyderabad",
  "Delhi",
  "Gurugram",
  "Gurgaon",
  "Noida",
  "Chennai",
  "Kolkata",
  "Ahmedabad",
];

/** City names that mean "in area" on their own but still need a locality. */
export const HOME_CITY_NAMES = ["Pune", "PCMC", "Pimpri Chinchwad", "Pimpri-Chinchwad"];

/**
 * PIN allowlist: every 4110xx PIN the India Post directory lists for Pune
 * district / Pune City block, minus the rural Khadakwasla-Sinhagad PINs, plus
 * Undri (411060, missing from the API data) and Ravet (412101, named).
 */
export const ALLOWED_PINS: Record<string, string> = {
  "411001": "Pune Camp, Ghorpuri, Koregaon Park",
  "411002": "Pune city peths (Raviwar, Shukrawar, Nana)",
  "411003": "Khadki",
  "411004": "Deccan Gymkhana, Erandwane",
  "411005": "Shivajinagar",
  "411006": "Yerwada, Kalyani Nagar",
  "411007": "Aundh, Ganeshkhind",
  "411008": "Baner Road, Pashan (NCL)",
  "411009": "Parvati",
  "411011": "Kasba / Mangalwar / Rasta Peth",
  "411012": "Dapodi",
  "411013": "Hadapsar I.E., Magarpatta",
  "411014": "Viman Nagar, Wadgaon Sheri, Kharadi",
  "411015": "Vishrantwadi, Dhanori",
  "411016": "Model Colony, Gokhale Nagar",
  "411017": "Pimpri, Kalewadi",
  "411018": "Pimpri Colony, Nehrunagar",
  "411019": "Chinchwad East",
  "411020": "Range Hills",
  "411021": "Bavdhan, Sus",
  "411022": "SRPF (Wanowrie)",
  "411023": "Shivane, Uttamnagar, NDA",
  "411026": "Bhosari",
  "411027": "Aundh Camp, Sangvi, Pimple Saudagar, Pimple Nilakh",
  "411028": "Hadapsar",
  "411030": "Sadashiv / Narayan / Shaniwar Peth",
  "411031": "CME Dapodi",
  "411032": "Airport, Lohegaon",
  "411033": "Chinchwadgaon, Punawale, Tathawade, Thergaon",
  "411034": "Kasarwadi",
  "411035": "Akurdi",
  "411036": "Mundhwa",
  "411037": "Bibwewadi, Market Yard, Salisbury Park",
  "411038": "Kothrud",
  "411039": "Bhosari gaon",
  "411040": "Wanowrie",
  "411041": "Dhayari, Nanded City, Vadgaon Budruk",
  "411042": "Swargate",
  "411043": "Dhankawadi",
  "411044": "Nigdi, Pradhikaran",
  "411045": "Baner, Balewadi",
  "411046": "Katraj, Ambegaon",
  "411047": "Lohegaon",
  "411048": "Kondhwa, NIBM",
  "411051": "Anand Nagar (Sinhagad Road)",
  "411052": "Karve Nagar",
  "411057": "Hinjewadi, Wakad, Marunji",
  "411058": "Warje",
  "411060": "Undri, Mohammadwadi (not in India Post API data — added from services.md)",
  "411061": "Pimple Gurav",
  "411062": "Chikhali, Talawade",
  "412101": "Ravet, Kiwale, Dehu Road",
};

/** PINs for places services.md explicitly excludes. */
export const DENIED_PINS: Record<string, string> = {
  "410401": "Lonavala",
  "410405": "Kamshet / Karla (Maval)",
  "410506": "Talegaon Dabhade",
  "410507": "Talegaon (Induri, Varale)",
};

/**
 * Adjoining PINs that are deliberately NOT allowlisted (they resolve to
 * `unclear` → review). Listed here only so the founder can decide on them.
 */
export const REVIEW_PINS: Record<string, string> = {
  "411024": "Khadakwasla",
  "411025": "Khanapur / Donje (Sinhagad, rural Haveli)",
  "412105": "Moshi, Alandi, Charholi",
  "412115": "Pirangut, Bhugaon, Bhukum",
  "412207": "Wagholi, Kesnand",
  "412307": "Manjari",
  "412308": "Phursungi, Uruli Devachi",
  "410501": "Chakan",
};
