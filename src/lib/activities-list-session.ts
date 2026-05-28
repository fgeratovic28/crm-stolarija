const STATE_KEY = "crm-activities-list-state";
const PENDING_KEY = "crm-activities-list-restore-pending";

export type ActivitiesListRestoreState = {
  scrollTop: number;
  page: number;
  perPage: number;
  filters: Record<string, string>;
  activityDate: string;
  activityId?: string;
};

export function getAppMainScrollElement(): HTMLElement | null {
  return document.querySelector("main");
}

export function markActivitiesListRestorePending(): void {
  try {
    sessionStorage.setItem(PENDING_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function clearActivitiesListRestorePending(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
    sessionStorage.removeItem(STATE_KEY);
  } catch {
    /* ignore */
  }
}

export function saveActivitiesListState(state: ActivitiesListRestoreState): void {
  try {
    sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
    markActivitiesListRestorePending();
  } catch {
    /* ignore */
  }
}

export function readActivitiesListRestoreState(): ActivitiesListRestoreState | null {
  try {
    if (sessionStorage.getItem(PENDING_KEY) !== "1") return null;
    const raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ActivitiesListRestoreState;
  } catch {
    return null;
  }
}

export function consumeActivitiesListRestoreState(): ActivitiesListRestoreState | null {
  const state = readActivitiesListRestoreState();
  clearActivitiesListRestorePending();
  return state;
}
