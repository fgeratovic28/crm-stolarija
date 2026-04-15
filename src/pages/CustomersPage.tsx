import { useParams, useNavigate } from "react-router-dom";
import { Users, ArrowLeft } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageTransition } from "@/components/shared/PageTransition";
import { CustomerForm } from "@/components/shared/CustomerForm";
import { useCustomers } from "@/hooks/use-customers";
import { Button } from "@/components/ui/button";
import type { Customer } from "@/types";

export default function CustomersPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { customers, createCustomer, updateCustomer, isLoading } = useCustomers();

  const isEditing = !!id;
  const currentCustomer = customers?.find((c) => c.id === id);

  type CustomerFormValues = Omit<Customer, "id" | "customerNumber" | "createdAt" | "phones" | "emails"> & {
    phones: { value: string }[];
    emails: { value: string }[];
  };

  const handleSubmit = (data: CustomerFormValues) => {
    const transformedData = {
      ...data,
      phones: data.phones.map((p: { value: string }) => p.value.trim()).filter(Boolean),
      emails: data.emails.map((e: { value: string }) => e.value.trim()).filter(Boolean),
    };

    if (isEditing) {
      updateCustomer.mutate({ id: id as string, ...transformedData }, {
        onSuccess: () => navigate("/jobs?tab=customers"),
      });
    } else {
      createCustomer.mutate(transformedData, {
        onSuccess: () => navigate("/jobs?tab=customers"),
      });
    }
  };

  return (
    <AppLayout title={isEditing ? "Izmena klijenta" : "Novi klijent"}>
      <PageTransition>
        <Breadcrumbs items={[
          { label: "Kupci / Poslovi", href: "/jobs" },
          { label: isEditing ? "Izmena klijenta" : "Novi klijent" }
        ]} />
        
        <PageHeader
          title={isEditing ? "Izmena klijenta" : "Novi klijent"}
          description={isEditing ? `Ažuriranje podataka za ${currentCustomer?.fullName}` : "Unesite podatke o novom klijentu"}
          icon={Users}
          actions={
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
              <ArrowLeft className="w-4 h-4 mr-1.5" /> Nazad
            </Button>
          }
        />

        <div className="max-w-3xl bg-card rounded-xl border border-border p-6 shadow-sm">
          <CustomerForm
            initialData={currentCustomer}
            onSubmit={handleSubmit}
            onCancel={() => navigate(-1)}
            isLoading={isLoading || createCustomer.isPending || updateCustomer.isPending}
          />
        </div>
      </PageTransition>
    </AppLayout>
  );
}
