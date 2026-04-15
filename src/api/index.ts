import { supabase } from "@/lib/supabase";
import { Job, Customer, Activity, Payment, MaterialOrder, WorkOrder, FieldReport, AppFile, AppUser } from "@/types";

// Generic fetcher
export async function getEntities<T>(tableName: string) {
  const { data, error } = await supabase.from(tableName).select("*");
  if (error) throw error;
  return data as T[];
}

export async function getEntityById<T>(tableName: string, id: string) {
  const { data, error } = await supabase.from(tableName).select("*").eq("id", id).single();
  if (error) throw error;
  return data as T;
}

// Specific API functions
export const customersApi = {
  getAll: () => getEntities<Customer>("customers"),
  getById: (id: string) => getEntityById<Customer>("customers", id),
  create: (customer: Omit<Customer, "id">) => supabase.from("customers").insert(customer),
  update: (id: string, customer: Partial<Customer>) => supabase.from("customers").update(customer).eq("id", id),
  delete: (id: string) => supabase.from("customers").delete().eq("id", id),
};

export const jobsApi = {
  getAll: () => getEntities<Job>("jobs"),
  getById: (id: string) => getEntityById<Job>("jobs", id),
  create: (job: Omit<Job, "id">) => supabase.from("jobs").insert(job),
  update: (id: string, job: Partial<Job>) => supabase.from("jobs").update(job).eq("id", id),
  delete: (id: string) => supabase.from("jobs").delete().eq("id", id),
};

export const activitiesApi = {
  getByJobId: async (jobId: string) => {
    const { data, error } = await supabase.from("activities").select("*").eq("job_id", jobId);
    if (error) throw error;
    return data as Activity[];
  },
};

export const paymentsApi = {
  getByJobId: async (jobId: string) => {
    const { data, error } = await supabase.from("payments").select("*").eq("job_id", jobId);
    if (error) throw error;
    return data as Payment[];
  },
};

export const materialOrdersApi = {
  getByJobId: async (jobId: string) => {
    const { data, error } = await supabase.from("material_orders").select("*").eq("job_id", jobId);
    if (error) throw error;
    return data as MaterialOrder[];
  },
};

export const workOrdersApi = {
  getByJobId: async (jobId: string) => {
    const { data, error } = await supabase.from("work_orders").select("*").eq("job_id", jobId);
    if (error) throw error;
    return data as WorkOrder[];
  },
};

export const fieldReportsApi = {
  getByJobId: async (jobId: string) => {
    const { data, error } = await supabase.from("field_reports").select("*").eq("job_id", jobId);
    if (error) throw error;
    return data as FieldReport[];
  },
};

export const filesApi = {
  getByJobId: async (jobId: string) => {
    const { data, error } = await supabase.from("files").select("*").eq("job_id", jobId);
    if (error) throw error;
    return data as AppFile[];
  },
};
