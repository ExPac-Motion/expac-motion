/**
 * Cloudflare Pages Function, ShipsGo tracking webhook receiver.
 *
 * ShipsGo POSTs here whenever a tracked shipment changes. We verify the
 * call, fold the payload into our shape and write job_tracking +
 * tracking_events with the service-role key (no user session on a webhook).
 * Supabase Realtime then pushes the change to the ops board and the customer
 * portal, no polling, no Refresh button.
 *
 * Confirmed payload shape (captured 2026-09-11, OCEAN.SHIPMENTS.SHIPMENT_UPDATED):
 *   {
 *     event: { id, name: "OCEAN.SHIPMENTS.SHIPMENT_UPDATED", triggered_by },
 *     shipment: {
 *       id, reference, booking_number, container_number, container_count,
 *       status, carrier: { name, scac },
 *       route: {
 *         port_of_loading:  { location: {code,name,country,timezone}, date_of_loading, date_of_loading_initial },
 *         port_of_discharge:{ location: {...}, date_of_discharge, date_of_discharge_initial, date_of_discharge_predicted },
 *         transit_time, transit_percentage
 *       },
 *       containers: [{ number, status, size, type,
 *         movements: [{ event, status: "ACT"|"EST", vessel: {imo,name}|null, voyage, location: {code,name,...}, timestamp }]
 *       }],
 *       created_at, updated_at, checked_at
 *     }
 *   }
 * No GPS coordinates anywhere in this payload, not for the vessel, not even
 * for the ports. PORT_COORDS below is our own lookup so the map has
 * something to plot; "vessel position" is the last movement whose
 * status is "ACT" (a real confirmed event), pinned at that event's port,
 * never a fabricated live GPS fix.
 *
 * Air webhooks (AIR.SHIPMENTS.*), confirmed 2026-10-14: movements sit on the
 * shipment (no containers), locations carry an IATA code, each leg a flight;
 * route.origin.date_of_dep / route.destination.date_of_rcf. Raw on job_tracking.raw.
 *
 * Env (Cloudflare Pages dashboard):
 *   SHIPSGO_WEBHOOK_SECRET   shared secret, matched against the
 *                            X-Shipsgo-Signature HMAC, or an X-Webhook-Token
 *                            header, or a ?token= query param.
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (already set for mail-webhook)
 *
 * Not part of the Vite / tsc build; Cloudflare builds functions/ on its own.
 */

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json" },
  });
}

function bytesToHex(bytes) {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}
async function hmacHex(secret, body) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return bytesToHex(new Uint8Array(mac));
}

/** Accept the call if the HMAC matches, or a static token matches. */
async function authorised(env, req, rawBody) {
  const secret = env.SHIPSGO_WEBHOOK_SECRET;
  if (!secret) return false;
  const url = new URL(req.url);
  const token =
    req.headers.get("x-webhook-token") ||
    req.headers.get("x-shipsgo-token") ||
    url.searchParams.get("token");
  if (token && token === secret) return true;
  const sig = (req.headers.get("x-shipsgo-signature") || req.headers.get("x-signature") || "")
    .trim()
    .replace(/^sha256=/i, "")
    .toLowerCase();
  if (sig && sig === (await hmacHex(secret, rawBody))) return true;
  return false;
}

/* ------------------------------------------------------------------ *
 *  Port coordinates (UN/LOCODE -> [lat, lon])
 *
 *  ShipsGo's webhook carries no GPS data at all, so this curated table is
 *  what puts POL / POD / event pins on the map. City-level accuracy, fine
 *  for a small marker, not survey-grade. Covers the ports ExPac's own
 *  LOCODES list (src/lib/locodes.ts) actually quotes; extend as new lanes
 *  come up (a port missing here just renders without a map pin).
 * ------------------------------------------------------------------ */
const PORT_COORDS = {
  // South Africa
  ZADUR: [-29.8587, 31.0218], ZACPT: [-33.9249, 18.4241], ZAPLZ: [-33.9608, 25.6022],
  ZAZBA: [-33.7961, 25.6929], ZAELS: [-33.0292, 27.8546], ZARCB: [-28.783, 32.0377],
  ZASDB: [-33.0117, 17.9442],
  // Southern & East Africa
  NAWVB: [-22.9576, 14.5053], MZMPM: [-25.9692, 32.5732], MZBEW: [-19.8436, 34.8389],
  TZDAR: [-6.7924, 39.2083], KEMBA: [-4.0435, 39.6682], MUPLU: [-20.1609, 57.5012],
  AOLAD: [-8.8147, 13.2302], NGLOS: [6.4531, 3.3958], GHTEM: [5.6698, -0.0166],
  CIABJ: [5.3097, -4.0126], SNDKR: [14.6928, -17.4467],
  // North Africa
  EGPSD: [31.2653, 32.3019], EGSOK: [29.6033, 32.3567], EGALY: [31.2001, 29.9187],
  MAPTM: [35.8883, -5.5], DZALG: [36.7538, 3.0588], TNRDS: [36.7667, 10.2833],
  // China / HK / Taiwan
  CNSHA: [31.2304, 121.4737], CNNGB: [29.8683, 121.544], CNYTN: [22.5764, 114.2686],
  CNSHK: [22.4833, 113.9], CNSZX: [22.5431, 114.0579], CNCAN: [23.1291, 113.2644],
  CNNSA: [22.7597, 113.6047], CNTAO: [36.0671, 120.3826], CNXMN: [24.4798, 118.0894],
  CNDLC: [38.914, 121.6147], CNTSN: [39.0842, 117.2009], CNLYG: [34.6, 119.2167],
  CNFOC: [26.0745, 119.2965], CNZUH: [22.2707, 113.5767], CNZJG: [31.8757, 120.5553],
  CNSWA: [23.354, 116.6819], HKHKG: [22.3193, 114.1694], TWKHH: [22.6273, 120.3014],
  TWKEL: [25.1276, 121.7392],
  // South-East / East Asia
  SGSIN: [1.2644, 103.822], MYPKG: [3.0, 101.4], MYTPP: [1.3626, 103.5501],
  IDJKT: [-6.1045, 106.8829], IDSUB: [-7.2, 112.7], THLCH: [13.0827, 100.883],
  VNSGN: [10.7626, 106.771], VNHPH: [20.8449, 106.6881], PHMNL: [14.5906, 120.9799],
  KHKOS: [10.6167, 103.5167], KRPUS: [35.1796, 129.0756], KRINC: [37.4563, 126.7052],
  JPYOK: [35.4437, 139.638], JPTYO: [35.6528, 139.8394], JPUKB: [34.6901, 135.1955],
  JPNGO: [35.0824, 136.8814], JPOSA: [34.6413, 135.429],
  // India / South Asia
  INBOM: [18.9388, 72.8354], INNSA: [18.9633, 72.9494], INMUN: [22.8388, 69.722],
  INMAA: [13.0989, 80.2919], INCCU: [22.5504, 88.2939], LKCMB: [6.9497, 79.8442],
  BDCGP: [22.305, 91.7995], PKKHI: [24.8425, 66.9905],
  // Middle East
  AEJEA: [25.0118, 55.0618], SAJED: [21.4858, 39.1925], QADOH: [25.2711, 51.5983],
  OMSLL: [17.0075, 54.0925], IRBND: [27.1461, 56.2358], ILHFA: [32.8156, 34.9892],
  ILASH: [31.8044, 34.6553], TRIST: [40.9679, 28.68], TRMER: [36.8, 34.6333],
  // Europe
  NLRTM: [51.9496, 4.1453], BEANR: [51.2603, 4.4029], BEZEE: [51.3305, 3.205],
  DEHAM: [53.5459, 9.9662], DEBRV: [53.5396, 8.5809], GBFXT: [51.954, 1.351],
  GBSOU: [50.8974, -1.4044], GBLGP: [51.5074, 0.475], FRLEH: [49.4849, 0.1079],
  FRFOS: [43.4333, 4.8667], FRMRS: [43.2965, 5.3698], ESVLC: [39.4699, -0.3763],
  ESBCN: [41.3511, 2.1683], ESALG: [36.1408, -5.4526], ITGOA: [44.4056, 8.9463],
  ITGIT: [38.4241, 15.8994], PTLIS: [38.7223, -9.1393], PTSIE: [37.9558, -8.8647],
  GRPIR: [37.9475, 23.6367], PLGDN: [54.352, 18.6466], SEGOT: [57.7089, 11.9746],
  DKAAR: [56.1496, 10.2134], NOOSL: [59.9139, 10.7522], IEDUB: [53.3498, -6.2603],
  RULED: [59.9311, 30.3609],
  // North America
  USNYC: [40.6892, -74.0445], USLAX: [33.7395, -118.261], USLGB: [33.7701, -118.1937],
  USOAK: [37.7955, -122.2778], USSEA: [47.6062, -122.3421], USTIW: [47.2529, -122.4443],
  USSAV: [32.0809, -81.0912], USCHS: [32.7765, -79.9311], USORF: [36.8508, -76.2859],
  USBAL: [39.2904, -76.6122], USHOU: [29.7604, -95.3698], USMIA: [25.7617, -80.1918],
  CAVAN: [49.2827, -123.1207], CAPRR: [54.315, -130.3208], CAMTR: [45.5017, -73.5673],
  CAHAL: [44.6488, -63.5752], MXZLO: [19.0522, -104.3183], MXVER: [19.1738, -96.1342],
  MXATM: [22.3833, -97.9167], PABLB: [8.95, -79.5667], PACRI: [9.3547, -79.9008],
  // South America
  BRSSZ: [-23.9608, -46.3339], BRPNG: [-25.5163, -48.5225], BRRIO: [-22.9068, -43.1729],
  ARBUE: [-34.6037, -58.3816], UYMVD: [-34.9011, -56.1645], CLVAP: [-33.0472, -71.6127],
  CLSAI: [-33.5928, -71.6122], PECLL: [-12.0464, -77.1428], COCTG: [10.391, -75.4794],
  // Oceania
  AUSYD: [-33.8688, 151.2093], AUMEL: [-37.8136, 144.9631], AUBNE: [-27.4698, 153.0251],
  AUFRE: [-32.0569, 115.7439], NZAKL: [-36.8485, 174.7633], NZTRG: [-37.6878, 176.1651],
};
/** IATA airport -> [lat, lon, name], same table as src/lib/places.ts. */
const AIRPORT_COORDS = {
  // Southern Africa
  JNB: [-26.1337, 28.242, "O.R. Tambo International Airport"], CPT: [-33.9715, 18.6021, "Cape Town International Airport"],
  DUR: [-29.6144, 31.1197, "King Shaka International Airport"], PLZ: [-33.9849, 25.6173, "Chief Dawid Stuurman International Airport"],
  ELS: [-33.0356, 27.8259, "King Phalo Airport"], BFN: [-29.0927, 26.3024, "Bram Fischer International Airport"],
  GBE: [-24.5552, 25.9182, "Sir Seretse Khama International Airport"], WDH: [-22.4799, 17.4709, "Hosea Kutako International Airport"],
  MPM: [-25.9208, 32.5726, "Maputo International Airport"], HRE: [-17.9318, 31.0928, "Robert Gabriel Mugabe International Airport"],
  LUN: [-15.3308, 28.4526, "Kenneth Kaunda International Airport"], LLW: [-13.7894, 33.781, "Kamuzu International Airport"],
  BLZ: [-15.6791, 34.974, "Chileka International Airport"], MSU: [-29.4623, 27.5525, "Moshoeshoe I International Airport"],
  SHO: [-26.3586, 31.7166, "King Mswati III International Airport"], MRU: [-20.4302, 57.6836, "Sir Seewoosagur Ramgoolam International Airport"],
  TNR: [-18.7969, 47.4788, "Ivato International Airport"], LAD: [-8.8584, 13.2312, "Quatro de Fevereiro Airport"],
  // East / West / North Africa
  NBO: [-1.3192, 36.9278, "Jomo Kenyatta International Airport"], EBB: [0.0424, 32.4435, "Entebbe International Airport"],
  KGL: [-1.9686, 30.1395, "Kigali International Airport"], DAR: [-6.8781, 39.2026, "Julius Nyerere International Airport"],
  ADD: [8.9779, 38.7993, "Addis Ababa Bole International Airport"], FIH: [-4.3858, 15.4446, "N'djili International Airport"],
  LOS: [6.5774, 3.3212, "Murtala Muhammed International Airport"], ABV: [9.0068, 7.2632, "Nnamdi Azikiwe International Airport"],
  ACC: [5.6052, -0.1668, "Kotoka International Airport"], ABJ: [5.2614, -3.9263, "Felix Houphouet-Boigny International Airport"],
  DSS: [14.67, -17.0733, "Blaise Diagne International Airport"], CMN: [33.3675, -7.5899, "Mohammed V International Airport"],
  ALG: [36.691, 3.2154, "Houari Boumediene Airport"], TUN: [36.851, 10.2272, "Tunis-Carthage International Airport"],
  CAI: [30.1219, 31.4056, "Cairo International Airport"],
  // Middle East / Turkey
  DXB: [25.2532, 55.3657, "Dubai International Airport"], DWC: [24.8962, 55.1614, "Al Maktoum International Airport"],
  AUH: [24.433, 54.6511, "Zayed International Airport"], SHJ: [25.3286, 55.5172, "Sharjah International Airport"],
  DOH: [25.2731, 51.6081, "Hamad International Airport"], BAH: [26.2708, 50.6336, "Bahrain International Airport"],
  KWI: [29.2266, 47.9689, "Kuwait International Airport"], MCT: [23.5933, 58.2844, "Muscat International Airport"],
  RUH: [24.9576, 46.6988, "King Khalid International Airport"], JED: [21.6796, 39.1565, "King Abdulaziz International Airport"],
  DMM: [26.4712, 49.7979, "King Fahd International Airport"], AMM: [31.7226, 35.9932, "Queen Alia International Airport"],
  TLV: [32.0055, 34.8854, "Ben Gurion Airport"], IST: [41.2753, 28.7519, "Istanbul Airport"],
  SAW: [40.8986, 29.3092, "Sabiha Gokcen International Airport"],
  // China / Hong Kong / Macau / Taiwan
  PEK: [40.0799, 116.6031, "Beijing Capital International Airport"], PKX: [39.5098, 116.4105, "Beijing Daxing International Airport"],
  PVG: [31.1443, 121.8083, "Shanghai Pudong International Airport"], SHA: [31.1979, 121.3363, "Shanghai Hongqiao International Airport"],
  CAN: [23.3924, 113.2988, "Guangzhou Baiyun International Airport"], SZX: [22.6393, 113.8107, "Shenzhen Bao'an International Airport"],
  HKG: [22.308, 113.9185, "Hong Kong International Airport"], MFM: [22.1496, 113.5916, "Macau International Airport"],
  CTU: [30.5785, 103.9471, "Chengdu Shuangliu International Airport"], TFU: [30.3197, 104.4442, "Chengdu Tianfu International Airport"],
  CKG: [29.7192, 106.6417, "Chongqing Jiangbei International Airport"], XMN: [24.544, 118.1277, "Xiamen Gaoqi International Airport"],
  NGB: [29.8267, 121.4619, "Ningbo Lishe International Airport"], HGH: [30.2295, 120.4344, "Hangzhou Xiaoshan International Airport"],
  NKG: [31.742, 118.862, "Nanjing Lukou International Airport"], TSN: [39.1244, 117.3462, "Tianjin Binhai International Airport"],
  TAO: [36.3661, 120.0947, "Qingdao Jiaodong International Airport"], TNA: [36.8572, 117.2158, "Jinan Yaoqiang International Airport"],
  CGO: [34.5197, 113.8409, "Zhengzhou Xinzheng International Airport"], WUH: [30.7838, 114.2081, "Wuhan Tianhe International Airport"],
  XIY: [34.4471, 108.7516, "Xi'an Xianyang International Airport"], KMG: [25.1019, 102.9292, "Kunming Changshui International Airport"],
  FOC: [25.9351, 119.6632, "Fuzhou Changle International Airport"], DLC: [38.9657, 121.5386, "Dalian Zhoushuizi International Airport"],
  SHE: [41.6398, 123.4834, "Shenyang Taoxian International Airport"], TPE: [25.0777, 121.2328, "Taiwan Taoyuan International Airport"],
  KHH: [22.5771, 120.35, "Kaohsiung International Airport"],
  // South-East / East Asia
  SIN: [1.3644, 103.9915, "Singapore Changi Airport"], KUL: [2.7456, 101.7099, "Kuala Lumpur International Airport"],
  PEN: [5.2971, 100.277, "Penang International Airport"], BKK: [13.69, 100.7501, "Suvarnabhumi Airport"],
  DMK: [13.9126, 100.6068, "Don Mueang International Airport"], SGN: [10.8188, 106.652, "Tan Son Nhat International Airport"],
  HAN: [21.2212, 105.8072, "Noi Bai International Airport"], MNL: [14.5086, 121.0194, "Ninoy Aquino International Airport"],
  CGK: [-6.1256, 106.6559, "Soekarno-Hatta International Airport"], SUB: [-7.3798, 112.7869, "Juanda International Airport"],
  PNH: [11.5466, 104.8441, "Phnom Penh International Airport"], RGN: [16.9073, 96.1332, "Yangon International Airport"],
  ICN: [37.4602, 126.4407, "Incheon International Airport"], GMP: [37.5583, 126.7906, "Gimpo International Airport"],
  NRT: [35.772, 140.3929, "Narita International Airport"], HND: [35.5494, 139.7798, "Tokyo Haneda Airport"],
  KIX: [34.4347, 135.244, "Kansai International Airport"], NGO: [34.8584, 136.8054, "Chubu Centrair International Airport"],
  // South Asia
  BOM: [19.0896, 72.8656, "Chhatrapati Shivaji Maharaj International Airport"], DEL: [28.5562, 77.1, "Indira Gandhi International Airport"],
  MAA: [12.9941, 80.1709, "Chennai International Airport"], BLR: [13.1986, 77.7066, "Kempegowda International Airport"],
  HYD: [17.2403, 78.4294, "Rajiv Gandhi International Airport"], CCU: [22.6547, 88.4467, "Netaji Subhas Chandra Bose International Airport"],
  AMD: [23.0772, 72.6347, "Sardar Vallabhbhai Patel International Airport"], COK: [10.152, 76.4019, "Cochin International Airport"],
  DAC: [23.8433, 90.3978, "Hazrat Shahjalal International Airport"], CMB: [7.1808, 79.8841, "Bandaranaike International Airport"],
  KTM: [27.6966, 85.3591, "Tribhuvan International Airport"], KHI: [24.9065, 67.1608, "Jinnah International Airport"],
  LHE: [31.5216, 74.4036, "Allama Iqbal International Airport"],
  // Europe
  LHR: [51.47, -0.4543, "London Heathrow Airport"], LGW: [51.1537, -0.1821, "London Gatwick Airport"],
  STN: [51.885, 0.235, "London Stansted Airport"], MAN: [53.3537, -2.275, "Manchester Airport"],
  EMA: [52.8311, -1.3281, "East Midlands Airport"], FRA: [50.0379, 8.5622, "Frankfurt Airport"],
  MUC: [48.3538, 11.7861, "Munich Airport"], LEJ: [51.4239, 12.2364, "Leipzig/Halle Airport"],
  CGN: [50.8659, 7.1427, "Cologne Bonn Airport"], HAM: [53.6304, 9.9882, "Hamburg Airport"],
  DUS: [51.2895, 6.7668, "Dusseldorf Airport"], AMS: [52.3105, 4.7683, "Amsterdam Schiphol Airport"],
  BRU: [50.9014, 4.4844, "Brussels Airport"], LGG: [50.6374, 5.4432, "Liege Airport"],
  CDG: [49.0097, 2.5479, "Paris Charles de Gaulle Airport"], ORY: [48.7262, 2.3652, "Paris Orly Airport"],
  LYS: [45.7256, 5.0811, "Lyon-Saint Exupery Airport"], MAD: [40.4983, -3.5676, "Adolfo Suarez Madrid-Barajas Airport"],
  BCN: [41.2974, 2.0833, "Barcelona-El Prat Airport"], ZAZ: [41.6662, -1.0416, "Zaragoza Airport"],
  LIS: [38.7742, -9.1342, "Lisbon Humberto Delgado Airport"], OPO: [41.2481, -8.6814, "Porto Airport"],
  FCO: [41.8003, 12.2389, "Rome Fiumicino Airport"], MXP: [45.6306, 8.7281, "Milan Malpensa Airport"],
  BGY: [45.6739, 9.7042, "Milan Bergamo Airport"], VIE: [48.1103, 16.5697, "Vienna International Airport"],
  ZRH: [47.4582, 8.5555, "Zurich Airport"], GVA: [46.2381, 6.109, "Geneva Airport"],
  BSL: [47.5896, 7.5299, "EuroAirport Basel-Mulhouse-Freiburg"], CPH: [55.618, 12.6508, "Copenhagen Airport"],
  ARN: [59.6498, 17.9238, "Stockholm Arlanda Airport"], OSL: [60.1976, 11.1004, "Oslo Gardermoen Airport"],
  HEL: [60.3172, 24.9633, "Helsinki Airport"], WAW: [52.1657, 20.9671, "Warsaw Chopin Airport"],
  PRG: [50.1008, 14.26, "Vaclav Havel Airport Prague"], BUD: [47.4298, 19.2611, "Budapest Ferenc Liszt International Airport"],
  ATH: [37.9364, 23.9445, "Athens International Airport"], DUB: [53.4264, -6.2499, "Dublin Airport"],
  LUX: [49.6233, 6.2044, "Luxembourg Airport"], SVO: [55.9726, 37.4146, "Sheremetyevo International Airport"],
  // North / South America
  JFK: [40.6413, -73.7781, "John F. Kennedy International Airport"], EWR: [40.6895, -74.1745, "Newark Liberty International Airport"],
  ORD: [41.9742, -87.9073, "Chicago O'Hare International Airport"], ATL: [33.6407, -84.4277, "Hartsfield-Jackson Atlanta International Airport"],
  MIA: [25.7959, -80.287, "Miami International Airport"], LAX: [33.9416, -118.4085, "Los Angeles International Airport"],
  SFO: [37.6213, -122.379, "San Francisco International Airport"], DFW: [32.8998, -97.0403, "Dallas/Fort Worth International Airport"],
  IAH: [29.9902, -95.3368, "George Bush Intercontinental Airport"], SEA: [47.4502, -122.3088, "Seattle-Tacoma International Airport"],
  BOS: [42.3656, -71.0096, "Boston Logan International Airport"], IAD: [38.9531, -77.4565, "Washington Dulles International Airport"],
  CVG: [39.0489, -84.6678, "Cincinnati/Northern Kentucky International Airport"], MEM: [35.0424, -89.9767, "Memphis International Airport"],
  SDF: [38.174, -85.7365, "Louisville Muhammad Ali International Airport"], ANC: [61.1743, -149.9962, "Ted Stevens Anchorage International Airport"],
  ONT: [34.056, -117.6012, "Ontario International Airport"], YYZ: [43.6777, -79.6248, "Toronto Pearson International Airport"],
  YVR: [49.1967, -123.1815, "Vancouver International Airport"], YUL: [45.4706, -73.7408, "Montreal-Trudeau International Airport"],
  MEX: [19.4361, -99.0719, "Mexico City International Airport"], GRU: [-23.4356, -46.4731, "Sao Paulo/Guarulhos International Airport"],
  VCP: [-23.0074, -47.1345, "Viracopos International Airport"], GIG: [-22.809, -43.2506, "Rio de Janeiro/Galeao International Airport"],
  EZE: [-34.8222, -58.5358, "Ministro Pistarini International Airport"], SCL: [-33.393, -70.7858, "Santiago International Airport"],
  LIM: [-12.0219, -77.1143, "Jorge Chavez International Airport"], BOG: [4.7016, -74.1469, "El Dorado International Airport"],
  PTY: [9.0714, -79.3835, "Tocumen International Airport"],
  // Oceania
  SYD: [-33.9399, 151.1753, "Sydney Kingsford Smith Airport"], MEL: [-37.669, 144.841, "Melbourne Airport"],
  BNE: [-27.3842, 153.1175, "Brisbane Airport"], PER: [-31.9385, 115.9672, "Perth Airport"],
  AKL: [-37.0082, 174.785, "Auckland Airport"],
};
/** A sea port (UN/LOCODE) or airport (IATA) code -> coordinates. A LOCODE
 *  with no port entry falls back to the airport with the same last three
 *  letters (CNCAN -> CAN), same rule as placeOf() in src/lib/places.ts. */
function portLatLon(locode) {
  const code = String(locode || "").trim().toUpperCase();
  const c =
    PORT_COORDS[code] ||
    (code.length === 3 ? AIRPORT_COORDS[code] : null) ||
    (code.length === 5 ? AIRPORT_COORDS[code.slice(2)] : null);
  return c ? { lat: c[0], lon: c[1] } : { lat: null, lon: null };
}

/* ---------- tolerant scalar helpers ---------- */
const numOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const dateOnly = (v) => {
  if (!v) return null;
  const s = String(v);
  const m = s.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
};
const iso = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Fold the confirmed ShipsGo shape (with light fallbacks for air) into ours. */
function normalise(payload) {
  const shipment = (payload && payload.shipment) || {};
  const eventName = (payload && payload.event && payload.event.name) || "";
  const route = shipment.route || {};
  const pol = route.port_of_loading || route.origin || {};
  const pod = route.port_of_discharge || route.destination || {};
  const polLoc = pol.location || pol || {};
  const podLoc = pod.location || pod || {};
  const carrier = shipment.carrier || shipment.airline || {};

  // Ocean: movements per container. Air (confirmed 2026-10-14,
  // AIR.SHIPMENTS.SHIPMENT_UPDATED): movements straight on the shipment,
  // locations by IATA code ({iata,name,country,timezone}), a flight per leg.
  const containers = Array.isArray(shipment.containers) ? shipment.containers : [];
  const groups = containers.length
    ? containers.map((c) => ({ number: c.number || null, movements: c.movements }))
    : [{ number: null, movements: shipment.movements }];
  const movements = [];
  for (const g of groups) {
    for (const m of Array.isArray(g.movements) ? g.movements : []) {
      const loc = m.location || {};
      const code = loc.code || loc.iata || null;
      const pos = portLatLon(code);
      movements.push({
        containerNumber: g.number,
        code: m.event || null,
        isActual: m.status === "ACT",
        vesselName: (m.vessel && m.vessel.name) || null,
        vesselImo: m.vessel && m.vessel.imo != null ? String(m.vessel.imo) : null,
        voyage: m.voyage || null,
        flight: typeof m.flight === "string" ? m.flight : (m.flight && m.flight.number) || null,
        locode: code,
        locationName: loc.name || null,
        lat: pos.lat,
        lon: pos.lon,
        occurredAt: iso(m.timestamp),
      });
    }
  }
  movements.sort((a, b) => (a.occurredAt || "").localeCompare(b.occurredAt || ""));
  const actuals = movements.filter((m) => m.isActual);
  // "Last event" reflects what has really happened (confirmed only); the
  // vessel/voyage is the booking's assigned vessel, which is known as soon as
  // it's planned even before it sails, so pull it from the earliest
  // movement that names one, actual or not.
  const latest = actuals.length ? actuals[actuals.length - 1] : movements[movements.length - 1];
  const lastActual = actuals[actuals.length - 1] || null;
  const vesselMovement = movements.find((m) => m.vesselName) || null;

  const polCode = polLoc.code || polLoc.iata || null;
  const podCode = podLoc.code || podLoc.iata || null;
  const polPos = portLatLon(polCode);
  const podPos = portLatLon(podCode);

  const numbers = [
    shipment.container_number,
    shipment.booking_number,
    shipment.reference,
    shipment.awb_number,
    ...containers.map((c) => c.number),
  ].filter(Boolean);

  return {
    id: shipment.id != null ? String(shipment.id) : null,
    numbers,
    status: shipment.status || null,
    carrier: carrier.name || carrier.scac || null,
    pol: polCode,
    pod: podCode,
    polLat: polPos.lat,
    polLon: polPos.lon,
    podLat: podPos.lat,
    podLon: podPos.lon,
    // Air: date_of_dep / date_of_rcf (cargo received at destination).
    etd: dateOnly(pol.date_of_loading || pol.date_of_dep || pol.date),
    eta: dateOnly(pod.date_of_discharge_predicted || pod.date_of_discharge || pod.date_of_rcf || pod.date),
    podEta: iso(pod.date_of_discharge_predicted || pod.date_of_discharge || pod.date_of_rcf || pod.date),
    vesselName: (vesselMovement && vesselMovement.vesselName) || null,
    vesselImo: (vesselMovement && vesselMovement.vesselImo) || null,
    voyage: (vesselMovement && vesselMovement.voyage) || null,
    lastEvent: latest ? [latest.code, latest.locationName].filter(Boolean).join(" @ ") : null,
    // The last CONFIRMED (status "ACT") event's port, never a fabricated
    // live GPS fix, since ShipsGo's webhook doesn't carry one.
    vesselLat: lastActual ? lastActual.lat : null,
    vesselLon: lastActual ? lastActual.lon : null,
    positionAt: lastActual ? lastActual.occurredAt : null,
    movements,
    eventName,
  };
}

/* ---------- Supabase REST (service role) ---------- */
function sbHeaders(env, extra) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
    ...(extra || {}),
  };
}
async function sbGet(env, path) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders(env) });
  return r.ok ? r.json() : [];
}
async function sbPatch(env, path, patch) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: sbHeaders(env, { "content-type": "application/json", prefer: "return=minimal" }),
    body: JSON.stringify(patch),
  });
}
async function sbUpsert(env, table, rows, onConflict) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: sbHeaders(env, {
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify(rows),
  });
}

async function findJob(env, { shipsgoId, numbers }) {
  if (shipsgoId) {
    const byRef = await sbGet(
      env,
      `job_tracking?or=(provider_ref.eq.${encodeURIComponent(shipsgoId)},shipsgo_id.eq.${encodeURIComponent(shipsgoId)})&select=job_id,provider_ref&limit=1`,
    );
    if (byRef[0]) return byRef[0];
  }
  for (const n of numbers) {
    if (!n) continue;
    const rows = await sbGet(
      env,
      `job_tracking?ref_value=ilike.${encodeURIComponent(n)}&select=job_id,provider_ref&limit=1`,
    );
    if (rows[0]) return rows[0];
  }
  return null;
}

/**
 * Push the tracked vessel / voyage / carrier / ETD / ETA back onto the job and
 * its quote, so the Quote Builder and every shipment document show the live
 * values. Tracking OVERWRITES what an operator typed (agreed 2026-09-30), but
 * only with values it actually has, a missing field never blanks one out.
 * Sea: carrier -> shipping_line, plus vessel_name / voyage_no. Air / Courier:
 * carrier -> carrier_name (Agent / Airline). Failures are swallowed so the
 * tracking update itself always succeeds.
 */
async function writeBackToShipment(env, jobId, n) {
  try {
    const jobs = await sbGet(env, `jobs?id=eq.${jobId}&select=quote_id,mode&limit=1`);
    const job = jobs[0];
    if (!job) return;
    const isSea = String(job.mode || "").startsWith("Sea Freight");

    const common = {};
    if (n.etd) common.etd = n.etd;
    if (n.eta) common.eta = n.eta;
    if (n.carrier) common[isSea ? "shipping_line" : "carrier_name"] = n.carrier;
    if (isSea && n.vesselName) common.vessel_name = n.vesselName;

    // With a quote, patch the quote only: trg_quote_fields_sync (0101) copies
    // vessel / carrier / ETD / ETA on to the job. Without one, patch the job.
    if (job.quote_id) {
      const quotePatch = { ...common };
      if (isSea && n.voyage) quotePatch.voyage_no = n.voyage;
      if (Object.keys(quotePatch).length) {
        await sbPatch(env, `quotes?id=eq.${job.quote_id}`, quotePatch);
      }
    } else if (Object.keys(common).length) {
      await sbPatch(env, `jobs?id=eq.${jobId}`, common);
    }
  } catch {
    /* never fail the webhook over the write-back */
  }
}

export async function onRequestPost(context) {
  const env = context.env || {};
  if (!env.SHIPSGO_WEBHOOK_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Tracking webhook is not configured." }, 500);
  }

  const raw = await context.request.text();
  if (!(await authorised(env, context.request, raw))) {
    return json({ error: "Unauthorised." }, 401);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "Bad JSON." }, 400);
  }

  const n = normalise(payload);
  if (!n.id && n.numbers.length === 0) {
    return json({ ok: true, matched: false, note: "no shipment in payload" });
  }
  const found = await findJob(env, { shipsgoId: n.id, numbers: n.numbers });
  if (!found) return json({ ok: true, matched: false, event: n.eventName });

  const jobId = found.job_id;
  const patch = {
    synced_at: new Date().toISOString(),
    tracking_status: "registered",
  };
  if (n.id && !found.provider_ref) patch.provider_ref = n.id;
  if (n.carrier) patch.carrier = n.carrier;
  if (n.status) patch.status = n.status;
  if (n.pol) patch.pol = n.pol;
  if (n.pod) patch.pod = n.pod;
  if (n.etd) patch.etd = n.etd;
  if (n.eta) patch.eta = n.eta;
  if (n.podEta) patch.pod_eta = n.podEta;
  if (n.vesselName) patch.vessel_name = n.vesselName;
  if (n.vesselImo) patch.vessel_imo = n.vesselImo;
  if (n.voyage) patch.voyage = n.voyage;
  if (n.lastEvent) patch.last_event = n.lastEvent;
  if (n.polLat != null) {
    patch.pol_lat = n.polLat;
    patch.pol_lon = n.polLon;
  }
  if (n.podLat != null) {
    patch.pod_lat = n.podLat;
    patch.pod_lon = n.podLon;
  }
  // Always set definitively (not just when present) so a bad prior value
  // (e.g. the (0,0) bug from an earlier build) gets corrected either way.
  patch.vessel_lat = n.vesselLat;
  patch.vessel_lon = n.vesselLon;
  patch.position_at = n.positionAt;
  patch.raw = payload;

  await sbPatch(env, `job_tracking?job_id=eq.${jobId}`, patch);
  await writeBackToShipment(env, jobId, n);

  const eventRows = n.movements
    .filter((m) => m.code)
    .map((m) => ({
      job_id: jobId,
      provider: "shipsgo",
      provider_event_id: `${m.containerNumber || ""}:${m.code}:${m.occurredAt || ""}`,
      event_code: m.code,
      description: [m.code, m.locationName].filter(Boolean).join(" @ ") || m.code,
      location: m.locationName,
      locode: m.locode,
      lat: m.lat,
      lon: m.lon,
      // Air has no vessel: the leg's flight number goes here (e.g. "SQ 0478").
      vessel_name: m.vesselName || m.flight,
      voyage: m.voyage,
      occurred_at: m.occurredAt,
      is_actual: m.isActual,
    }));
  if (eventRows.length) {
    await sbUpsert(env, "tracking_events", eventRows, "job_id,provider,provider_event_id");
  }

  return json({ ok: true, matched: true, job_id: jobId, event: n.eventName, events: eventRows.length });
}
