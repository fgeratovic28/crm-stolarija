import { describe, it, expect } from "vitest";
import type { Job } from "@/types";
import {
  jobHasOfficialInstallationSchedule,
  jobInstallationSchedulingComplete,
  jobNeedsInstallationScheduleAttention,
} from "@/lib/job-additional-works-display";

const scheduledJob = { status: "scheduled" } as Job;

describe("installation scheduling helpers", () => {
  it("treats WO date as schedule when job.scheduledAt is empty", () => {
    const wos = [{ date: "2026-05-22", team_id: "team-1" }];
    expect(jobHasOfficialInstallationSchedule(scheduledJob, wos)).toBe(true);
    expect(jobInstallationSchedulingComplete(scheduledJob, wos)).toBe(true);
    expect(jobNeedsInstallationScheduleAttention(scheduledJob, wos)).toBe(false);
  });

  it("needs attention when team is missing", () => {
    const wos = [{ date: "2026-05-22", team_id: null }];
    expect(jobNeedsInstallationScheduleAttention(scheduledJob, wos)).toBe(true);
  });

  it("needs attention when date is missing on job and WO", () => {
    const wos = [{ date: null, assignedTeamId: "team-1" }];
    expect(jobNeedsInstallationScheduleAttention(scheduledJob, wos)).toBe(true);
  });

  it("complete with job.scheduledAt and assignedTeamId on WO", () => {
    const job = { status: "scheduled", scheduledAt: "2026-05-22T10:00:00.000Z" } as Job;
    const wos = [{ assignedTeamId: "team-1" }];
    expect(jobInstallationSchedulingComplete(job, wos)).toBe(true);
  });
});
