export type EventType = "residential_consult" | "commercial_consult" | "site_visit";

export interface Slot {
  /** Stable id the agent passes back to book_slot. */
  id: string;
  startUtc: string;
  label: string;
  eventType: EventType;
}

export interface BookingRequest {
  slot: Slot;
  leadRef: string;
  name: string;
  phone: string;
  notes?: string;
}

export interface BookingResult {
  uid: string;
  startUtc: string;
  endUtc: string;
  designer: string | null;
  designerEmail?: string | null;
  provider: "calcom" | "mock";
}

export interface Calendar {
  readonly provider: "calcom" | "mock";
  /** All open slots between from and to (UTC). */
  openSlots(eventType: EventType, from: Date, to: Date): Promise<Date[]>;
  book(req: BookingRequest): Promise<BookingResult>;
}
