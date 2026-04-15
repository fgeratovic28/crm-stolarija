import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Supplier } from "@/types";
import { toast } from "sonner";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Došlo je do neočekivane greške.";
}

export function useSuppliers() {
  const queryClient = useQueryClient();

  const { data: suppliers, isLoading } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("*")
        .order("name");

      if (error) throw error;
      return data.map(d => ({
        id: d.id,
        name: d.name,
        contactPerson: d.contact_person,
        phone: d.phone,
        email: d.email,
        address: d.address,
        materialTypes: d.material_types || [],
        active: d.active,
      })) as Supplier[];
    },
  });

  const createSupplier = useMutation({
    mutationFn: async (newSupplier: Omit<Supplier, "id">) => {
      const { data, error } = await supabase
        .from("suppliers")
        .insert([{
          name: newSupplier.name,
          contact_person: newSupplier.contactPerson,
          phone: newSupplier.phone,
          email: newSupplier.email,
          address: newSupplier.address,
          material_types: newSupplier.materialTypes,
          active: newSupplier.active,
        }])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Dobavljač uspešno dodat");
    },
    onError: (error) => {
      toast.error(`Greška pri dodavanju dobavljača: ${getErrorMessage(error)}`);
    },
  });

  const updateSupplier = useMutation({
    mutationFn: async (updatedSupplier: Supplier) => {
      const { error } = await supabase
        .from("suppliers")
        .update({
          name: updatedSupplier.name,
          contact_person: updatedSupplier.contactPerson,
          phone: updatedSupplier.phone,
          email: updatedSupplier.email,
          address: updatedSupplier.address,
          material_types: updatedSupplier.materialTypes,
          active: updatedSupplier.active,
        })
        .eq("id", updatedSupplier.id);

      if (error) throw error;
      return updatedSupplier;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Dobavljač uspešno ažuriran");
    },
    onError: (error) => {
      toast.error(`Greška pri ažuriranju dobavljača: ${getErrorMessage(error)}`);
    },
  });

  const deleteSupplier = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("suppliers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Dobavljač uspešno obrisan");
    },
    onError: (error) => {
      toast.error(`Greška pri brisanju dobavljača: ${getErrorMessage(error)}`);
    },
  });

  return {
    suppliers,
    isLoading,
    createSupplier,
    updateSupplier,
    deleteSupplier,
  };
}
