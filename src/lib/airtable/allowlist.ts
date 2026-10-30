// The only Airtable fields the portal may read (spec v0.3, Section 7).
//
// Airtable tokens cannot be limited to fields, so this list IS the boundary:
// every request asks for exactly these field IDs, and a sync that receives any
// other field fails without writing anything. To add a field, add it here and
// to the mapping below; tests/sync/allowlist.test.ts will refuse anything that
// touches cost, margin, price or quote data.

export const AIRTABLE_BASE_ID = "appB1rWuqM3XsYHQz";

export const TABLES = {
  agencies: {
    tableId: "tbl8DdAbPfoISaAHa",
    fields: {
      name: "fldEURLSCr4QYc4X8", // Agency Name
    },
  },
  suppliers: {
    tableId: "tblWq1IxsC9OJvuZL",
    fields: {
      name: "fldphz38YOGAnLmIO", // Name
      email: "fldX2LCZPtCN5cYHF", // Supplier Email
    },
  },
  contacts: {
    tableId: "tblHodh0GqyJEoZJZ",
    fields: {
      name: "fldbcEbHEw9fpcLCK", // Contact Name
      email: "fldqeUr0tXLAr4Plk", // Email
      role: "flduFFBeg1iuGURnV", // Role
      consentStatus: "fldNYmiqnUJBefXSy", // Consent Status
      agency: "fldgrRSmNA5mZZIhV", // Agency (link)
    },
  },
  properties: {
    tableId: "tblzgWr6yDs5Xjs1E",
    fields: {
      address: "fldYXw044yGBr8jvm", // Property Address
      propertyType: "fldXdnXZWP2L2vn4p", // Property Type
      agency: "fldM8nYyRwejPx7kz", // Agency (link)
      currentLandlord: "fldZ4Bw14JEgHKFOp", // Current Landlord (link)
      leaseRenewalDate: "fldJFK0HnOQT3D6LA", // Lease Renewal Date
    },
  },
  workOrders: {
    tableId: "tblTzwknkrpee6XUG",
    fields: {
      property: "fldzl2fOSilE7wwfN", // Property (link)
      activityType: "fldtFeMyIoXRylxGC", // Activity Type
      pipelineStatus: "fldap6Zr3XFS3GYAW", // Pipeline Status
      sourceOrderRef: "fld7pQswmgRudJTZS", // Source Order Ref
      landlord: "fld3MjcCRkk5bu4rQ", // Landlord (link)
      supplier: "fldBu2fXlwxDu92Ik", // Supplier (link)
      aiJobSummary: "fldbvoeI2QJnv8Hso", // AI Job Summary
      testData: "fld59U0dQpM0ocPXV", // Test data
      driveFolderLink: "fldnF9lSOuZnDDCga", // Drive Folder Link (Phase 2A, Import from Drive)
    },
  },
} as const;

export type TableKey = keyof typeof TABLES;

// Never requested. Listed so the tests can prove none of them is in TABLES.
export const FORBIDDEN_TABLE_IDS = [
  "tbltrTGPVz11nE2Dg", // Supplier quotes (quoted amounts, margin %, client price ex/inc GST)
];

export const FORBIDDEN_FIELD_IDS = [
  "fldFdbrFbXMqUDOvp", // Work Orders: Final Cost (Ex GST)
  "fldLnouX94JgdUkMf", // Work Orders: Subsidy Amount
  "fldw0Yq0RLea4qc6L", // Work Orders: Client Price (Inc GST) — Phase 3 only
  "fld0ze3EBQYCfTKTC", // Work Orders: Winning Supplier (lookup via Supplier quotes)
  "fldMGsVPh0gaDScwj", // Work Orders: Accepted quote count
  "fldPD13Ae5XXrWEAw", // Work Orders: Supplier quotes (link)
  "fldhH1GZMi81SEwWH", // Work Orders: Xero Quote ID
  "fldcni5xMPomakB4a", // Work Orders: Invoice PDF
  "fld4aEb7H78A3MhUY", // Work Orders: Quote PDF
  "fld1S5wY7biv36p1j", // Work Orders: Invoice Number
  "fld6iRhKHL3Ec6l0V", // Properties: Total Subsidy Value
  "fldhRfwJpPUqwZMi6", // Contacts: Phone
  "fldE1sZXEqeyzJ0fL", // Supplier: Supplier quotes (link)
];

export function fieldIds(table: TableKey): string[] {
  return Object.values(TABLES[table].fields);
}
