import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { htmlToText, parseWebsiteForm } from "@/lib/intake/website-form";

const fixture = readFileSync(path.join(__dirname, "../fixtures/aanvraag-website.txt"), "utf8");

describe("parseWebsiteForm", () => {
  it("leest de echte aanvraagmail correct uit", () => {
    const lead = parseWebsiteForm(fixture)!;
    expect(lead.name).toBe("Katharina Klein");
    expect(lead.person).toEqual({ firstName: "Katharina", infix: null, lastName: "Klein" });
    expect(lead.emails).toEqual(["katharinai.klein@web.de"]);
    expect(lead.phones).toEqual(["+31657896904"]);
    expect(lead.street).toBe("Tintorettohof");
    expect(lead.houseNumber).toBeNull();
    expect(lead.postcode).toBe("6663PP");
    expect(lead.city).toBe("Lent");
    expect(lead.referral).toBe("Google");
    expect(lead.message).toContain("open trap dicht laten maken");
    expect(lead.sourcePage).toBe("https://www.stepsandstairs.nl/trap-bekleden/");
  });

  it("bewaart het IP-adres niet (AVG)", () => {
    const lead = parseWebsiteForm(fixture)!;
    expect(JSON.stringify(lead)).not.toContain("82.169.209.205");
  });

  it("werkt ook met de HTML-versie van de mail", () => {
    const html = fixture
      .split("\n")
      .map((l) => `<p>${l.replace(/&/g, "&amp;")}</p>`)
      .join("");
    const lead = parseWebsiteForm(htmlToText(html))!;
    expect(lead.name).toBe("Katharina Klein");
    expect(lead.postcode).toBe("6663PP");
    expect(lead.referral).toBe("Google");
  });

  it("leest straat + huisnummer als die wel zijn ingevuld", () => {
    const lead = parseWebsiteForm(fixture.replace("Tintorettohof", "Tintorettohof 14b"))!;
    expect(lead.street).toBe("Tintorettohof");
    expect(lead.houseNumber).toBe(14);
    expect(lead.addition).toBe("B");
  });

  it("geeft null bij een mail die geen formulier is", () => {
    expect(parseWebsiteForm("Hallo, hierbij de factuur.\nGroet, Piet")).toBeNull();
  });
});
