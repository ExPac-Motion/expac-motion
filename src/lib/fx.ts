export interface LiveRates {
  usdZar: number;
  cnyZar: number;
  /** Human-readable "as of" timestamp from the rate provider. */
  asOf: string;
}

/**
 * Current USD->ZAR and CNY->ZAR from open.er-api.com (free, no key, allows
 * browser requests). Base is USD, so CNY->ZAR = ZAR-per-USD / CNY-per-USD.
 */
export async function fetchLiveRates(): Promise<LiveRates> {
  const res = await fetch("https://open.er-api.com/v6/latest/USD");
  if (!res.ok) {
    throw new Error(`Rate service returned ${res.status}`);
  }
  const data = await res.json();
  if (data?.result !== "success" || !data?.rates) {
    throw new Error("Rate service response was not usable");
  }
  const zar = Number(data.rates.ZAR);
  const cny = Number(data.rates.CNY);
  if (!zar || !cny) {
    throw new Error("ZAR or CNY rate missing from response");
  }
  return {
    usdZar: zar,
    cnyZar: zar / cny,
    asOf: typeof data.time_last_update_utc === "string" ? data.time_last_update_utc : "",
  };
}
