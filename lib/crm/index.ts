import { HubSpotCrm, hubspotConfigured } from "../integrations/hubspot";
import { MockCrm } from "./mock";
import type { Crm } from "./types";

let mock: MockCrm | undefined;

export function getCrm(): Crm {
  if (hubspotConfigured()) return new HubSpotCrm();
  return (mock ??= new MockCrm());
}

export * from "./types";
