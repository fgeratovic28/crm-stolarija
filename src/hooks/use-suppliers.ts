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
         .select("id, name, contact_person, phone, email, address, active, bank_account, pib, category")
         .order("name");

       if (error) throw error;
       return data.map((d) => ({
         id: d.id,
         name: d.name,
        contactPerson: (d.contact_person as string | null) ?? "",
        phone: (d.phone as string | null) ?? "",
        email: (d.email as string | null) ?? "",
        address: (d.address as string | null) ?? "",
         materialTypes: [],
         active: d.active,
        category: (d.category as string | null) ?? undefined,
         bankAccount: (d.bank_account as string | null) ?? undefined,
         pib: (d.pib as string | null) ?? undefined,
       })) as Supplier[];
    },
  });

  const createSupplier = useMutation({
    mutationFn: async (newSupplier: Omit<Supplier, "id" | "materialTypes">) => {
      const { data, error } = await supabase
        .from("suppliers")
        .insert([{
          name: newSupplier.name,
          contact_person: newSupplier.contactPerson,
          phone: newSupplier.phone,
          email: newSupplier.email,
          address: newSupplier.address,
          active: newSupplier.active,
          category: newSupplier.category?.trim() || null,
          bank_account: newSupplier.bankAccount?.trim() || null,
          pib: newSupplier.pib?.trim() || null,
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
          active: updatedSupplier.active,
          category: updatedSupplier.category?.trim() || null,
          bank_account: updatedSupplier.bankAccount?.trim() || null,
          pib: updatedSupplier.pib?.trim() || null,
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
