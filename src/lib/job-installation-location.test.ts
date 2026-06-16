import { describe, expect, it } from "vitest";
import {
  getJobInstallationLocationDisplay,
  resolveJobInstallationLocationParts,
} from "./job-installation-location";

const baseCustomer = {
  installationAddress: "Kralja Petra 1, Beograd",
  installationApartment: "5",
  installationFloor: "2",
};

describe("resolveJobInstallationLocationParts", () => {
  it("prefers job-specific street over customer", () => {
    const parts = resolveJobInstallationLocationParts({
      jobInstallationAddress: "Novi bulevar 10, Beograd",
      customer: baseCustomer,
    });
    expect(parts.installationAddress).toBe("Novi bulevar 10, Beograd");
  });

  it("falls back to customer when job street is empty", () => {
    const parts = resolveJobInstallationLocationParts({
      customer: baseCustomer,
    });
    expect(parts.installationAddress).toBe("Kralja Petra 1, Beograd");
  });

  it("includes job apartment and floor in full display", () => {
    const label = getJobInstallationLocationDisplay({
      jobInstallationAddress: "Novi bulevar 10, Beograd",
      jobInstallationApartment: "12",
      jobInstallationFloor: "3",
      customer: baseCustomer,
    });
    expect(label).toBe("Novi bulevar 10, Beograd, sprat 3, stan 12");
  });
});
