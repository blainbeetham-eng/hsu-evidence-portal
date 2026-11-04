import { describe, expect, it } from "vitest";
import { applicability } from "@/lib/applicability";
import { addressKey, matchProperty } from "@/lib/address-key";
import { templateFor, worksStage } from "@/lib/checklists";

describe("applicability (spec 6.1)", () => {
  it("blank lease date is Not assessed, never assumed", () => {
    expect(applicability("Insulation", null).state).toBe("not_assessed");
    expect(applicability("Draughtproofing", "").state).toBe("not_assessed");
  });

  it("switches on 1 March 2027 for insulation, showerheads, heating/cooling and hot water", () => {
    for (const t of ["Insulation", "Showerheads", "Heating/Cooling", "Hot Water"]) {
      expect(applicability(t, "2027-02-28").state, t).toBe("not_yet");
      expect(applicability(t, "2027-03-01").state, t).toBe("applies");
    }
  });

  it("switches on 1 July 2027 for draughtproofing", () => {
    expect(applicability("Draughtproofing", "2027-06-30").state).toBe("not_yet");
    expect(applicability("Draughtproofing", "2027-07-01").state).toBe("applies");
  });

  it("mentions the stricter cooling standard from 1 July 2030", () => {
    expect(applicability("Heating/Cooling", "2030-06-30").text).not.toMatch(/16\(3\)/);
    expect(applicability("Heating/Cooling", "2030-07-01").text).toMatch(/16\(3\)/);
  });

  it("lighting is evidence only", () => {
    expect(applicability("Lighting", "2028-01-01").state).toBe("evidence_only");
  });
});

describe("address key (matches Airtable's Address Key formula)", () => {
  it("normalises the same variants as the formula generator", () => {
    const k = "31 grandview ave glen iris";
    for (const v of ["31 Grandview Avenue, Glen Iris", "31 Grandview Ave Glen Iris VIC 3146", "31 GRANDVIEW AVE., GLEN IRIS 3146, Australia"]) {
      expect(addressKey(v)).toBe(k);
    }
    expect(addressKey("Unit 3, 12 Smith Street, Kew VIC 3101")).toBe(addressKey("3/12 Smith St, Kew"));
  });

  const props = [
    { id: "p1", address: "31 Grandview Avenue, Glen Iris VIC 3146" },
    { id: "p2", address: "57 Wills Street, Kew" },
    { id: "p3", address: "3/12 Smith Street, Kew" },
    { id: "p4", address: "12 Smith Street, Kew" },
  ];

  it("finds the property in an email subject", () => {
    expect(matchProperty("Photos - 31 Grandview Ave, Glen Iris", props)?.id).toBe("p1");
    expect(matchProperty("RE: FW: 57 wills st kew job done", props)?.id).toBe("p2");
    expect(matchProperty("31 Grandview Avenue photos", props)?.id).toBe("p1"); // street only, unique
  });

  it("tells units apart and refuses to guess", () => {
    expect(matchProperty("Unit 3, 12 Smith St Kew", props)?.id).toBe("p3");
    expect(matchProperty("12 Smith St Kew", props)?.id).toBe("p4");
    expect(matchProperty("Photos from today", props)).toBeNull();
    expect(matchProperty("131 Grandview Ave", props)).toBeNull();
  });
});

describe("checklists", () => {
  it("maps Airtable activity types", () => {
    expect(templateFor("Draughtproofing")?.id).toBe("draughtproofing");
    expect(templateFor("Showerheads")?.id).toBe("showerhead");
    expect(templateFor("Insulation")).toBeNull();
  });

  it("reads works status from Pipeline Status", () => {
    expect(worksStage("Works Scheduled")).toBe("Scheduled");
    expect(worksStage("Invoice Paid")).toBe("Done");
    expect(worksStage("Cleared to Proceed")).toBe("Not started");
  });
});
