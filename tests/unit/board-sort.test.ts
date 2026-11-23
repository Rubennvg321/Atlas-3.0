import { describe, expect, it } from "vitest";
import { sortColumnCards } from "@/lib/board-sort";

describe("sortColumnCards", () => {
  it("eerstvolgende afspraak bovenaan, kaarten zonder afspraak onderaan in de oorspronkelijke volgorde", () => {
    const cards = [
      { id: "geen-1", nextAppointmentAt: null },
      { id: "dec", nextAppointmentAt: "2026-12-03T09:00:00.000Z" },
      { id: "geen-2", nextAppointmentAt: null },
      { id: "nov", nextAppointmentAt: "2026-11-25T13:00:00.000Z" },
      { id: "nov-ochtend", nextAppointmentAt: "2026-11-25T08:00:00.000Z" },
    ];
    expect(sortColumnCards(cards).map((c) => c.id)).toEqual(["nov-ochtend", "nov", "dec", "geen-1", "geen-2"]);
  });
});
