import { JOB_STATUS_CONFIG, type FileCategory, type JobStatus, type MaterialOrder, type QuoteStatus, type WorkOrder, type WorkOrderType } from "@/types";

const WORK_ORDER_TYPE_LABELS: Record<WorkOrderType, string> = {
  measurement: "Merenje",
  measurement_verification: "Provera mera",
  installation: "Ugradnja",
  complaint: "Reklamacija",
  service: "Servis",
  production: "Proizvodnja",
  site_visit: "Terenska poseta",
  control_visit: "Kontrolna poseta",
};

const WORK_ORDER_STATUS_LABELS: Record<WorkOrder["status"], string> = {
  pending: "Čeka",
  in_progress: "U toku",
  completed: "Završen",
  canceled: "Otkazan",
};

const MATERIAL_TYPE_LABELS: Record<MaterialOrder["materialType"], string> = {
  glass: "Staklo",
  mosquito_net: "Komarnik",
  profile: "Profil",
  shutters: "Roletne",
  sills: "Okapnice",
  boards: "Daske",
  hardware: "Okov",
  sealant: "Zaptivna masa",
  other: "Ostalo",
};

const DELIVERY_STATUS_LABELS: Record<MaterialOrder["deliveryStatus"], string> = {
  pending: "Na čekanju",
  shipped: "Poslato",
  delivered: "Isporučeno",
  partial: "Delimično isporučeno",
};

const FILE_CATEGORY_LABELS: Record<FileCategory, string> = {
  offers: "Ponude",
  communication: "Komunikacija",
  finance: "Finansije",
  supplier: "Dobavljač",
  work_order: "Radni nalog",
  field_photos: "Terenske fotografije",
  reports: "Izveštaji",
};

const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Poslata",
  accepted: "Prihvaćena",
  rejected: "Odbijena",
};

export const labelJobStatus = (status: JobStatus | string) =>
  JOB_STATUS_CONFIG[status as JobStatus]?.label ?? status;
export const labelWorkOrderType = (type: WorkOrderType | string) => WORK_ORDER_TYPE_LABELS[type as WorkOrderType] ?? type;
export const labelWorkOrderStatus = (status: WorkOrder["status"] | string) => WORK_ORDER_STATUS_LABELS[status as WorkOrder["status"]] ?? status;
export const labelMaterialType = (type: MaterialOrder["materialType"] | string) => MATERIAL_TYPE_LABELS[type as MaterialOrder["materialType"]] ?? type;
export const labelDeliveryStatus = (status: MaterialOrder["deliveryStatus"] | string) => DELIVERY_STATUS_LABELS[status as MaterialOrder["deliveryStatus"]] ?? status;
export const labelFileCategory = (category: FileCategory | string) => FILE_CATEGORY_LABELS[category as FileCategory] ?? category;
export const labelQuoteStatus = (status: QuoteStatus | string) => QUOTE_STATUS_LABELS[status as QuoteStatus] ?? status;
