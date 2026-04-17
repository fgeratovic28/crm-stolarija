export type JobStatus =
  | "new"
  | "active"
  | "in_progress"
  | "waiting_materials"
  | "scheduled"
  | "completed"
  | "complaint"
  | "service";

export type CommunicationType = "email" | "phone" | "in_person" | "viber" | "other";

export type WorkOrderType =
  | "measurement"
  | "measurement_verification"
  | "installation"
  | "complaint"
  | "service"
  | "production"
  | "site_visit"
  | "control_visit";

export type MaterialType =
  | "glass"
  | "mosquito_net"
  | "profile"
  | "shutters"
  | "sills"
  | "boards"
  | "hardware"
  | "sealant"
  | "other";

export type UserRole =
  | "admin"
  | "office"
  | "finance"
  | "procurement"
  | "production"
  | "montaza"
  | "teren";

export type FileCategory =
  | "offers"
  | "communication"
  | "finance"
  | "supplier"
  | "work_order"
  | "field_photos"
  | "reports";

export interface Customer {
  id: string;
  customerNumber: string;
  fullName: string;
  contactPerson: string;
  billingAddress: string;
  installationAddress: string;
  phones: string[];
  emails: string[];
  pib: string;
  registrationNumber: string;
  createdAt: string;
}

export interface JobQuoteLine {
  id: string;
  jobId: string;
  sortOrder: number;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface Job {
  id: string;
  jobNumber: string;
  customer: Customer;
  status: JobStatus;
  summary: string;
  totalPrice: number;
  vatAmount: number;
  priceWithoutVat: number;
  advancePayment: number;
  unpaidBalance: number;
  createdAt: string;
  scheduledDate?: string;
  /** Jedinična cena stavki je sa PDV-om (ukupno = zbir stavki); inače bez PDV-a (PDV se dodaje na zbir). */
  pricesIncludeVat: boolean;
  quoteLines: JobQuoteLine[];
  /** Korisnik (nalog) koji je kreirao posao */
  createdBy?: { id: string; name: string };
  statusLocked?: boolean;
  /** Poslednja promena statusa (za SLA / zastoj u istom statusu) */
  statusChangedAt?: string;
  /** Adrese vezane za ovaj posao (iz reda jobs), ako su unete */
  jobBillingAddress?: string;
  jobInstallationAddress?: string;
  customerPhone?: string;
}

export interface Activity {
  id: string;
  jobId: string;
  type: CommunicationType;
  description: string;
  createdBy: string;
  createdAt: string;
  attachmentName?: string;
}

export interface Payment {
  id: string;
  jobId: string;
  amount: number;
  date: string;
  includesVat: boolean;
  note?: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  materialTypes: MaterialType[];
  active: boolean;
}

export interface MaterialOrder {
  id: string;
  jobId?: string;
  materialType: MaterialType;
  supplierId: string;
  supplier: string; // Keep for backward compatibility/display
  supplierContact: string; // Keep for display
  orderDate: string; // This is the request date
  requestDate: string; // New: explicit request date
  deliveryDate?: string; // New: actual delivery date
  expectedDelivery: string;
  supplierPrice: number; // Keep for display
  price: number; // New: renamed from supplierPrice
  paid: boolean;
  requestFile?: string; // New: file link/name
  quoteFile?: string; // New: file link/name
  deliveryVerified: boolean; // New: renamed from quantityVerified
  barcode?: string;
  notes?: string;
  deliveryStatus: "pending" | "shipped" | "delivered" | "partial";
  quantityVerified: boolean; // Keep for display
  allDelivered: boolean;
  job?: {
    id: string;
    jobNumber: string;
  };
}

export interface WorkOrder {
  id: string;
  jobId: string;
  type: WorkOrderType;
  description: string;
  assignedTeamId?: string;
  date: string;
  status: "pending" | "in_progress" | "completed" | "canceled";
  attachmentName?: string;
  installationRef?: string;
  productionRef?: string;
}

export interface FieldReport {
  id: string;
  jobId: string;
  address: string;
  arrived: boolean;
  arrivalDate?: string;
  siteCanceled: boolean;
  cancelReason?: string;
  jobCompleted: boolean;
  everythingOk: boolean;
  issueDescription?: string;
  handoverDate?: string;
  images: string[];
  missingItems: string[];
  additionalNeeds: string[];
  measurements?: string;
  generalNotes?: string;
  workOrderId?: string;
  workOrderType?: WorkOrderType;
  teamId?: string;
  job?: {
    id: string;
    jobNumber: string;
    customer: {
      fullName: string;
    };
  };
}

export interface AppFile {
  id: string;
  jobId?: string;
  name: string;
  category: FileCategory;
  size: string;
  uploadedBy: string;
  uploadedAt: string;
  type: string;
}

export interface Team {
  id: string;
  name: string;
  contactPhone: string;
  members: string[];
  specialty?: string;
  active: boolean;
}

export interface AppUser {
  id: string;
  name: string;
  fullName?: string;
  email: string;
  role: UserRole;
  avatar?: string;
  active: boolean;
  teamId?: string;
}

export type VehicleStatus = "active" | "in_service" | "archived";

export interface Vehicle {
  id: string;
  vehicleName: string;
  registrationNumber?: string | null;
  brandModel?: string | null;
  status: VehicleStatus;
  registrationDate?: string | null;
  expirationDate?: string | null;
  serviceNotes?: string | null;
  serviceKilometers?: number | null;
  assignedWorkerId?: string | null;
  generalNotes?: string | null;
  lastServiceDate?: string | null;
  trafficPermitImageUrl?: string | null;
  insuranceImageUrl?: string | null;
  serviceRecordImageUrl?: string | null;
  additionalImageUrls?: string[] | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface Worker {
  id: string;
  fullName: string;
  position?: string | null;
  phone?: string | null;
  active: boolean;
  userId?: string | null;
  teamId?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface WorkerSickLeave {
  id: string;
  workerId: string;
  reason: string;
  startDate?: string | null;
  endDate?: string | null;
  daysCount?: number | null;
  note?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export type Statuses = JobStatus;

export const JOB_STATUS_CONFIG: Record<JobStatus, { label: string; color: string }> = {
  new: { label: "Novi", color: "bg-info text-info-foreground" },
  active: { label: "Aktivan", color: "bg-success text-success-foreground" },
  in_progress: { label: "U toku", color: "bg-primary text-primary-foreground" },
  waiting_materials: { label: "Čeka materijal", color: "bg-warning text-warning-foreground" },
  scheduled: { label: "Zakazan", color: "bg-info text-info-foreground" },
  completed: { label: "Završen", color: "bg-success text-success-foreground" },
  complaint: { label: "Reklamacija", color: "bg-destructive text-destructive-foreground" },
  service: { label: "Servis", color: "bg-muted text-muted-foreground" },
};

export const VEHICLE_STATUS_CONFIG: Record<
  VehicleStatus,
  { label: string; variant: "default" | "success" | "warning" | "danger" | "info" | "muted" }
> = {
  active: { label: "Aktivno", variant: "success" },
  in_service: { label: "U servisu", variant: "warning" },
  archived: { label: "Arhivirano", variant: "muted" },
};

export const ROLE_CONFIG: Record<UserRole, { label: string; description: string; access: string[] }> = {
  admin: {
    label: "Administrator",
    description: "Potpun pristup svim modulima, upravljanje korisnicima, timovima i podešavanja sistema.",
    access: ["Svi moduli", "Upravljanje korisnicima", "Podešavanja", "Izveštaji"],
  },
  office: {
    label: "Kancelarija / Prodaja",
    description: "Upravljanje kupcima, poslovima, aktivnostima i ponudama. Ažuriranje statusa poslova.",
    access: ["Kupci", "Poslovi", "Aktivnosti", "Ponude"],
  },
  finance: {
    label: "Finansije",
    description: "Upravljanje finansijama, fakturama, uplatama i finansijskim izveštajima.",
    access: ["Finansije", "Fakture", "Plaćanja", "Izveštaji"],
  },
  procurement: {
    label: "Nabavka",
    description: "Upravljanje narudžbinama materijala, dobavljačima i zalihama.",
    access: ["Narudžbine materijala", "Dobavljači", "Zalihe"],
  },
  production: {
    label: "Proizvodnja",
    description: "Pristup radnim nalozima za proizvodnju, tehničkim detaljima, merama i rokovima.",
    access: ["Radni nalozi", "Tehnički detalji", "Statusi proizvodnje"],
  },
  montaza: {
    label: "Montaža",
    description: "Pristup radnim nalozima za ugradnju dodeljenim sopstvenom timu, montažni izveštaj i osnovni podaci sa terena.",
    access: ["Dodeljeni nalozi za ugradnju", "Kontrolna tabla", "Radni nalozi"],
  },
  teren: {
    label: "Teren",
    description: "Pristup terenskim nalozima (merenje, servis, reklamacije itd.) dodeljenim sopstvenom timu i terenski izveštaj.",
    access: ["Dodeljeni terenski nalozi", "Terenski izveštaji", "Kontrolna tabla", "Radni nalozi"],
  },
};
