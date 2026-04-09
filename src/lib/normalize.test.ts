import { describe, expect, it } from "vitest";
import {
  buildGeocodeKey,
  normalizeAddressTownLast,
  normalizeFuelType,
  normalizePrice,
  parseDateFromFilename,
} from "./normalize";

describe("normalize helpers", () => {
  it("parses date from file name", () => {
    expect(parseDateFromFilename("dk-2026-04-08.xlsx")).toBe("2026-04-08");
    expect(parseDateFromFilename("DK-2026-04-08.xlsx")).toBe("2026-04-08");
  });

  it("maps fuel labels with diacritics", () => {
    expect(normalizeFuelType("95 markės benzinas")).toBe("gasoline");
    expect(normalizeFuelType("Dyzelinas")).toBe("diesel");
    expect(normalizeFuelType("Suskystintosios naftos dujos")).toBe("lpg");
  });

  it("converts price and Neprekiauja", () => {
    expect(normalizePrice("1.819")).toBe(1.819);
    expect(normalizePrice("Neprekiauja")).toBeNull();
    expect(normalizePrice("nepateikė")).toBeNull();
  });

  it("normalizes geocode cache keys", () => {
    expect(buildGeocodeKey("Vilniaus g.16, Šiauliai")).toBe(
      "vilniaus g.16, siauliai",
    );
  });

  it("moves town name to the end for two-part address", () => {
    expect(normalizeAddressTownLast("Alytus, Santaikos g. 33")).toBe(
      "Santaikos g. 33, Alytus",
    );
    expect(normalizeAddressTownLast("Sidabros g. 2A, Satkūnų k.")).toBe(
      "Sidabros g. 2A, Satkūnų k.",
    );
  });
});
