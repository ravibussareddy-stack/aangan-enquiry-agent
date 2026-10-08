import { CalcomCalendar, calcomConfigured } from "../integrations/calcom";
import { MockCalendar } from "./mock-calendar";
import type { Calendar } from "./types";

let mock: MockCalendar | undefined;

/** Cal.com when configured, otherwise the mock calendar (simulation / zero-cost). */
export function getCalendar(): Calendar {
  if (calcomConfigured()) return new CalcomCalendar();
  return (mock ??= new MockCalendar());
}

export * from "./types";
export { pickSlots } from "./pick-slots";
