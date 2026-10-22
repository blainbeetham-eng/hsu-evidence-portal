// Airtable record -> portal row. Pure functions, so they can be tested without
// a network or database.
import { TABLES } from "./allowlist";
import type { AirtableRecord } from "./fetch";

const F = {
  agencies: TABLES.agencies.fields,
  suppliers: TABLES.suppliers.fields,
  contacts: TABLES.contacts.fields,
  properties: TABLES.properties.fields,
  workOrders: TABLES.workOrders.fields,
};

function text(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  return null;
}

function links(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function date(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export function mapAgency(r: AirtableRecord, syncedAt: string) {
  return { id: r.id, name: text(r.fields[F.agencies.name]) ?? "(unnamed agency)", synced_at: syncedAt, removed_at: null };
}

export function mapSupplier(r: AirtableRecord, syncedAt: string) {
  return {
    id: r.id,
    name: text(r.fields[F.suppliers.name]) ?? "(unnamed supplier)",
    email: text(r.fields[F.suppliers.email]),
    synced_at: syncedAt,
    removed_at: null,
  };
}

export function mapContact(r: AirtableRecord, syncedAt: string) {
  return {
    id: r.id,
    name: text(r.fields[F.contacts.name]),
    email: text(r.fields[F.contacts.email])?.toLowerCase() ?? null,
    role: text(r.fields[F.contacts.role]),
    consent_status: text(r.fields[F.contacts.consentStatus]),
    agency_ids: links(r.fields[F.contacts.agency]),
    synced_at: syncedAt,
    removed_at: null,
  };
}

export function mapProperty(r: AirtableRecord, syncedAt: string) {
  return {
    id: r.id,
    address: text(r.fields[F.properties.address]) ?? "(no address)",
    property_type: text(r.fields[F.properties.propertyType]),
    agency_id: links(r.fields[F.properties.agency])[0] ?? null,
    current_landlord_ids: links(r.fields[F.properties.currentLandlord]),
    lease_renewal_date: date(r.fields[F.properties.leaseRenewalDate]),
    synced_at: syncedAt,
    removed_at: null,
  };
}

export function mapWorkOrder(r: AirtableRecord, syncedAt: string) {
  return {
    id: r.id,
    property_id: links(r.fields[F.workOrders.property])[0] ?? null,
    activity_type: text(r.fields[F.workOrders.activityType]),
    pipeline_status: text(r.fields[F.workOrders.pipelineStatus]),
    source_order_ref: text(r.fields[F.workOrders.sourceOrderRef]),
    landlord_ids: links(r.fields[F.workOrders.landlord]),
    supplier_ids: links(r.fields[F.workOrders.supplier]),
    ai_job_summary: text(r.fields[F.workOrders.aiJobSummary]),
    is_test: r.fields[F.workOrders.testData] === true,
    synced_at: syncedAt,
    removed_at: null,
  };
}
