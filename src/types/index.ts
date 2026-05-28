export type JobStatus =
  | "new"
  | "quote_sent"
  | "final_quote_sent"
  | "final_quote_accepted_pending_payment"
  | "accepted"
  | "measuring"
  | "measurement_processing"
  | "ready_for_work"
  | "waiting_material"
  | "partial_in_production"
  | "in_production"
  | "scheduled"
  | "installation_in_progress"
  | "installation_done_unpaid"
  | "completed"
  | "installation_problem"
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

export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "zamenjena";

/** Kanal slanja ponude (`quotes.delivery_method`). */
export type QuoteDeliveryMethod =
  | "not_sent"
  | "email_system"
  | "viber_whatsapp"
  | "printed_in_person"
  | "other";
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
  /** Stan na adresi ugradnje kupca (`customers.installation_apartment`). */
  installationApartment?: string;
  /** Sprat na adresi ugradnje kupca (`customers.installation_floor`). */
  installationFloor?: string;
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
  /** Prijava „sa predračuna“: ne kreirati odmah automatski RN ugradnje; sledeći RN posle triage na dashboardu. */
  invoiceMissingDeferAutoInstallationWo?: boolean;
  /** Pozicije sa predračuna (hitno obaveštenje); trigger šalje notify po stavci — izbegava duplo slanje sa klijenta. */
  invoiceMissingSitePositions?: string[];
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
  /** Pod-posao „dodatni radovi“ — veza na glavni posao. */
  parentJobId?: string | null;
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
  /** Formatiran datum ugradnje (prikaz). */
  scheduledDate?: string;
  /** Sirovi `jobs.scheduled_date` (ISO) — za prikaz vremena. */
  scheduledAt?: string;
  /** Jedinična cena stavki je sa PDV-om (ukupno = zbir stavki); inače bez PDV-a (PDV se dodaje na zbir). */
  pricesIncludeVat: boolean;
  /** Stopa PDV za izlaznu fakturaciju (0 ili 20). Stariji zapisi bez stope koriste 0 u bazi. */
  vatRatePercent: number;
  quoteLines: JobQuoteLine[];
  /** Korisnik (nalog) koji je kreirao posao */
  createdBy?: { id: string; name: string };
  statusLocked?: boolean;
  /** Poslednja promena statusa (za SLA / zastoj u istom statusu) */
  statusChangedAt?: string;
  /** Prvi prelazak u „Završen“ (baza: `first_completed_at`). */
  firstCompletedAt?: string | null;
  /** Adrese vezane za ovaj posao (iz reda jobs), ako su unete */
  jobBillingAddress?: string;
  jobInstallationAddress?: string;
  /** Stan na adresi ugradnje ovog posla (`jobs.installation_apartment`). */
  jobInstallationApartment?: string;
  /** Sprat na adresi ugradnje ovog posla (`jobs.installation_floor`). */
  jobInstallationFloor?: string;
  customerPhone?: string;
  /** Kancelarija je potvrdila da početna ponuda važi posle merenja (`jobs.post_measurement_keep_initial_quote`). */
  postMeasurementKeepInitialQuote?: boolean;
  /** Evidentirane uplate za posao (potrebno za finansijske filtere po periodu). */
  payments?: Payment[];
}

export interface Activity {
  id: string;
  jobId: string;
  type: CommunicationType;
  description: string;
  systemKey?: string;
  createdBy: string;
  createdAt: string;
  attachmentName?: string;
  attachmentFileId?: string;
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
  /** Kategorija dobavljača (slobodan unos, uz preporučene vrednosti). */
  category?: string;
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

/** Plaćanje nabavke u avansu — evidencija na `material_orders`. */
export type MaterialOrderPaymentStatus = "pending" | "paid_advance";

/** Jedna stavka na narudžbini / porudžbenici (iznos bez PDV-a). */
export interface MaterialOrderLine {
  description: string;
  quantity: number;
  unit: string;
  /** Normalizovani podaci iz Excel uvoza — obavezni za štampu PDF porudžbine. */
  procurementMeta?: {
    position?: string;
    work_order?: string;
    article: string;
    article_code?: string;
    color?: string;
    uom?: string;
    length_mm?: number | null;
    /** true = ručno u CRM-u (`M-` u barkodu); false = iz Excel/CSV. Ako nedostaje, barkod ostaje u starom formatu. */
    manual_line?: boolean;
  };
  /** Ukupan iznos stavke bez PDV-a (RSD). */
  lineNet: number;
  materialType?: MaterialType;
  /** ID-ovi stavki krojne liste (`job_items`) ako je linija nastala iz importa / nabavke. */
  sourceJobItemIds?: string[];
  /** Količina iz originalne narudžbine pre SEF usklađivanja (JSON `nb_lines`). */
  orderedQuantity?: number;
  /** Veza ka originalnoj porudžbini / liniji kada je ovo linija iz „Porudžbine po nedostatku". */
  shortageSource?: {
    parentOrderId: string;
    parentLineIndex: number;
    missingQty: number;
    damagedQty: number;
    /** ID reklamacije (`procurement_complaints`) kreirane u istoj transakciji. */
    complaintId?: string;
  };
}

export interface MaterialOrder {
  id: string;
  /** Javni token za QR link ka istoj porudžbenici (bez CRM naloga). */
  publicShareToken?: string;
  jobId?: string;
  requiredForProductionStart?: boolean;
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
  /** Evidencija fakture (ručno); nezavisno od `paid` osim pri „Označi plaćeno (avans)”. */
  invoiceNumber?: string;
  invoiceAmount?: number;
  invoiceFileUrl?: string;
  paymentStatus?: MaterialOrderPaymentStatus;
  requestFile?: string; // New: file link/name
  quoteFile?: string; // New: file link/name
  deliveryVerified: boolean; // New: renamed from quantityVerified
  barcode?: string;
  notes?: string;
  /** Tekst reklamacije / primedbe dobavljaču (npr. posle SEF provere). */
  supplierComplaintNote?: string;
  /** Kada je korisnik potvrdio usaglašenost sa učitanim SEF XML-om. */
  sefReconciliationAt?: string;
  deliveryStatus:
    | "pending"
    | "email_sent"
    | "sent_to_supplier"
    | "waiting_for_payment"
    | "waiting_for_delivery"
    | "shipped"
    | "delivered"
    | "partial"
    /** Magacin: sve stavke primljene ispravno (posle finalize prijema). */
    | "materials_received"
    /** Magacin: ima reklamacije (nedostatak / oštećenje) u procurement_complaints. */
    | "received_with_issues";
  /** R2 URL predračuna od dobavljača (posle Step 5). */
  supplierProformaUrl?: string;
  /** Iznos sa predračuna (RSD), usklađen sa unosom u Step 5. */
  supplierProformaTotal?: number;
  /** Ukupan ulazni PDV plaćen / evidentiran kod dobavljača (predračun/faktura/XML). */
  supplierIncomingVatAmount?: number;
  quantityVerified: boolean; // Keep for display
  allDelivered: boolean;
  job?: {
    id: string;
    jobNumber: string;
    customerName?: string;
  };
  /** Smart Excel reader: dinamička tabela (`MaterialOrderItemsJsonV1`, verzija 1). */
  itemsJson?: unknown;
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
  /** Referenca na originalnu porudžbinu iz koje je nastala "Porudžbina po nedostatku". */
  parentOrderId?: string | null;
  /** true → sub-porudžbina kreirana automatski pri prijavi manjka / oštećenja u magacinu. */
  isShortageOrder?: boolean;
  /**
   * Porudžbina po nedostatku kreirana iz hitnog alerta „nedostatak sa ugradnje“ (predračun).
   * Dozvoljava predračun/cenu i standardni nabavni tok na kartici shortage narudžbine.
   */
  siteMissingFromInstallation?: boolean;
  /**
   * Za hitnu Porudžbinu po nedostatku sa ugradnje: posle prijema u magacin, ako je true,
   * čeka se proizvodnja pre zakaživanja dopune ugradnje.
   */
  requiresProduction?: boolean;
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

export interface WorkOrderItem {
  id: string;
  workOrderId: string;
  description: string;
  isCompleted: boolean;
  /** Unešene mere (mer RN), prikažu se u terenskom izveštaju uz stavku. */
  measurements?: string;
}

export interface WorkOrder {
  id: string;
  jobId: string;
  type: WorkOrderType;
  description: string;
  /** Kod merenja: gde se obavlja merenje (npr. "Objekat, 2. sprat"). */
  measurementLocation?: string;
  /** Kod merenja: šta se konkretno meri (npr. "5 PVC prozora + balkonska vrata"). */
  measurementScope?: string;
  assignedTeamId?: string;
  /** Ime tima sa join-a `teams`, za prikaz (npr. detalji posla). */
  assignedTeamName?: string;
  date: string;
  status: "pending" | "in_progress" | "completed" | "canceled";
  /** Prilog uz nalog (`work_orders.file_id` → `files`). */
  attachmentFileId?: string;
  attachmentName?: string;
  installationRef?: string;
  productionRef?: string;
  createdAt?: string;
  /** Trenutak pokretanja naloga (pending → in_progress); dolazak na teren za izveštaj. */
  fieldStartedAt?: string;
  /** Trenutak završetka naloga (status „završen“). */
  fieldCompletedAt?: string;
}

/** Kreiranje naloga opciono nosi liste stavki (ček lista na terenu). */
export type WorkOrderCreateInput = Omit<WorkOrder, "id"> & { checklistItems?: string[] };

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
  /** Montaža: samo upit za novu ponudu (bez installation_problem); kolona `field_reports.addon_quote_site_request`. */
  addonQuoteSiteRequest?: boolean;
  teamId?: string;
  /** Ime tima dodeljenog radnom nalogu (iz `work_orders.team_id`). */
  assignedTeamName?: string;
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

export interface QuoteFileAttachment {
  url: string;
  storageKey?: string;
  /** Izvorno ime fajla pri otpremi (opciono). */
  filename?: string;
}

export interface Quote {
  id: string;
  jobId: string;
  quoteNumber: string;
  versionNumber: number;
  /** Korisnički naziv verzije (kolona `version_name`). */
  versionName?: string;
  /** Finalna ponuda za posao (ako je podržano u bazi). */
  isFinalOffer?: boolean;
  /** Da li su jedinične cene u ovoj ponudi sa uključenim PDV-om. */
  pricesIncludeVat?: boolean;
  /** Stopa PDV (0 ili 20) — kopira se na posao pri prihvatanju. */
  vatRatePercent?: number;
  status: QuoteStatus;
  /** Način dostave klijentu (evidencija). */
  deliveryMethod: QuoteDeliveryMethod;
  totalAmount: number;
  note?: string;
  fileUrl?: string;
  fileStorageKey?: string;
  /** Svi otpremeni fajlovi (`file_url` / `file_storage_key` slede prvi red). */
  fileAttachments?: QuoteFileAttachment[];
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  lines: QuoteLine[];
  /** Dopunska ponuda posle glavnog toka; prihvatanje ne menja status posla (`quotes.is_addon_work`). */
  isAddonWork?: boolean;
}

export interface Team {
  id: string;
  name: string;
  contactPhone: string;
  members: string[];
  /** Prikaz uloge tima (izvedeno iz uloga članova; nije posebno polje u bazi). */
  fieldRoleLabel: string;
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
    color: "bg-slate-500/20 text-slate-900 dark:text-slate-100",
    automationHint: "Početni status posla; prelazi u „Merenje“ kad teren započne RN merenja (ili ručno na „Ponuda poslata“).",
  },
  quote_sent: {
    label: "Ponuda poslata",
    color: "bg-sky-500/25 text-sky-950 dark:text-sky-50",
    automationHint: "Menja se samo ručno iz padajuće liste (nema automatskog prelaza u ovaj status).",
  },
  final_quote_sent: {
    label: "Poslata finalna ponuda",
    color: "bg-blue-600/25 text-blue-950 dark:text-blue-50",
    automationHint:
      "Postavlja se kada se klijentu pošalje finalna ponuda iz faze „Obrada mera“ (posle merenja); automatska pravila ne prepisuju ovaj status do prihvatanja ponude.",
  },
  final_quote_accepted_pending_payment: {
    label: "Finalna ponuda prihvaćena / Čeka uplatu",
    color: "bg-emerald-700/25 text-emerald-950 dark:text-emerald-50",
    automationHint:
      "Posle prihvatanja finalne ponude posle merenja (ili potvrde početne ponude posle merenja), dok nema evidentirane uplate posle tog trenutka; posle uplate prelazi u „Spremno za rad“.",
  },
  accepted: {
    label: "Načelno prihvaćeno",
    color: "bg-emerald-600/25 text-emerald-950 dark:text-emerald-50",
    automationHint: "Ručno potvrđen posao; automatska pravila ne prepisuju ovaj status dok se ručno ne promeni.",
  },
  measuring: {
    label: "Merenje",
    color: "bg-lime-500/25 text-lime-950 dark:text-lime-50",
    automationHint:
      "Postoji RN merenja / kontrola mera koji još nije završen (na čekanju ili u toku). Posle završetka svih → „U proizvodnji“.",
  },
  measurement_processing: {
    label: "Obrada mera",
    color: "bg-violet-500/25 text-violet-950 dark:text-violet-50",
    automationHint: "Ručno označena obrada rezultata merenja; automatska pravila ga ne prepisuju.",
  },
  ready_for_work: {
    label: "Spremno za rad",
    color: "bg-teal-500/25 text-teal-950 dark:text-teal-50",
    automationHint:
      "Aktivira se automatski tek kad je prihvaćena finalna ponuda posle merenja (ili potvrđeno zadržavanje početne) i evidentirana uplata posle tog trenutka; zatim nabavka / RN.",
  },
  waiting_material: {
    label: "Čeka materijal",
    color: "bg-amber-500/30 text-amber-950 dark:text-amber-50",
    automationHint: "Ručno označeno čekanje materijala; automatska pravila ga ne prepisuju.",
  },
  partial_in_production: {
    label: "Delimično u proizvodnji",
    color: "bg-orange-500/25 text-orange-950 dark:text-orange-50",
    automationHint:
      "Obeležen „kritičan“ materijal je primljen i proizvodnja može da krene, ali prijem ostalih porudžbina materijala još nije završen.",
  },
  in_production: {
    label: "U proizvodnji",
    color: "bg-rose-500/25 text-rose-950 dark:text-rose-50",
    automationHint: "Merenje završeno; čeka se ili traje RN proizvodnje. Posle završetka proizvodnje → „Čeka ugradnju“.",
  },
  scheduled: {
    label: "Čeka ugradnju",
    color: "bg-indigo-500/25 text-indigo-950 dark:text-indigo-50",
    automationHint: "Proizvodnja završena; RN ugradnje su na čekanju. Kad montaža krene → „Ugradnja u toku“.",
  },
  installation_in_progress: {
    label: "Ugradnja u toku",
    color: "bg-cyan-500/25 text-cyan-950 dark:text-cyan-50",
    automationHint: "RN ugradnja je u toku. Posle završetka, terenski izveštaj određuje „Završen“ ili problem na ugradnji.",
  },
  installation_done_unpaid: {
    label: "Ugradnja završena / nije plaćeno",
    color: "bg-amber-600/25 text-amber-950 dark:text-amber-50",
    automationHint:
      "Montaža i završni terenski izveštaj su gotovi, ali ima preostalog duga. Posle potpune isplate automatski prelazi u „Završen“.",
  },
  completed: {
    label: "Završen",
    color: "bg-green-600 text-white dark:bg-green-700 dark:text-white",
    automationHint: "Montaža završena i terenski izveštaj bez prijavljenog problema (ili ručno postavljeno).",
  },
  installation_problem: {
    label: "Ugradnja – problem",
    color: "bg-orange-500/30 text-orange-950 dark:text-orange-50",
    automationHint:
      "Problem ili otkaz terena ugradnje: ponovo zakažite ugradnju (RN se vraća u čekanje) ili otkazite ceo posao. Posle uspešnog ugradbenog terena prelazak u Završen (prvi put: first_completed_at).",
  },
  complaint: {
    label: "Reklamacija",
    color: "bg-red-600 text-white dark:bg-red-700 dark:text-white",
    automationHint:
      "Nakon prvog Završen: reklamacija kroz kancelariju (novi teren). Prvi put na ugradnji koristite status „Ugradnja – problem“.",
  },
  service: {
    label: "Servis",
    color: "bg-purple-500/25 text-purple-950 dark:text-purple-50",
    automationHint: "Menja se samo ručno (servisni režim); automatska pravila statusa se ne primenjuju.",
  },
  canceled: {
    label: "Otkazan",
    color: "bg-zinc-500/30 text-zinc-900 dark:text-zinc-100",
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
    description: "Kompletan rad na poslu: kupci, poslovi, ponude, finansije, radni nalozi, terenski izveštaji, aktivnosti i fajlovi. Bez mape završenih poslova.",
    access: ["Kupci", "Poslovi", "Ponude", "Finansije", "Radni nalozi", "Terenski izveštaji", "Aktivnosti", "Fajlovi"],
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
