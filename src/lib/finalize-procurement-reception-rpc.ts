/** Payload jedne stavke za RPC `finalize_procurement_order_reception` (snake_case za Supabase). */
export type FinalizeProcurementReceptionLineRpc = {
  received_intact: number;
  missing: number;
  damaged: number;
  notes: string;
  photo_urls: string[];
};

export type FinalizeProcurementReceptionResult = {
  delivery_status: string;
  complaints_inserted: number;
  has_issues: boolean;
  /** ID nove „Porudžbine po nedostatku" ako je kreirana (in case of missing/damaged items). */
  shortage_order_id: string | null;
};
