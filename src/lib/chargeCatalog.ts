import type { ChargeCategory, LineCurrency, QuoteMode } from "./types";

export interface CatalogItem {
  category: ChargeCategory;
  code: string;
  description: string;
  cur: LineCurrency;
  unit: string;
  /** Modes this code applies to. Omitted = all modes. */
  modes?: QuoteMode[];
  /** Default VAT % applied to the line when this code is picked. Omitted = 0. */
  vat_pct?: number;
}

// Courier Express uses the same codes/descriptions as Air Freight.
const AIR: QuoteMode[] = ["Air Freight (AIR)", "Courier Express (CX)"];
const SEA: QuoteMode[] = ["Sea Freight (FCL)", "Sea Freight (LCL)"];

/**
 * ExPac rate-card charge codes. Picking a code in the quote builder fills in the
 * description, currency and unit (all still editable afterwards). The code list
 * shown is filtered by the quote's mode.
 */
export const CHARGE_CATALOG: CatalogItem[] = [
  // ---- International Freight Charges ----
  { category: "International Freight Charges", code: "AF-01", description: "Air Freight Fee", cur: "USD", unit: "KGS", modes: AIR },
  { category: "International Freight Charges", code: "AF-02", description: "Terminal Handling Fee", cur: "USD", unit: "", modes: AIR },
  { category: "International Freight Charges", code: "FW-01", description: "Forwarding Fee", cur: "USD", unit: "B/L" },
  { category: "International Freight Charges", code: "OF-01", description: "Ocean Freight", cur: "USD", unit: "", modes: SEA },
  { category: "International Freight Charges", code: "OF-02", description: "Release Fee", cur: "USD", unit: "", modes: SEA },
  { category: "International Freight Charges", code: "OF-06", description: "Ocean Freight (LCL-DDP)", cur: "USD", unit: "W/M", modes: SEA },
  { category: "International Freight Charges", code: "IN-01", description: "Cargo Insurance", cur: "USD", unit: "INV" },

  // ---- Ex-Works Charges ----
  { category: "Ex-Works Charges", code: "OR-01", description: "Pick Up Fee", cur: "USD", unit: "AWB" },
  { category: "Ex-Works Charges", code: "OR-02", description: "Customs and Documentation Fee", cur: "USD", unit: "AWB" },
  { category: "Ex-Works Charges", code: "OR-03", description: "Battery Check Fee", cur: "USD", unit: "AWB", modes: AIR },
  { category: "Ex-Works Charges", code: "OR-04", description: "Safety Test Report", cur: "USD", unit: "AWB", modes: AIR },
  { category: "Ex-Works Charges", code: "OR-05", description: "CFS, AMS, VGM and Handling Charges", cur: "USD", unit: "", modes: SEA },
  { category: "Ex-Works Charges", code: "OR-06", description: "Hazardous Surcharge", cur: "USD", unit: "", modes: SEA },
  { category: "Ex-Works Charges", code: "OR-07", description: "Packaging & Labelling Fee", cur: "USD", unit: "", modes: SEA },

  // ---- Destination Handling and Delivery Charges ----
  { category: "Destination Handling and Delivery Charges", code: "AF-03", description: "Destination Airline Handling", cur: "ZAR", unit: "AWB", modes: AIR },
  { category: "Destination Handling and Delivery Charges", code: "TR-01", description: "Transfer & Cartage Fee", cur: "ZAR", unit: "AWB" },
  { category: "Destination Handling and Delivery Charges", code: "TR-02", description: "Fuel Surcharge", cur: "ZAR", unit: "AWB" },
  { category: "Destination Handling and Delivery Charges", code: "OF-03", description: "Dest. De-Grouping Fee", cur: "ZAR", unit: "", modes: SEA },
  { category: "Destination Handling and Delivery Charges", code: "OF-04", description: "LCL Loading (In/Out) Fee", cur: "ZAR", unit: "", modes: SEA },
  { category: "Destination Handling and Delivery Charges", code: "OF-05", description: "Container Import Charges", cur: "ZAR", unit: "", modes: SEA },
  { category: "Destination Handling and Delivery Charges", code: "OF-07", description: "Cargo Dues", cur: "ZAR", unit: "P/CTNR", modes: SEA, vat_pct: 15 },

  // ---- Customs Clearance, VAT and Duty Charges ----
  { category: "Customs Clearance, VAT and Duty Charges", code: "CU-02", description: "Customs VAT", cur: "ZAR", unit: "AWB" },
  { category: "Customs Clearance, VAT and Duty Charges", code: "CU-03", description: "Customs Duty", cur: "ZAR", unit: "AWB" },
  { category: "Customs Clearance, VAT and Duty Charges", code: "DIS-01", description: "Disbursement Fee", cur: "ZAR", unit: "DIS", vat_pct: 15 },
  { category: "Customs Clearance, VAT and Duty Charges", code: "CU-05", description: "Customs Clearance Fee", cur: "ZAR", unit: "AWB", vat_pct: 15 },
];

function appliesToMode(item: CatalogItem, mode?: QuoteMode): boolean {
  if (!mode || !item.modes) return true;
  return item.modes.includes(mode);
}

export function catalogForCategory(
  category: ChargeCategory,
  mode?: QuoteMode,
): CatalogItem[] {
  return CHARGE_CATALOG.filter(
    (c) => c.category === category && appliesToMode(c, mode),
  );
}

export function catalogItem(code: string, mode?: QuoteMode): CatalogItem | undefined {
  if (!code) return undefined;
  return (
    CHARGE_CATALOG.find((c) => c.code === code && appliesToMode(c, mode)) ??
    CHARGE_CATALOG.find((c) => c.code === code)
  );
}
