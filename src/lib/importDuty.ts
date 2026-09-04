import type { ImportDutyDraft, ImportDutyLine } from "./types";

/** Common commercial-invoice currencies for the CUR dropdown. */
export const IMPORT_CURRENCIES = ["USD", "EUR", "GBP", "CNY", "ZAR", "AED", "HKD"];

/** Statutory SARS defaults. */
export const DEFAULT_VAT_UPLIFT_PCT = 10;
export const DEFAULT_VAT_RATE_PCT = 15;

function n(v: number | string | null | undefined): number {
  return Number(v) || 0;
}
/** Round to 2 decimals (SARS works to the cent per line). */
function r2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

export interface ImportDutyRow {
  /** qty x unit price, in the line currency. */
  foreignAmount: number;
  /** foreign amount x ROE, in ZAR. */
  localAmount: number;
  /** local amount x vat uplift % (statutory 10%). */
  customsMarkup: number;
  /** local amount + customs markup. */
  customsValue: number;
  /** customs value x duty rate %. */
  ttlDuty: number;
  /** customs value + total duty (the added-tax value). */
  taxableValue: number;
  /** taxable value x VAT rate % (15%). */
  ttlImportVat: number;
}

export function importDutyRow(
  line: ImportDutyLine,
  upliftPct: number | string,
  vatRatePct: number | string,
): ImportDutyRow {
  const foreignAmount = r2(n(line.qty_pcs) * n(line.unit_price));
  const localAmount = r2(foreignAmount * n(line.roe));
  const customsMarkup = r2(localAmount * (n(upliftPct) / 100));
  const customsValue = r2(localAmount + customsMarkup);
  const ttlDuty = r2(customsValue * (n(line.duty_rate_pct) / 100));
  const taxableValue = r2(customsValue + ttlDuty);
  const ttlImportVat = r2(taxableValue * (n(vatRatePct) / 100));
  return {
    foreignAmount,
    localAmount,
    customsMarkup,
    customsValue,
    ttlDuty,
    taxableValue,
    ttlImportVat,
  };
}

export interface ImportDutyTotals {
  foreignAmount: number;
  localAmount: number;
  ttlDuty: number;
  ttlImportVat: number;
}

export function importDutyTotals(draft: ImportDutyDraft): ImportDutyTotals {
  return (draft.lines || []).reduce<ImportDutyTotals>(
    (acc, line) => {
      const row = importDutyRow(line, draft.vat_uplift_pct, draft.vat_rate_pct);
      acc.foreignAmount += row.foreignAmount;
      acc.localAmount += row.localAmount;
      acc.ttlDuty += row.ttlDuty;
      acc.ttlImportVat += row.ttlImportVat;
      return acc;
    },
    { foreignAmount: 0, localAmount: 0, ttlDuty: 0, ttlImportVat: 0 },
  );
}

export function newImportDutyLine(position: number): ImportDutyLine {
  return {
    position,
    description: "",
    qty_pcs: 0,
    unit_price: 0,
    cur: "USD",
    roe: 0,
    duty_rate_pct: 0,
  };
}
