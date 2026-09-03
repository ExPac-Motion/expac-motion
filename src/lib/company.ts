// ExPac company details for the client-facing quotation letterhead.
// Edit anything here — this is the only source for the FROM block, banking
// details and footer text on the printed quotation.

export const COMPANY = {
  legalName: "EXPAC FORWARDING CC",
  strapline: "Air & Ocean Freight Clearing & Forwarding",
  tagline: "Excellence in Motion",
  // Header block at the very top of the quotation: logo + "QUOTATION - <name>"
  // with these two registration/contact lines underneath.
  headerName: "EXPAC FORWARDING CC",
  headerLine1:
    "Reg No: 2010/110405/23  ·  Vat No: 4670306135  ·  Tel: +27 (0) 11 568 8281",
  headerEmail: "Email: support@expac.co.za",
  headerLine2: "Postnet Suite 84, Private Bag X1015, Lyttelton, 0140",
  from: [
    ["Reg Number", "2010/110405/23"],
    ["VAT No", "4670306135"],
    ["Tel Number", "+27 (0) 11 568 8281"],
    ["Fax Number", "+27 (0) 86 482 2371"],
    ["Email Address", "admin@expac.co.za"],
    ["Web Address", "www.expac.co.za"],
    ["Postal Address", "Postnet Suite 84"],
    ["Suburb", "Private Bag X1015"],
    ["Province", "Lyttelton"],
    ["Country", "Centurion, 0140"],
  ] as [string, string][],
  bank: [
    "Bank Name: First National Bank",
    "Branch Name: Centurion, South Africa",
    "Account Name: ExPac Forwarding",
    "Account Type: Business Current",
    "Account Number (ZAR): 63215955452",
    "Branch Code: 250655",
    "Swift Code: FIRNZAJJ",
  ],
  // Rendered with white-space: pre-line — these 7 line breaks are intentional.
  blurb:
    "We move more than just cargo, we move trust, time,\n" +
    "and opportunity. Rooted in precision and propelled\n" +
    "by passion, we specialize in seamless air, sea, and\n" +
    "road freight solutions that connect businesses\n" +
    "across borders. With a global mindset and local\n" +
    "expertise, we deliver tailored logistics with\n" +
    "unmatched reliability, speed, and care.",
  /** Colour logo for the printed document (file in /public). */
  logoPrint: "/Logo.jpg",
};
