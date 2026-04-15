import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { readAppSettingsCache } from "@/lib/app-settings";
import type { Customer } from "@/types";
import { toast } from "sonner";

// Helper to map DB to UI types
const mapDbToCustomer = (db: Record<string, unknown>): Customer => ({
  id: db.id as string,
  customerNumber: db.customer_number as string,
  fullName: db.name as string,
  contactPerson: db.contact_person as string,
  billingAddress: db.billing_address as string,
  installationAddress: db.installation_address as string,
  phones: (db.phones as string[]) || [],
  emails: (db.emails as string[]) || [],
  pib: db.pib as string,
  registrationNumber: db.registration_number as string,
  createdAt: db.created_at as string,
});

// Helper to map UI to DB types
const mapCustomerToDb = (customer: Partial<Customer>) => ({
  customer_number: customer.customerNumber,
  name: customer.fullName,
  contact_person: customer.contactPerson,
  billing_address: customer.billingAddress,
  installation_address: customer.installationAddress,
  phones: customer.phones,
  emails: customer.emails,
  pib: customer.pib,
  registration_number: customer.registrationNumber,
});

async function reserveNextCustomerNumber(prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  const { data, error } = await supabase.rpc("next_customer_number", {
    p_prefix: prefix,
    p_year: year,
  });

  if (error || typeof data !== "string" || data.trim().length === 0) {
    throw new Error(
      "Nije moguće dobiti sledeći broj klijenta preko RPC funkcije `next_customer_number`."
    );
  }

  return data;
}

export function useCustomers() {
  const queryClient = useQueryClient();

  const { data: customers, isLoading, error } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data.map(mapDbToCustomer);
    },
  });

  const createCustomer = useMutation({
    mutationFn: async (newCustomer: Omit<Customer, "id" | "createdAt" | "customerNumber">) => {
      const { customerPrefix } = readAppSettingsCache();
      const customerNumber = await reserveNextCustomerNumber(customerPrefix);

      const { data, error } = await supabase
        .from("customers")
        .insert([{ ...mapCustomerToDb(newCustomer), customer_number: customerNumber }])
        .select()
        .single();

      if (error) throw error;
      return mapDbToCustomer(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Klijent uspešno kreiran");
    },
    onError: (err: Error) => {
      toast.error("Greška pri kreiranju klijenta", { description: err.message });
    },
  });

  const updateCustomer = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Customer> & { id: string }) => {
      const { data, error } = await supabase
        .from("customers")
        .update(mapCustomerToDb(updates))
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return mapDbToCustomer(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Podaci o klijentu ažurirani");
    },
    onError: (err: Error) => {
      toast.error("Greška pri ažuriranju klijenta", { description: err.message });
    },
  });

  const deleteCustomer = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("customers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Klijent obrisan");
    },
    onError: (err: Error) => {
      toast.error("Greška pri brisanju klijenta", { description: err.message });
    },
  });

  return {
    customers,
    isLoading,
    error,
    createCustomer,
    updateCustomer,
    deleteCustomer,
  };
}
