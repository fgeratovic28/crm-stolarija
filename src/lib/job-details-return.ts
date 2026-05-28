/** Stanje navigacije: kartica posla ← lista (aktivnosti, fajlovi, …). */
export type JobDetailsReturnState = {
  returnTo: string;
  returnLabel: string;
};

export const JOB_LIST_RETURN = {
  activities: {
    returnTo: "/activities",
    returnLabel: "Nazad na aktivnosti",
  },
  fieldReports: {
    returnTo: "/field-reports",
    returnLabel: "Nazad na terenske izveštaje",
  },
  files: {
    returnTo: "/files",
    returnLabel: "Nazad na fajlove",
  },
  materialOrders: {
    returnTo: "/material-orders",
    returnLabel: "Nazad na narudžbine materijala",
  },
} as const satisfies Record<string, JobDetailsReturnState>;

export function jobDetailsReturnState(
  returnTo: string,
  returnLabel: string,
): JobDetailsReturnState {
  return { returnTo, returnLabel };
}

export function readJobDetailsReturnState(
  locationState: unknown,
): JobDetailsReturnState | null {
  if (!locationState || typeof locationState !== "object") return null;
  const s = locationState as Record<string, unknown>;

  if (s.fromActivities === true) {
    return JOB_LIST_RETURN.activities;
  }

  if (typeof s.returnTo === "string" && s.returnTo.length > 0) {
    const returnLabel =
      typeof s.returnLabel === "string" && s.returnLabel.trim().length > 0
        ? s.returnLabel.trim()
        : "Nazad";
    return { returnTo: s.returnTo, returnLabel };
  }

  return null;
}
