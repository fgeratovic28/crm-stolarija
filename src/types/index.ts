export type JobStatus =
  | "new"
  | "quote_sent"
  | "accepted"
  | "measuring"
  | "measurement_processing"
  | "ready_for_work"
  | "waiting_material"
  | "in_production"
  | "scheduled"
  | "installation_in_progress"
  | "completed"
  | "complaint"
  | "service"
  | "canceled";

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

export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected";
export interface QuoteLine {
  id: string;
  quoteId: string;
  sortOrder: number;
  description: string;
  quantity: number;
  unitPrice: number;
}

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

/** Timestamp-ovi akcija na terenu (čuva se u `field_reports.details`). */
export interface FieldReportDetails {
  arrivedAt?: string;
  canceledAt?: string;
  finishedAt?: string;
  issueReportedAt?: string;
  additionalReqAt?: string;
  productionCompletedItems?: Array<{
    profileCode?: string;
    profileTitle: string;
    barcode: string;
    completedAt?: string;
  }>;
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
  /** Poslednja procena sati ugradnje sa merenja (kolona `jobs.estimated_installation_hours`). */
  estimatedInstallationHours?: number | null;
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
  /** Evidentirane uplate za posao (potrebno za finansijske filtere po periodu). */
  payments?: Payment[];
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
  /** Žiro / tekući račun dobavljača (porudžbenica). */
  bankAccount?: string;
  /** PIB dobavljača. */
  pib?: string;
  /** Podrazumevani podaci za porudžbenicu (povlače se pri izboru dobavljača u narudžbini). */
  nbShippingMethod?: string;
  /** Broj dana od datuma narudžbine do roka plaćanja; prazno = bez automatskog datuma. */
  nbPaymentDaysAfterOrder?: number;
  nbLegalReference?: string;
  nbPaymentNote?: string;
  nbDeliveryAddressOverride?: string;
}

/** Jedna stavka na narudžbini / porudžbenici (iznos bez PDV-a). */
export interface MaterialOrderLine {
  description: string;
  quantity: number;
  unit: string;
  /** Ukupan iznos stavke bez PDV-a (RSD). */
  lineNet: number;
  materialType?: MaterialType;
  /** ID-ovi stavki krojne liste (`job_items`) ako je linija nastala iz importa / nabavke. */
  sourceJobItemIds?: string[];
  /** Količina iz originalne narudžbine pre SEF usklađivanja (JSON `nb_lines`). */
  orderedQuantity?: number;
}

export interface MaterialOrder {
  id: string;
  /** Javni token za QR link ka istoj porudžbenici (bez CRM naloga). */
  publicShareToken?: string;
  jobId?: string;
  materialType: MaterialType;
  supplierId: string;
  supplier: string; // Keep for backward compatibility/display
  supplierContact: string; // Keep for display
  /** Adresa dobavljača (iz šifarnika), za štampu. */
  supplierAddress?: string;
  supplierPhone?: string;
  supplierEmail?: string;
  /** Žiro / tekući račun dobavljača (šifarnik). */
  supplierBankAccount?: string;
  supplierPib?: string;
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
  /** Tekst reklamacije / primedbe dobavljaču (npr. posle SEF provere). */
  supplierComplaintNote?: string;
  /** Kada je korisnik potvrdio usaglašenost sa učitanim SEF XML-om. */
  sefReconciliationAt?: string;
  deliveryStatus: "pending" | "shipped" | "delivered" | "partial";
  quantityVerified: boolean; // Keep for display
  allDelivered: boolean;
  job?: {
    id: string;
    jobNumber: string;
  };
  /** Stavke za štampu / javni prikaz (ukupna cena = zbir lineNet). */
  nbLines?: MaterialOrderLine[];
  /** Pun naziv stavke na narudžbenici (inače se koristi vrsta materijala). */
  nbLineDescription?: string;
  nbQuantity?: number;
  nbUnit?: string;
  /** Stopa PDV za obračun (npr. 20). */
  nbVatRatePercent?: number;
  nbBuyerBankAccount?: string;
  nbShippingMethod?: string;
  nbPaymentDueDate?: string;
  nbPaymentNote?: string;
  nbLegalReference?: string;
  /** Isporuka na drugu adresu od podataka kupca u poslu. */
  nbDeliveryAddressOverride?: string;
}

export interface JobItem {
  id: string;
  jobId: string;
  profileCode: string;
  profileTitle: string;
  color: string;
  cutLength: number;
  quantity: number;
  barcode: string;
  isCompleted: boolean;
  completedAt?: string;
  metadata: Record<string, unknown>;
}

export interface WorkOrder {
  id: string;
  jobId: string;
  type: WorkOrderType;
  description: string;
  assignedTeamId?: string;
  /** Ime tima sa join-a `teams`, za prikaz (npr. detalji posla). */
  assignedTeamName?: string;
  date: string;
  status: "pending" | "in_progress" | "completed" | "canceled";
  attachmentName?: string;
  installationRef?: string;
  productionRef?: string;
  createdAt?: string;
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
  details?: FieldReportDetails;
  /** Procena trajanja ugradnje u satima (merenje); kolona `field_reports.estimated_installation_hours`. */
  estimatedInstallationHours?: number | null;
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
  /** Fajl vezan za narudžbinu materijala (prilozi) */
  materialOrderId?: string;
  name: string;
  category: FileCategory;
  size: string;
  uploadedBy: string;
  uploadedAt: string;
  type: string;
  /** R2 object key (npr. files/jobs/...) za brisanje; ako nedostaje, zapis je stariji */
  storageKey?: string;
  /** Javni URL u R2 (sačuvan pri otpremi) */
  storageUrl?: string;
}

export interface Quote {
  id: string;
  jobId: string;
  quoteNumber: string;
  versionNumber: number;
  /** Finalna ponuda za posao (ako je podržano u bazi). */
  isFinalOffer?: boolean;
  /** Da li su jedinične cene u ovoj ponudi sa uključenim PDV-om. */
  pricesIncludeVat?: boolean;
  status: QuoteStatus;
  totalAmount: number;
  note?: string;
  fileUrl?: string;
  fileStorageKey?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  lines: QuoteLine[];
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
  /** null dok administrator ne dodeli ulogu u bazi. */
  role: UserRole | null;
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

export const JOB_STATUS_CONFIG: Record<
  JobStatus,
  { label: string; color: string; automationHint: string }
> = {
  new: {
    label: "Upit",
    color: "bg-slate-500/15 text-slate-700 dark:text-slate-200",
    automationHint: "Početni status posla; prelazi u „Merenje“ kad teren započne RN merenja (ili ručno na „Ponuda poslata“).",
  },
  quote_sent: {
    label: "Ponuda poslata",
    color: "bg-sky-500/15 text-sky-800 dark:text-sky-200",
    automationHint: "Menja se samo ručno iz padajuće liste (nema automatskog prelaza u ovaj status).",
  },
  accepted: {
    label: "Prihvaćeno",
    color: "bg-success text-success-foreground",
    automationHint: "Ručno potvrđen posao; automatska pravila ne prepisuju ovaj status dok se ručno ne promeni.",
  },
  measuring: {
    label: "Merenje",
    color: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
    automationHint:
      "Postoji RN merenja / kontrola mera koji još nije završen (na čekanju ili u toku). Posle završetka svih → „U proizvodnji“.",
  },
  measurement_processing: {
    label: "Obrada mera",
    color: "bg-violet-500/15 text-violet-800 dark:text-violet-200",
    automationHint: "Ručno označena obrada rezultata merenja; automatska pravila ga ne prepisuju.",
  },
  ready_for_work: {
    label: "Spremno za rad",
    color: "bg-teal-500/15 text-teal-800 dark:text-teal-200",
    automationHint: "Ručna operativna priprema pre nabavke/proizvodnje; automatska pravila ga ne prepisuju.",
  },
  waiting_material: {
    label: "Čeka materijal",
    color: "bg-amber-500/20 text-amber-900 dark:text-amber-100",
    automationHint: "Ručno označeno čekanje materijala; automatska pravila ga ne prepisuju.",
  },
  in_production: {
    label: "U proizvodnji",
    color: "bg-amber-500/20 text-amber-900 dark:text-amber-100",
    automationHint: "Merenje završeno; čeka se ili traje RN proizvodnje. Posle završetka proizvodnje → „Čeka ugradnju“.",
  },
  scheduled: {
    label: "Čeka ugradnju",
    color: "bg-indigo-500/15 text-indigo-800 dark:text-indigo-200",
    automationHint: "Proizvodnja završena; RN ugradnje su na čekanju. Kad montaža krene → „Ugradnja u toku“.",
  },
  installation_in_progress: {
    label: "Ugradnja u toku",
    color: "bg-primary/15 text-primary",
    automationHint: "RN ugradnja je u toku. Posle završetka, terenski izveštaj određuje „Završen“ ili „Reklamacija“.",
  },
  completed: {
    label: "Završen",
    color: "bg-success text-success-foreground",
    automationHint: "Montaža završena i terenski izveštaj bez prijavljenog problema (ili ručno postavljeno).",
  },
  complaint: {
    label: "Reklamacija",
    color: "bg-destructive text-destructive-foreground",
    automationHint: "Može automatski posle ugradnje ako izveštaj nije „sve u redu“. Dalje menjanje ručno.",
  },
  service: {
    label: "Servis",
    color: "bg-muted text-muted-foreground",
    automationHint: "Menja se samo ručno (servisni režim); automatska pravila statusa se ne primenjuju.",
  },
  canceled: {
    label: "Otkazan",
    color: "bg-muted text-muted-foreground",
    automationHint: "Posao je obustavljen/otkazan ručno; automatska pravila ne prepisuju ovaj status.",
  },
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
    description: "Upravljanje kupcima, poslovima, aktivnostima i dokumentima na poslu. Ažuriranje statusa poslova.",
    access: ["Kupci", "Poslovi", "Aktivnosti", "Fajlovi na poslu"],
  },
  finance: {
    label: "Finansije",
    description: "Upravljanje finansijama, uplatama i finansijskim izveštajima.",
    access: ["Finansije", "Plaćanja", "Izveštaji"],
  },
  procurement: {
    label: "Nabavka",
    description: "Upravljanje narudžbinama materijala, dobavljačima i zalihama.",
    access: ["Narudžbine materijala", "Dobavljači", "Zalihe i vozila"],
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
