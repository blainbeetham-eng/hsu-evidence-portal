import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env";

// AI summary of an assessment report for landlords and agencies (spec v0.7, Section 3E).
// The summary is stored as a draft; nothing reaches a landlord until Blain approves it.
// Only the report PDF is sent, never photos or videos.

export const PROMPT_VERSION = "2026-10-30.1";
export const SUMMARY_FOOTER = "Summary of the assessor's report. Read the full report for detail.";

// The Messages API accepts requests up to 32 MB; base64 adds a third.
export const MAX_REPORT_BYTES = 22 * 1024 * 1024;

const SYSTEM = `You summarise residential energy assessment reports for Victorian rental properties.
The reader is the landlord (and their property manager), not a tradesperson. Write in plain Australian English.

What to write, in this order:
1. One or two sentences on what the assessment covered and when.
2. For each upgrade type the report covers (ceiling insulation, heating, cooling, draughtproofing, hot water, showerheads, lighting): one short line starting with the upgrade name, saying what the assessor found and whether the report says it meets the minimum standard, needs work, or could not be checked.
3. One sentence on what happens next, only if the report itself says so.

Rules:
- Say only what the report says. Do not add advice, estimates, or a compliance verdict the report does not give.
- No prices, costs or rebates.
- No personal details: no names, phone numbers, email addresses or licence numbers of tenants, landlords, agents or assessors.
- Under 220 words. Plain text: one item per line, upgrade lines starting with "- ". No headings, no bold, no tables.

Also return:
- assessor: "AEA" if the report is from Australian Energy Assessments, "DI" if from Detector Inspector, otherwise "other".
- di_report_url: if this is a Detector Inspector report, the full web address of its online report (where the photos are), exactly as printed in the report; otherwise null.`;

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    assessor: { type: "string", enum: ["AEA", "DI", "other"] },
    di_report_url: { type: ["string", "null"] },
  },
  required: ["summary", "assessor", "di_report_url"],
  additionalProperties: false,
} as const;

export type ReportSummary = {
  summary: string;
  assessor: "AEA" | "DI" | "other";
  di_report_url: string | null;
  model: string;
};

export async function summariseReport(pdf: Buffer): Promise<ReportSummary> {
  if (pdf.length > MAX_REPORT_BYTES) {
    throw new Error("This report is too large to summarise automatically (over 22 MB).");
  }
  const client = new Anthropic({ apiKey: serverEnv.anthropicApiKey() });
  const response = await client.beta.messages.create({
    model: serverEnv.anthropicModel(),
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
          { type: "text", text: "Summarise this assessment report." },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("The AI declined to summarise this report.");
  if (response.stop_reason === "max_tokens") throw new Error("The AI summary was cut off. Try Regenerate.");
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("The AI returned no summary.");
  const parsed = JSON.parse(text.text) as Omit<ReportSummary, "model">;
  const url = parsed.di_report_url?.trim();
  return {
    summary: parsed.summary.trim(),
    assessor: parsed.assessor,
    di_report_url: url && /^https:\/\//.test(url) ? url : null,
    model: response.model,
  };
}

/** Flags text that looks like contact details, so Blain checks before approving. */
export function looksLikeContactDetails(text: string): boolean {
  return /[\w.+-]+@[\w-]+\.[\w.]+/.test(text) || /(\+?61|0)[\s-]?[2-478](?:[\s-]?\d){8}/.test(text);
}
