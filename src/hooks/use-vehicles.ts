import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Vehicle, VehicleStatus } from "@/types";
import { toast } from "sonner";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "Došlo je do neočekivane greške.";
}

function mapDbToVehicle(db: Record<string, unknown>): Vehicle {
  return {
    id: db.id as string,
    vehicleName: db.vehicle_name as string,
    registrationNumber: (db.registration_number as string | null) ?? null,
    brandModel: (db.brand_model as string | null) ?? null,
    status: (db.status as VehicleStatus) ?? "active",
    registrationDate: (db.registration_date as string | null) ?? null,
    expirationDate: (db.expiration_date as string | null) ?? null,
    serviceNotes: (db.service_notes as string | null) ?? null,
    serviceKilometers: (db.service_kilometers as number | null) ?? null,
    assignedWorkerId: (db.assigned_worker_id as string | null) ?? null,
    generalNotes: (db.general_notes as string | null) ?? null,
    lastServiceDate: (db.last_service_date as string | null) ?? null,
    trafficPermitImageUrl: (db.traffic_permit_image_url as string | null) ?? null,
    insuranceImageUrl: (db.insurance_image_url as string | null) ?? null,
    serviceRecordImageUrl: (db.service_record_image_url as string | null) ?? null,
    additionalImageUrls: (db.additional_image_urls as string[] | null) ?? [],
    archivedAt: (db.archived_at as string | null) ?? null,
    createdAt: db.created_at as string,
    updatedAt: (db.updated_at as string | null) ?? null,
  };
}

export type VehicleUpsert = Omit<Vehicle, "id" | "createdAt" | "archivedAt">;
export type VehicleUpdate = { id: string } & Omit<Vehicle, "id" | "createdAt" | "archivedAt">;

export function useVehicles() {
  const queryClient = useQueryClient();

  const { data: vehicles, isLoading, error } = useQuery({
    queryKey: ["vehicles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []).map(mapDbToVehicle) as Vehicle[];
    },
  });

  const createVehicle = useMutation({
    mutationFn: async (payload: VehicleUpsert) => {
      const archivedAt = payload.status === "archived" ? new Date().toISOString() : null;
      const insertPayload: Record<string, unknown> = {
        vehicle_name: payload.vehicleName,
        registration_number: payload.registrationNumber || null,
        brand_model: payload.brandModel || null,
        status: payload.status,
        registration_date: payload.registrationDate || null,
        expiration_date: payload.expirationDate || null,
        service_notes: payload.serviceNotes || null,
        assigned_worker_id: payload.assignedWorkerId || null,
        general_notes: payload.generalNotes || null,
        last_service_date: payload.lastServiceDate || null,
        archived_at: archivedAt,
        updated_at: new Date().toISOString(),
      };

      if (payload.serviceKilometers !== null && payload.serviceKilometers !== undefined) {
        insertPayload.service_kilometers = payload.serviceKilometers;
      }
      if (payload.trafficPermitImageUrl) {
        insertPayload.traffic_permit_image_url = payload.trafficPermitImageUrl;
      }
      if (payload.insuranceImageUrl) {
        insertPayload.insurance_image_url = payload.insuranceImageUrl;
      }
      if (payload.serviceRecordImageUrl) {
        insertPayload.service_record_image_url = payload.serviceRecordImageUrl;
      }
      if (Array.isArray(payload.additionalImageUrls) && payload.additionalImageUrls.length > 0) {
        insertPayload.additional_image_urls = payload.additionalImageUrls;
      }

      const { data, error } = await supabase
        .from("vehicles")
        .insert([insertPayload])
        .select()
        .single();

      if (error) throw error;
      return mapDbToVehicle(data as Record<string, unknown>);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      toast.success("Vozilo uspešno dodato");
    },
    onError: (err: unknown) => {
      toast.error(`Greška pri dodavanju vozila: ${getErrorMessage(err)}`);
    },
  });

  const updateVehicle = useMutation({
    mutationFn: async ({ id, ...payload }: VehicleUpdate) => {
      const archivedAt = payload.status === "archived" ? new Date().toISOString() : null;
      const updatePayload: Record<string, unknown> = {
        vehicle_name: payload.vehicleName,
        registration_number: payload.registrationNumber || null,
        brand_model: payload.brandModel || null,
        status: payload.status,
        registration_date: payload.registrationDate || null,
        expiration_date: payload.expirationDate || null,
        service_notes: payload.serviceNotes || null,
        assigned_worker_id: payload.assignedWorkerId || null,
        general_notes: payload.generalNotes || null,
        last_service_date: payload.lastServiceDate || null,
        archived_at: archivedAt,
        updated_at: new Date().toISOString(),
      };

      if (payload.serviceKilometers !== undefined) {
        updatePayload.service_kilometers = payload.serviceKilometers;
      }
      if (payload.trafficPermitImageUrl !== undefined) {
        updatePayload.traffic_permit_image_url = payload.trafficPermitImageUrl;
      }
      if (payload.insuranceImageUrl !== undefined) {
        updatePayload.insurance_image_url = payload.insuranceImageUrl;
      }
      if (payload.serviceRecordImageUrl !== undefined) {
        updatePayload.service_record_image_url = payload.serviceRecordImageUrl;
      }
      if (payload.additionalImageUrls !== undefined) {
        updatePayload.additional_image_urls = payload.additionalImageUrls;
      }

      const { data, error } = await supabase
        .from("vehicles")
        .update(updatePayload)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return mapDbToVehicle(data as Record<string, unknown>);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      toast.success("Vozilo uspešno ažurirano");
    },
    onError: (err: unknown) => {
      toast.error(`Greška pri ažuriranju vozila: ${getErrorMessage(err)}`);
    },
  });

  const deleteVehicle = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("vehicles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      toast.success("Vozilo obrisano");
    },
    onError: (err: unknown) => {
      toast.error(`Greška pri brisanju vozila: ${getErrorMessage(err)}`);
    },
  });

  const setVehicleArchived = useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const status: VehicleStatus = archived ? "archived" : "active";
      const archivedAt = archived ? new Date().toISOString() : null;

      const { data, error } = await supabase
        .from("vehicles")
        .update({
          status,
          archived_at: archivedAt,
        })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return mapDbToVehicle(data as Record<string, unknown>);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      toast.success("Stanje vozila ažurirano");
    },
    onError: (err: unknown) => {
      toast.error(`Greška pri ažuriranju: ${getErrorMessage(err)}`);
    },
  });

  return {
    vehicles,
    isLoading,
    error,
    createVehicle,
    updateVehicle,
    deleteVehicle,
    setVehicleArchived,
  };
}

