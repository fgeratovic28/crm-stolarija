import { useState } from "react";
import { Truck, Plus, Search, Edit2, Trash2, Mail, Phone, MapPin, CheckCircle2, XCircle } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageTransition } from "@/components/shared/PageTransition";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CardListSkeleton } from "@/components/shared/Skeletons";
import { useSuppliers } from "@/hooks/use-suppliers";
import { useRole } from "@/contexts/RoleContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SupplierForm } from "@/components/shared/SupplierForm";
import { GenericBadge } from "@/components/shared/StatusBadge";
import type { Supplier } from "@/types";
import type { SupplierFormValues } from "@/components/shared/SupplierForm";

export default function SuppliersPage() {
  const { suppliers, isLoading, createSupplier, updateSupplier, deleteSupplier } = useSuppliers();
  const { canPerformAction } = useRole();
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  const filtered = suppliers?.filter(s => 
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.contactPerson.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleCreate = (data: SupplierFormValues) => {
    createSupplier.mutate(data, {
      onSuccess: () => setIsModalOpen(false),
    });
  };

  const handleUpdate = (data: SupplierFormValues) => {
    if (editingSupplier) {
      updateSupplier.mutate({ ...editingSupplier, ...data }, {
        onSuccess: () => {
          setIsModalOpen(false);
          setEditingSupplier(null);
        },
      });
    }
  };

  const handleDelete = (id: string) => {
    if (confirm("Da li ste sigurni da želite da obrišete ovog dobavljača?")) {
      deleteSupplier.mutate(id);
    }
  };

  const openEdit = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setIsModalOpen(true);
  };

  const openCreate = () => {
    setEditingSupplier(null);
    setIsModalOpen(true);
  };

  return (
    <AppLayout title="Dobavljači">
      <PageTransition>
        <Breadcrumbs items={[{ label: "Dobavljači" }]} />
        
        <PageHeader
          title="Dobavljači"
          description="Upravljanje listom dobavljača materijala"
          icon={Truck}
          actions={
            canPerformAction("create_order") && (
              <Button onClick={openCreate}>
                <Plus className="w-4 h-4 mr-1.5" /> Novi dobavljač
              </Button>
            )
          }
        />

        <div className="mb-6">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Pretraži dobavljače..."
              className="pl-9"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {isLoading ? (
          <CardListSkeleton count={3} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered?.map((supplier) => (
              <div key={supplier.id} className="bg-card rounded-xl border border-border p-5 hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-semibold text-lg">{supplier.name}</h3>
                    <p className="text-sm text-muted-foreground">{supplier.contactPerson}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {supplier.active ? (
                      <CheckCircle2 className="w-4 h-4 text-success" />
                    ) : (
                      <XCircle className="w-4 h-4 text-destructive" />
                    )}
                    <GenericBadge 
                      label={supplier.active ? "Aktivan" : "Neaktivan"} 
                      variant={supplier.active ? "success" : "muted"} 
                    />
                  </div>
                </div>

                <div className="space-y-2 mb-6">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="w-3.5 h-3.5" />
                    <span>{supplier.phone}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Mail className="w-3.5 h-3.5" />
                    <span className="truncate">{supplier.email || "Nema email"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                    <span className="line-clamp-1">{supplier.address}</span>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-border">
                  {canPerformAction("create_order") && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => openEdit(supplier)}>
                        <Edit2 className="w-3.5 h-3.5 mr-1.5" /> Izmeni
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(supplier.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="w-full sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingSupplier ? "Izmena dobavljača" : "Novi dobavljač"}</DialogTitle>
            </DialogHeader>
            <SupplierForm
              key={isModalOpen ? (editingSupplier?.id ?? "new") : "closed"}
              initialData={editingSupplier || {}}
              onSubmit={editingSupplier ? handleUpdate : handleCreate}
              onCancel={() => setIsModalOpen(false)}
              isLoading={createSupplier.isPending || updateSupplier.isPending}
            />
          </DialogContent>
        </Dialog>
      </PageTransition>
    </AppLayout>
  );
}
