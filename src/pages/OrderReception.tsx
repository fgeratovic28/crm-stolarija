import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Camera, CheckCircle2, Download, ExternalLink, FileText, Loader2, Package, ScanBarcode } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageTransition } from "@/components/shared/PageTransition";
import { CardListSkeleton } from "@/components/shared/Skeletons";
import { Button } from "@/components/ui/button";
import { CameraBarcodeScanner } from "@/components/shared/CameraBarcodeScanner";
import { ItemReceptionModal, type ItemReceptionConfirmPayload } from "@/components/modals/ItemReceptionModal";
import { useBarcodeScannerListener } from "@/hooks/use-barcode-scanner-listener";
import { useFinalizeProcurementOrderReception, useMaterialOrderById } from "@/hooks/use-material-orders";
import { useMaterialOrderAttachments } from "@/hooks/use-material-order-files";
import {
  useProcurementComplaintsByOrderId,
  useReceiveProcurementBarcode,
} from "@/hooks/use-procurement-complaints";
import { useProcurementAdHocItemsForOrder } from "@/hooks/use-procurement-ad-hoc-items";
import {
  PROCUREMENT_AD_HOC_STATUS,
  isProcurementAdHocActive,
  normalizeProcurementAdHocStatus,
} from "@/lib/procurement-ad-hoc-status";
import { useAuthStore } from "@/stores/auth-store";
import { useRole } from "@/contexts/RoleContext";
import { normalizeOrderLines, linesFromPublicRpcRow, parseNbLinesJson } from "@/lib/material-order-lines";
import {
  orderLinesEligibleForProcurementPdf,
  procurementBarcodeValueForOrderLine,
  procurementPdfRowsFromOrderLines,
} from "@/lib/material-order-procurement-rows";
import {
  generateProcurementOrderPdfBlob,
  normalizeProcurementBarcodePlainText,
} from "@/lib/material-order-procurement-pdf";
import { openPdfBlobInNewTabOrDownload } from "@/lib/pdf-from-html";
import { openReceptionActionBarcodesPdf } from "@/lib/reception-action-barcodes-pdf";
import {
  isOrderReceptionFinalizeBarcode,
  matchItemReceptionActionBarcode,
} from "@/lib/item-reception-modal-barcodes";
import { buildOrderReceptionAbsoluteUrl } from "@/lib/order-reception-url";
import { parseMaterialOrderItemsJson } from "@/lib/material-order-items-json";
import type { FinalizeProcurementReceptionLineRpc } from "@/lib/finalize-procurement-reception-rpc";
import { labelDeliveryStatus } from "@/lib/activity-labels";
import {
  PROCUREMENT_COMPLAINT_STATUS,
  isProcurementComplaintActive,
  labelProcurementComplaintStatus,
  normalizeProcurementComplaintStatus,
  procurementComplaintBadgeVariant,
} from "@/lib/procurement-complaint-status";
import type { MaterialOrderLine } from "@/types";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { siteHitShortageCanShowReception } from "@/lib/invoice-missing-procurement-phase";

function normalizeArticleCodeScanValue(value: unknown): string | null {
  const cleaned = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return cleaned ? normalizeProcurementBarcodePlainText(cleaned) : null;
}

function lineExpectedQty(line: MaterialOrderLine): number {
  const q = Number(line.quantity);
  if (!Number.isFinite(q)) return 0;
  return Math.max(0, Math.round(q));
}

function clampNonNegInt(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function buildFinalizeRpcLines(
  lines: MaterialOrderLine[],
  lineReception: Record<number, ItemReceptionConfirmPayload>,
  receivableLineIndices?: Set<number>,
): FinalizeProcurementReceptionLineRpc[] {
  if (!Array.isArray(lines)) {
    throw new Error("Neispravna lista stavki narudžbine.");
  }
  return lines.map((line, index) => {
    if (receivableLineIndices && !receivableLineIndices.has(index)) {
      return {
        received_intact: 0,
        missing: lineExpectedQty(line),
        damaged: 0,
        notes: "",
        photo_urls: [],
      };
    }
    const r = lineReception[index];
    if (!r) {
      throw new Error(`Stavka ${index + 1}: unesite prijem pre završetka.`);
    }
    const expected = lineExpectedQty(line);
    const ri = clampNonNegInt(r.receivedIntact);
    const mi = clampNonNegInt(r.missing);
    const da = clampNonNegInt(r.damaged);
    if (expected === 0) {
      if (ri + mi + da !== 0) {
        throw new Error(`Stavka ${index + 1}: neispravne količine.`);
      }
    } else if (ri + mi + da !== expected) {
      throw new Error(`Stavka ${index + 1}: zbir mora biti tačno ${expected}.`);
    }
    if ((mi > 0 || da > 0) && !r.notes.trim()) {
      throw new Error(`Stavka ${index + 1}: napomena je obavezna kada ima nedostatka ili oštećenja.`);
    }
    if (da > 0 && r.photoUrls.length === 0) {
      throw new Error(`Stavka ${index + 1}: otpremite fotografiju za oštećeni materijal.`);
    }
    return {
      received_intact: ri,
      missing: mi,
      damaged: da,
      notes: (r.notes ?? "").trim(),
      photo_urls: [...r.photoUrls],
    };
  });
}

type DoneMeta = {
  deliveryStatus: string;
  complaintsInserted: number;
  hasIssues: boolean;
  supplierLabel: string;
  shortageOrderId: string | null;
};

export default function OrderReception() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isAuthenticated, authReady, authProfileReady } = useAuthStore();
  const { hasAccess, currentRole } = useRole();
  const uploadedBy = user?.id ?? "";

  const staffEligible =
    Boolean(authReady && isAuthenticated && authProfileReady && hasAccess("material-reception"));
  const publicEligible =
    Boolean(authReady && orderId?.trim()) &&
    (!isAuthenticated || (authProfileReady && !hasAccess("material-reception")));

  const staffOrderQuery = useMaterialOrderById(staffEligible ? orderId : undefined);
  const publicSnapshotQuery = useQuery({
    queryKey: ["order-reception-public", orderId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_material_order_reception_public", {
        p_order_id: orderId!.trim(),
      });
      if (error) {
        console.error("get_material_order_reception_public error:", error);
        throw error;
      }
      console.log("get_material_order_reception_public data:", data);
      if (data == null || (typeof data === "object" && data !== null && Object.keys(data as object).length === 0)) {
        return null;
      }
      return data as Record<string, unknown>;
    },
    enabled: Boolean(publicEligible && orderId?.trim()),
  });

  const order = staffEligible ? staffOrderQuery.data ?? null : null;
  const publicSnapshot = !staffEligible ? publicSnapshotQuery.data ?? null : null;

  const finalizeReception = useFinalizeProcurementOrderReception();

  const materialOrderAttachmentIds = useMemo(() => {
    if (!staffEligible || currentRole === "production" || !order?.id) return [];
    return [order.id];
  }, [currentRole, order?.id, staffEligible]);
  const attachmentsQuery = useMaterialOrderAttachments(materialOrderAttachmentIds);
  const orderAttachments = useMemo(() => {
    if (!staffEligible || currentRole === "production" || !order?.id) return [];
    return (attachmentsQuery.data ?? {})[order.id] ?? [];
  }, [attachmentsQuery.data, currentRole, order?.id, staffEligible]);

  const lines = useMemo(() => {
    if (staffEligible && order) return normalizeOrderLines(order);
    if (publicSnapshot) return linesFromPublicRpcRow(publicSnapshot);
    return [];
  }, [staffEligible, order, publicSnapshot]);

  const eligible = useMemo(() => orderLinesEligibleForProcurementPdf(lines), [lines]);

  const isWaitingForDelivery = staffEligible && order?.deliveryStatus === "waiting_for_delivery";
  const orderIsSiteHitShortage = order?.isShortageOrder === true && Boolean(order.siteMissingFromInstallation);
  const canReceiveProcurementLines = Boolean(
    staffEligible &&
      order &&
      (orderIsSiteHitShortage
        ? siteHitShortageCanShowReception(order.deliveryStatus)
        : order.deliveryStatus === "waiting_for_delivery"),
  );
  const isShortageReception = staffEligible && order?.isShortageOrder === true;
  const shortageReceptionSummary = useMemo(() => {
    let missing = 0;
    let damaged = 0;
    for (const line of lines) {
      missing += Number(line.shortageSource?.missingQty ?? 0) || 0;
      damaged += Number(line.shortageSource?.damagedQty ?? 0) || 0;
    }
    const parts = [
      missing > 0 ? `${missing} nedostaje` : null,
      damaged > 0 ? `${damaged} oštećeno` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" + ") : "stavke za nadoknadu";
  }, [lines]);
  const hasFollowupCandidate =
    staffEligible &&
    order != null &&
    (order.deliveryStatus === "received_with_issues" || order.deliveryStatus === "materials_received");

  const complaintsOrderId = staffEligible && order
    ? order.isShortageOrder && order.parentOrderId
      ? order.parentOrderId
      : order.id
    : undefined;
  const complaintsQuery = useProcurementComplaintsByOrderId(
    complaintsOrderId,
    Boolean(staffEligible && order && (hasFollowupCandidate || order.isShortageOrder)),
  );
  /** Vanredne stavke učitavamo UVEK kada magacin radi prijem — i tokom inicijalnog skeniranja
   *  i posle finalizacije — kako bi worker uvek video kompletnu listu (van porudžbenice).
   *  Za klasičnu Porudžbinu po nedostatku spajamo i parent ad-hoc (stavke pre shortage child-a).
   *  Za hitno sa ugradnje (`site_missing_from_installation`) linije su na ovoj narudžbini — parent ad-hoc se ne meša. */
  const adHocQuery = useProcurementAdHocItemsForOrder(
    staffEligible && order ? order.id : undefined,
    Boolean(staffEligible && order),
  );
  const adHocParentQuery = useProcurementAdHocItemsForOrder(
    staffEligible &&
      order?.isShortageOrder &&
      order.parentOrderId &&
      !order.siteMissingFromInstallation
      ? order.parentOrderId
      : undefined,
    Boolean(
      staffEligible && order?.isShortageOrder && order.parentOrderId && !order.siteMissingFromInstallation,
    ),
  );
  const adHocItems = useMemo(() => {
    const own = adHocQuery.data ?? [];
    const parent = adHocParentQuery.data ?? [];
    if (!order?.isShortageOrder || !order.parentOrderId || order.siteMissingFromInstallation) {
      return own;
    }
    const seen = new Set<string>();
    const out: typeof own = [];
    for (const it of [...own, ...parent]) {
      if (!seen.has(it.id)) {
        seen.add(it.id);
        out.push(it);
      }
    }
    return out;
  }, [adHocQuery.data, adHocParentQuery.data, order?.isShortageOrder, order?.parentOrderId, order?.siteMissingFromInstallation]);
  const receiveByBarcode = useReceiveProcurementBarcode();

  const pendingComplaints = useMemo(
    () => (complaintsQuery.data ?? []).filter((c) => isProcurementComplaintActive(c.status)),
    [complaintsQuery.data],
  );
  const awaitingDeliveryComplaintIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of complaintsQuery.data ?? []) {
      if (normalizeProcurementComplaintStatus(c.status) === PROCUREMENT_COMPLAINT_STATUS.AWAITING_DELIVERY) {
        ids.add(c.id);
      }
    }
    return ids;
  }, [complaintsQuery.data]);
  const receivableLineIndices = useMemo(() => {
    if (!isShortageReception) return new Set(lines.map((_, index) => index));
    /** Hitni shortage sa predračinom: stavke su na ovoj porudžbini, bez veze sa reklamacijom na parentu. */
    if (order?.siteMissingFromInstallation) return new Set(lines.map((_, index) => index));
    const ids = awaitingDeliveryComplaintIds;
    const out = new Set<number>();
    lines.forEach((line, index) => {
      const complaintId = line.shortageSource?.complaintId;
      if (complaintId && ids.has(complaintId)) out.add(index);
    });
    return out;
  }, [awaitingDeliveryComplaintIds, isShortageReception, lines, order?.siteMissingFromInstallation]);
  const pendingAdHoc = useMemo(
    () => adHocItems.filter((item) => isProcurementAdHocActive(item.status)),
    [adHocItems],
  );
  const receivedAdHoc = useMemo(
    () =>
      adHocItems.filter(
        (item) => normalizeProcurementAdHocStatus(item.status) === PROCUREMENT_AD_HOC_STATUS.RECEIVED,
      ),
    [adHocItems],
  );
  const hasFollowup = hasFollowupCandidate && (pendingComplaints.length > 0 || pendingAdHoc.length > 0);

  const [lineReception, setLineReception] = useState<Record<number, ItemReceptionConfirmPayload>>(() => {
    const saved = localStorage.getItem(`order-reception-${orderId}`);
    return saved ? JSON.parse(saved) : {};
  });
  const [activeLineIndex, setActiveLineIndex] = useState<number | null>(null);
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [doneMeta, setDoneMeta] = useState<DoneMeta | null>(null);
  const [cameraScannerOpen, setCameraScannerOpen] = useState(false);
  const [guestPdfLoading, setGuestPdfLoading] = useState(false);
  const [actionBarcodesPdfLoading, setActionBarcodesPdfLoading] = useState(false);
  const modalOpen = activeLineIndex !== null;
  const handleFinalizeRef = useRef<() => void>(() => {});

  const handleSetLineReception = (updater: React.SetStateAction<Record<number, ItemReceptionConfirmPayload>>) => {
    setLineReception((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      localStorage.setItem(`order-reception-${orderId}`, JSON.stringify(next));
      return next;
    });
  };

  const supplierLabel = order?.supplier ?? String(publicSnapshot?.supplier ?? "");

  const materialOrderIdForBarcodes =
    order?.id ??
    (publicSnapshot?.id != null ? String(publicSnapshot.id) : orderId?.trim() ?? undefined);

  /**
   * Cross-order lookup: kada M-barkod ne match-uje lokalne stavke, traži aktivnu shortage porudžbinu
   * (na istom poslu) koja sadrži ovu stavku — i prebacuje radnika na njenu reception stranicu.
   * Pokriva i lančane shortage-of-shortage scenarije, jer barkod uvek pamti root parent.
   */
  const findActiveShortageOrderForBarcode = useCallback(
    async (
      jobId: string | undefined | null,
      barcode: string,
    ): Promise<{ shortageOrderId: string } | null> => {
      const job = jobId?.trim();
      if (!job) return null;
      try {
        const { data, error } = await supabase
          .from("material_orders")
          .select("id, nb_lines, delivery_status")
          .eq("job_id", job)
          .eq("is_shortage_order", true)
          .neq("delivery_status", "materials_received")
          .neq("delivery_status", "received_with_issues");
        if (error) {
          console.error("findActiveShortageOrderForBarcode error:", error);
          return null;
        }
        for (const row of (data ?? []) as Array<{ id: string; nb_lines: unknown }>) {
          const linesNorm = parseNbLinesJson(row.nb_lines) ?? [];
          const hit = linesNorm.some((line) => {
            const v = procurementBarcodeValueForOrderLine(line);
            const articleCode = normalizeArticleCodeScanValue(line.procurementMeta?.article_code);
            return (v != null && v === barcode) || articleCode === barcode;
          });
          if (hit) return { shortageOrderId: row.id };
        }
        return null;
      } catch (err) {
        console.error("findActiveShortageOrderForBarcode exception:", err);
        return null;
      }
    },
    [],
  );

  const onBarcodeScan = useCallback(
    async (raw: string) => {
      const trimmedRaw = raw.trim();
      if (!trimmedRaw || !staffEligible || !order) return;
      const scannedNorm = normalizeProcurementBarcodePlainText(trimmedRaw);
      setScannedBarcode(scannedNorm);

      if (isOrderReceptionFinalizeBarcode(scannedNorm)) {
        if (!isWaitingForDelivery || receivableLineIndices.size === 0) {
          toast.error("Završetak prijema nije dostupan", {
            description: "Barkod za završetak važi samo tokom aktivnog prijema porudžbine.",
          });
          return;
        }
        const ready = [...receivableLineIndices].every((i) => lineReception[i] != null);
        if (!ready) {
          toast.error("Nije moguće završiti prijem", {
            description: "Unesite prijem za svaku stavku pre skeniranja barkoda za završetak.",
          });
          return;
        }
        if (!uploadedBy || finalizeReception.isPending) return;
        handleFinalizeRef.current();
        return;
      }

      const modalAction = matchItemReceptionActionBarcode(scannedNorm);
      if (modalAction) {
        toast.info("Barkod za modal prijema stavke", {
          description:
            modalAction === "confirm"
              ? "Skenirajte P-barkod dok je otvoren modal sa količinama."
              : "Skenirajte O-barkod dok je otvoren modal sa količinama.",
        });
        return;
      }

      /** Brzi format check: C… za reklamacije, A… za vanredne stavke (oba: 1 slovo + 9 cifara). */
      const looksLikeFollowupBarcode = /^[CA]\d{9}$/.test(scannedNorm);

      if (looksLikeFollowupBarcode) {
        try {
          const result = await receiveByBarcode.mutateAsync(scannedNorm);
          if (result.kind === "complaint") {
            if (result.already_resolved) {
              toast.info("Reklamacija je već primljena", {
                description: `Barkod ${scannedNorm} je već obeležen kao Rešeno / Primljeno.`,
              });
            } else {
              toast.success("Reklamacija primljena", {
                description: `Barkod ${scannedNorm} → Rešeno / Primljeno.`,
              });
            }
          } else {
            if (result.already_resolved) {
              toast.info("Vanredna stavka je već primljena", {
                description: `Barkod ${scannedNorm} je već obeležen kao primljen.`,
              });
            } else {
              toast.success("Vanredna stavka primljena", {
                description: `Barkod ${scannedNorm} → Rešeno / Primljeno.`,
              });
            }
          }
          return;
        } catch (err) {
          /** Ako nije pronađeno u reklamacijama/ad-hoc, nastavi sa M-barkod (porudžbenice) provericama. */
          if (!canReceiveProcurementLines) {
            toast.error("Nepoznat barkod", {
              description: err instanceof Error ? err.message : `Barkod ${scannedNorm} nije pronađen.`,
            });
            return;
          }
        }
      }

      /** Klasičan M-barkod match u trenutnoj porudžbini (radi i za originalnu i za shortage — jer
       *  shortage linije imaju `shortageSource` koji rerouter scope na original). */
      if (canReceiveProcurementLines && lines.length > 0) {
        const moId = order.id;
        const smartItems = parseMaterialOrderItemsJson(order.itemsJson);
        const computed = lines.map((line, index) =>
          procurementBarcodeValueForOrderLine(line, { materialOrderId: moId, lineIndex: index }),
        );
        const directArticleCodes = lines.map((line, index) => {
          const fromLine = normalizeArticleCodeScanValue(line.procurementMeta?.article_code);
          if (fromLine) return fromLine;
          const smartRow = smartItems?.rows[index];
          return smartRow ? normalizeArticleCodeScanValue(smartRow[smartItems.sifraColumnKey]) : null;
        });
        const idx = computed.findIndex(
          (v, index) =>
            !lineReception[index] &&
            receivableLineIndices.has(index) &&
            ((v != null && v === scannedNorm) || directArticleCodes[index] === scannedNorm),
        );
        if (idx >= 0) {
          setActiveLineIndex(idx);
          return;
        }
        /** Diagnostika: kad ne nađe poklapanje, ispisi šta je očekivano vs. šta je skenirano. */
        console.warn("[OrderReception] Barcode mismatch", {
          scannedRaw: trimmedRaw,
          scannedNorm,
          expected: computed.map((v, i) => ({
            index: i,
            expected: v,
            articleCode: directArticleCodes[i],
            received: Boolean(lineReception[i]),
          })),
        });
      }

      /** Smart fallback: traži aktivnu „Porudžbinu po nedostatku" na istom poslu (handle-uje i lance). */
      const shortage = await findActiveShortageOrderForBarcode(order.jobId, scannedNorm);
      if (shortage && shortage.shortageOrderId !== order.id) {
        toast.info("Prebacujem na Porudžbinu po nedostatku", {
          description: `Stavka je preneta u aktivnu shortage porudžbinu. Otvaram odgovarajuću stranu prijema.`,
        });
        navigate(`/order-reception/${shortage.shortageOrderId}?scan=${encodeURIComponent(scannedNorm)}`);
        return;
      }

      toast.error("Nepoznata stavka", {
        description: canReceiveProcurementLines
          ? `Skenirani barkod „${scannedNorm}" se ne poklapa ni sa jednom nepotvrđenom stavkom ove porudžbine. Otvorite Konzolu (F12) — tamo je lista očekivanih barkodova.`
          : `Barkod ${scannedNorm} se ne poklapa ni sa jednom aktivnom stavkom za ovu porudžbinu.`,
      });
    },
    [
      lines,
      order,
      staffEligible,
      lineReception,
      receivableLineIndices,
      canReceiveProcurementLines,
      receiveByBarcode,
      navigate,
      findActiveShortageOrderForBarcode,
      isWaitingForDelivery,
      uploadedBy,
      finalizeReception.isPending,
    ],
  );

  const handleDownloadActionBarcodesPdf = useCallback(async () => {
    setActionBarcodesPdfLoading(true);
    try {
      await openReceptionActionBarcodesPdf();
      toast.success("PDF barkodova je otvoren.");
    } catch (e) {
      toast.error("Greška pri generisanju PDF-a", {
        description: e instanceof Error ? e.message : "Pokušajte ponovo.",
      });
    } finally {
      setActionBarcodesPdfLoading(false);
    }
  }, []);

  useEffect(() => {
    const queuedScan = searchParams.get("scan")?.trim();
    if (!queuedScan || !staffEligible || !order || lines.length === 0 || modalOpen || doneMeta) return;
    const next = new URLSearchParams(searchParams);
    next.delete("scan");
    setSearchParams(next, { replace: true });
    void onBarcodeScan(queuedScan);
  }, [searchParams, setSearchParams, staffEligible, order, lines.length, modalOpen, doneMeta, onBarcodeScan]);

  useBarcodeScannerListener(onBarcodeScan, {
    enabled: Boolean(
      staffEligible &&
        order &&
        (eligible ||
          hasFollowup ||
          pendingAdHoc.length > 0 ||
          (canReceiveProcurementLines && lines.length > 0)) &&
        !modalOpen &&
        !doneMeta &&
        !cameraScannerOpen,
    ),
  });

  const loginReturnPath = `/order-reception/${orderId?.trim() ?? ""}`;

  const handleGuestDownloadPdf = useCallback(async () => {
    const id = orderId?.trim();
    if (!id || !publicSnapshot) return;
    const guestLines = linesFromPublicRpcRow(publicSnapshot);
    const rows = procurementPdfRowsFromOrderLines(guestLines);
    if (!rows) {
      toast.error("PDF nije dostupan", {
        description:
          "Porudžbina nema stavke sa dovoljno podataka za štampu (naziv / nabavka). Kontaktirajte nas ako treba PDF.",
      });
      return;
    }
    setGuestPdfLoading(true);
    try {
      const blob = await generateProcurementOrderPdfBlob({
        rows,
        nalogLabel: String(publicSnapshot.jobNumber ?? "—").trim() || "—",
        crmUrl: buildOrderReceptionAbsoluteUrl(id),
        footerNote: publicSnapshot.notes != null ? String(publicSnapshot.notes).trim() : "",
        barcodeScope: { materialOrderId: id },
      });
      const filename = `porudzbenica-${id.slice(0, 8)}.pdf`;
      openPdfBlobInNewTabOrDownload(blob, filename);
      toast.success("PDF je otvoren u novom tabu.");
    } catch (e) {
      toast.error("Greška pri generisanju PDF-a", {
        description: e instanceof Error ? e.message : "Pokušajte ponovo.",
      });
    } finally {
      setGuestPdfLoading(false);
    }
  }, [orderId, publicSnapshot]);

  const handleCameraScanSuccess = useCallback(
    (decodedText: string) => {
      onBarcodeScan(decodedText);
      setCameraScannerOpen(false);
    },
    [onBarcodeScan],
  );

  /** Ručno (bez skenera) označi vanrednu stavku kao primljenu — koristi isti RPC kao i skener. */
  const handleManualAdHocReceive = useCallback(
    async (barcode: string, label: string) => {
      if (!barcode) return;
      const ok = window.confirm(`Potvrđujete da je vanredna stavka primljena?\n\n${label}`);
      if (!ok) return;
      try {
        await receiveByBarcode.mutateAsync(barcode);
        toast.success("Vanredna stavka primljena", {
          description: `Barkod ${barcode} → Rešeno / Primljeno.`,
        });
      } catch (err) {
        toast.error("Greška pri potvrdi prijema", {
          description: err instanceof Error ? err.message : "Pokušajte ponovo.",
        });
      }
    },
    [receiveByBarcode],
  );

  const activeLine = activeLineIndex != null ? lines[activeLineIndex] : null;
  const activeExpected = activeLine ? lineExpectedQty(activeLine) : 0;

  const allLinesRecorded =
    staffEligible &&
    receivableLineIndices.size > 0 &&
    [...receivableLineIndices].every((i) => lineReception[i] != null);

  const handleFinalize = useCallback(() => {
    if (!order || !user?.id) {
      toast.error("Morate biti prijavljeni.");
      return;
    }
    let rpcLines: FinalizeProcurementReceptionLineRpc[];
    try {
      rpcLines = buildFinalizeRpcLines(lines, lineReception, isShortageReception ? receivableLineIndices : undefined);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Proverite unos po stavkama.");
      return;
    }
    finalizeReception.mutate(
      { orderId: order.id, reportedBy: user.id, jobId: order.jobId, lines: rpcLines },
      {
        onSuccess: (data) => {
          localStorage.removeItem(`order-reception-${orderId}`);
          toast.success("Prijem završen.");
          setDoneMeta({
            deliveryStatus: data.delivery_status,
            complaintsInserted: data.complaints_inserted,
            hasIssues: data.has_issues,
            supplierLabel: order.supplier ?? "",
            shortageOrderId: data.shortage_order_id ?? null,
          });
        },
      },
    );
  }, [
    finalizeReception,
    isShortageReception,
    lineReception,
    lines,
    order,
    orderId,
    receivableLineIndices,
    user?.id,
  ]);

  handleFinalizeRef.current = handleFinalize;

  const isLoading =
    !authReady ||
    (isAuthenticated && !authProfileReady) ||
    (staffEligible && staffOrderQuery.isLoading) ||
    (publicEligible && publicSnapshotQuery.isLoading);

  const staffError = staffEligible ? staffOrderQuery.isError : false;
  const publicError = !staffEligible ? publicSnapshotQuery.isError : false;
  const isError = staffError || publicError;
  const notFound =
    authReady &&
    (isAuthenticated ? authProfileReady : true) &&
    !isLoading &&
    !order &&
    !publicSnapshot;

  if (isLoading) {
    return (
      <AppLayout title="Prijem materijala">
        <CardListSkeleton count={3} />
      </AppLayout>
    );
  }

  if (isError || notFound || !orderId?.trim()) {
    return (
      <AppLayout title="Prijem materijala">
        <PageTransition>
          <p className="text-sm text-muted-foreground">
            {publicError ? "Greška pri učitavanju porudžbine." : "Narudžbina nije pronađena."}
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/material-orders">Nazad na listu</Link>
          </Button>
        </PageTransition>
      </AppLayout>
    );
  }

  if (doneMeta && staffEligible) {
    return (
      <AppLayout title="Prijem završen">
        <PageTransition>
          <div className="mx-auto max-w-lg rounded-xl border border-border bg-card p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/15">
              <CheckCircle2 className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-xl font-semibold text-foreground">Prijem završen.</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {doneMeta.supplierLabel ? `${doneMeta.supplierLabel} · ` : null}
              Status:{" "}
              <span className="font-medium text-foreground">
                {labelDeliveryStatus(doneMeta.deliveryStatus)}
              </span>
            </p>
            {doneMeta.hasIssues ? (
              <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                {doneMeta.complaintsInserted > 0 ? (
                  <p>
                    U reklamacijama nabavke kreirano je {doneMeta.complaintsInserted}{" "}
                    {doneMeta.complaintsInserted === 1 ? "zapis" : "zapisa"} (status: Prijavljen problem).
                  </p>
                ) : null}
                {doneMeta.shortageOrderId ? (
                  <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-left">
                    <p className="text-xs font-medium text-foreground">
                      Automatski kreirana „Porudžbina po nedostatku"
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Nabavka može da je preuzme i pošalje dobavljaču za zamenu / dopunu.
                    </p>
                    <Button asChild size="sm" className="mt-3">
                      <Link to="/material-orders">Otvori nabavku</Link>
                    </Button>
                  </div>
                ) : (
                  <p>Prijem zabeležen sa reklamacijama — nabavka će ih obraditi.</p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Sve stavke su evidentirane kao ispravno primljene.</p>
            )}
            <Button asChild className="mt-6 w-full sm:w-auto">
              <Link to="/material-orders">Nazad na narudžbine</Link>
            </Button>
          </div>
        </PageTransition>
      </AppLayout>
    );
  }

  const hasPendingAdHocOutsideFollowup = staffEligible && pendingAdHoc.length > 0;

  const siteHitShortageAllowsReceptionPage = Boolean(
    order && order.isShortageOrder && order.siteMissingFromInstallation && siteHitShortageCanShowReception(order.deliveryStatus),
  );

  if (
    staffEligible &&
    order &&
    order.deliveryStatus !== "waiting_for_delivery" &&
    !siteHitShortageAllowsReceptionPage &&
    !hasFollowup &&
    !hasPendingAdHocOutsideFollowup
  ) {
    const already =
      order.deliveryStatus === "materials_received" || order.deliveryStatus === "received_with_issues";
    return (
      <AppLayout title="Prijem materijala">
        <PageTransition>
          <PageHeader
            title={already ? "Prijem je već zabeležen" : "Prijem nije dostupan"}
            description={
              already
                ? `Status narudžbine: ${labelDeliveryStatus(order.deliveryStatus)}.`
                : `Status narudžbine mora biti „Čeka isporuku”. Trenutno: ${labelDeliveryStatus(order.deliveryStatus)}.`
            }
          />
          <Button asChild variant="outline" className="mt-4">
            <Link to="/material-orders">Nazad</Link>
          </Button>
        </PageTransition>
      </AppLayout>
    );
  }

  if (!staffEligible && publicSnapshot) {
    const oid = String(publicSnapshot.id ?? orderId ?? "").trim();
    const shortRef = oid.length >= 13 ? `${oid.slice(0, 8)}…${oid.slice(-4)}` : oid || "—";
    const jobNum = String(publicSnapshot.jobNumber ?? "").trim();

    return (
      <AppLayout title="Porudžbenica">
        <PageTransition>
          <div className="mx-auto flex max-w-md flex-col gap-8 py-6 sm:py-10">
            <div className="flex justify-end">
              <Button
                type="button"
                variant="link"
                className="h-auto px-0 text-sm font-medium text-primary"
                onClick={() => navigate("/login", { state: { from: { pathname: loginReturnPath } } })}
              >
                Prijavi se
              </Button>
            </div>

            <div className="text-center">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Porudžbenica</h1>
              <p className="mt-2 font-mono text-sm text-muted-foreground tabular-nums">{shortRef}</p>
              {jobNum ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Broj posla: <span className="font-medium text-foreground">{jobNum}</span>
                </p>
              ) : null}
              {supplierLabel ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Dobavljač: <span className="text-foreground">{supplierLabel}</span>
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-3">
              <Button
                type="button"
                size="lg"
                className="w-full gap-2 py-6 text-base shadow-md"
                disabled={guestPdfLoading || !eligible}
                onClick={() => void handleGuestDownloadPdf()}
              >
                {guestPdfLoading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Download className="h-5 w-5" aria-hidden />}
                Preuzmi PDF porudžbenice
              </Button>
              {!eligible ? (
                <p className="text-center text-xs text-muted-foreground">
                  PDF sa štampanim barkodovima nije dostupan za ovu porudžbinu. Obratite se nama za detalje isporuke.
                </p>
              ) : null}
            </div>

            <div className="border-t border-border pt-6 text-center">
              <p className="text-xs text-muted-foreground">Radnici magacina — prijavite se da biste uneli prijem.</p>
              <Button
                type="button"
                variant="outline"
                className="mt-3 w-full sm:w-auto"
                onClick={() => navigate("/login", { state: { from: { pathname: loginReturnPath } } })}
              >
                Prijavi se
              </Button>
            </div>
          </div>
        </PageTransition>
      </AppLayout>
    );
  }

  return (
    <AppLayout title={`Prijem — ${supplierLabel || "Dobavljač"}`}>
      <PageTransition>
        <Breadcrumbs
          items={[
            { label: "Narudžbine materijala", href: "/material-orders" },
            { label: "Prijem" },
          ]}
        />
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="gap-1.5 -ml-2">
            <Link to="/material-orders">
              <ArrowLeft className="h-4 w-4" />
              Lista
            </Link>
          </Button>
          {eligible || hasFollowup || pendingAdHoc.length > 0 || (canReceiveProcurementLines && lines.length > 0) ? (
            <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:max-w-none sm:flex-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
                  <ScanBarcode className="h-3.5 w-3.5 shrink-0" />
                  Skeniranje aktivno — fokus van polja za unos
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2 shrink-0"
                  onClick={() => setCameraScannerOpen(true)}
                >
                  <Camera className="h-4 w-4" aria-hidden />
                  Skeniraj Kamerom
                </Button>
                {receiveByBarcode.isPending ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Obrada barkoda…
                  </span>
                ) : null}
              </div>
              {scannedBarcode ? (
                <span className="font-mono text-xs text-muted-foreground break-all">
                  Poslednji sken: <span className="text-foreground">{scannedBarcode}</span>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <PageHeader
          title={
            isShortageReception
              ? "Prijem porudžbine po nedostatku"
              : isWaitingForDelivery
                ? "Prijem porudžbine"
                : "Naknadni prijem (reklamacije / vanredna roba)"
          }
          description={
            isShortageReception
              ? `${supplierLabel || ""} · ${shortageReceptionSummary}. ${
                  order?.siteMissingFromInstallation
                    ? "Skenirajte barkod ili šifru sa PDF-a ove porudžbine."
                    : "Skenirajte originalni barkod ili šifru sa parent porudžbenice."
                }`
              : isWaitingForDelivery
              ? `${supplierLabel || ""} · očekivane stavke ispod. Barkod mora odgovarati vrednosti sa PDF porudžbine.`
              : `${supplierLabel || ""} · Status: ${labelDeliveryStatus(order?.deliveryStatus ?? "")}. Skenirajte barkodove reklamacija (C…) ili vanrednih stavki (A…).`
          }
          actions={
            staffEligible ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2 shrink-0"
                disabled={actionBarcodesPdfLoading}
                onClick={() => void handleDownloadActionBarcodesPdf()}
              >
                {actionBarcodesPdfLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Download className="h-4 w-4" aria-hidden />
                )}
                PDF barkodova magacina
              </Button>
            ) : null
          }
        />

        {orderAttachments.length > 0 ? (
          <section className="mb-6 rounded-xl border border-border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">Prilozi narudžbine</h2>
              <span className="text-xs text-muted-foreground">{orderAttachments.length} fajlova</span>
            </div>
            <ul className="mt-3 space-y-2">
              {orderAttachments.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                      <span className="text-sm text-foreground truncate">{f.name}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                      {f.uploadedBy} · {new Date(f.uploadedAt).toLocaleString("sr-RS")}
                    </p>
                  </div>
                  {f.storageUrl ? (
                    <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" asChild>
                      <a href={f.storageUrl} target="_blank" rel="noopener noreferrer">
                        Otvori
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {isShortageReception ? (
          <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
            <p className="font-semibold text-foreground">Ovo je aktivni zadatak za nadoknadu od dobavljača.</p>
            <p className="mt-1 text-muted-foreground">
              {order?.siteMissingFromInstallation ? (
                <>
                  Hitna porudžbina po nedostatku (predračun / ugradnja): prikazane su sve stavke sa ove porudžbine. Nema
                  odvojenog koraka sa reklamacijom na roditeljskoj narudžbini — magacin prima prema PDF-u ove porudžbine.
                </>
              ) : (
                <>
                  Prikazane su samo stavke čije su reklamacije u statusu „U rešavanju / Čeka se dostava”. Ostale stavke
                  ostaju na ovoj porudžbini dok ih nabavka ne prebaci u taj status.
                </>
              )}
            </p>
          </div>
        ) : null}

        {pendingComplaints.length > 0 && hasFollowup ? (
          <section className="mb-6 space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.05] p-4">
            <header className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                Reklamacije čekaju prijem (skenirajte C-barkod sa PDF-a)
              </h2>
              <span className="text-xs text-muted-foreground">
                Aktivno: {pendingComplaints.length}
              </span>
            </header>

            <ul className="space-y-2">
              {pendingComplaints.map((c) => {
                const details = (c.item_details && typeof c.item_details === "object" ? c.item_details : {}) as Record<string, unknown>;
                const article = String(details.article ?? details.description ?? "").trim() || "—";
                const articleCode = String(details.article_code ?? "").trim();
                const missing = Number(details.missing_qty ?? 0);
                const damaged = Number(details.damaged_qty ?? 0);
                const uom = String(details.uom ?? "kom").trim() || "kom";
                return (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-card p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {articleCode ? (
                          <span className="font-mono text-xs text-muted-foreground">{articleCode}</span>
                        ) : null}
                        <span className="text-sm font-semibold text-foreground">{article}</span>
                        <span className={cn(
                          "rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                          procurementComplaintBadgeVariant(c.status) === "danger"
                            ? "border-destructive/40 bg-destructive/10 text-destructive"
                            : "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200",
                        )}>
                          {labelProcurementComplaintStatus(c.status)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {missing > 0 ? <>Nedostaje: <span className="font-medium text-foreground">{missing} {uom}</span></> : null}
                        {missing > 0 && damaged > 0 ? " · " : null}
                        {damaged > 0 ? <>Oštećeno: <span className="font-medium text-foreground">{damaged} {uom}</span></> : null}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm font-semibold tracking-wider">{c.barcode ?? "—"}</p>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Skenirajte za prijem</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {pendingAdHoc.length > 0 ? (
          <section className="mb-6 space-y-3 rounded-xl border-2 border-primary/30 bg-primary/[0.05] p-4">
            <header className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" />
                  Vanredne stavke za prijem (van porudžbenice)
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Nabavka je dodala stavke koje nisu u originalnoj porudžbenici. Skenirajte A-barkod ili
                  potvrdite ručno prijem.
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                Čeka: {pendingAdHoc.length}
                {receivedAdHoc.length > 0 ? ` · primljeno: ${receivedAdHoc.length}` : null}
              </span>
            </header>

            <ul className="space-y-2">
              {pendingAdHoc.map((item) => {
                const label = `${item.description} — ${item.quantity} ${item.unit || "kom"}`;
                return (
                  <li
                    key={item.id}
                    className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Package className="h-3.5 w-3.5 text-primary" />
                        {item.articleCode ? (
                          <span className="font-mono text-xs text-muted-foreground">{item.articleCode}</span>
                        ) : null}
                        <span className="text-sm font-semibold text-foreground break-words">{item.description}</span>
                        <span className="rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          Vanredna stavka
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Količina: <span className="font-medium text-foreground">{item.quantity} {item.unit || "kom"}</span>
                        {item.notes ? <span className="ml-2 italic">„{item.notes}”</span> : null}
                      </p>
                      {item.attachmentUrl ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2 h-8 gap-1.5 text-xs"
                          asChild
                        >
                          <a href={item.attachmentUrl} target="_blank" rel="noopener noreferrer">
                            <FileText className="h-3.5 w-3.5" aria-hidden />
                            {item.attachmentName ? `Vidi fajl: ${item.attachmentName}` : "Vidi prilog"}
                            <ExternalLink className="h-3 w-3" aria-hidden />
                          </a>
                        </Button>
                      ) : (
                        <p className="mt-1 text-[10px] italic text-muted-foreground">Nije priložen fajl.</p>
                      )}
                    </div>
                    <div className="flex flex-col items-stretch gap-2 sm:items-end">
                      <div className="text-right">
                        <p className="font-mono text-sm font-semibold tracking-wider">{item.barcode}</p>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Skenirajte ili potvrdite</p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="gap-1.5"
                        disabled={receiveByBarcode.isPending}
                        onClick={() => void handleManualAdHocReceive(item.barcode, label)}
                      >
                        {receiveByBarcode.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                        )}
                        Potvrdi prijem
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {receivedAdHoc.length > 0 ? (
          <details className="mb-6 rounded-xl border border-border bg-muted/30 p-3 text-sm">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Već primljene vanredne stavke ({receivedAdHoc.length})
            </summary>
            <ul className="mt-2 space-y-1">
              {receivedAdHoc.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3 w-3 text-green-600" />
                    {item.description} — {item.quantity} {item.unit || "kom"}
                  </span>
                  <span className="font-mono">{item.barcode}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {!isWaitingForDelivery && !orderIsSiteHitShortage ? (
          <p className="mb-4 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Originalni prijem porudžbine je već završen. Magacin može da skenira preostale barkodove za reklamacije ili vanredne stavke.
          </p>
        ) : !eligible ? (
          <p className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
            Ova narudžbina nema uvezene nabavne stavke (Excel). Barkod prijem je predviđen za porudžbine sa štampanim
            barkodovima po stavci.
          </p>
        ) : null}

        {isShortageReception && receivableLineIndices.size === 0 && !order?.siteMissingFromInstallation ? (
          <p className="mb-4 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            Nema stavki spremnih za prijem. Prebacite reklamaciju u status „U rešavanju / Čeka se dostava” da bi se
            pojavila ovde.
          </p>
        ) : null}

        <ul className={cn("space-y-4", !canReceiveProcurementLines && "hidden")}>
          {lines.map((line, index) => {
            if (isShortageReception && !receivableLineIndices.has(index)) return null;
            const m = line.procurementMeta;
            const barcode = procurementBarcodeValueForOrderLine(
              line,
              materialOrderIdForBarcodes
                ? { materialOrderId: materialOrderIdForBarcodes, lineIndex: index }
                : undefined,
            );
            const recv = lineReception[index];
            const qty = lineExpectedQty(line);

            return (
              <li
                key={`${index}-${line.description}`}
                className={cn(
                  "rounded-lg border p-4 shadow-sm transition-colors",
                  recv 
                    ? "border-green-500/30 bg-green-50/30 dark:bg-green-950/20" 
                    : "border-border bg-card",
                  activeLineIndex === index && "ring-2 ring-primary",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1 flex items-start gap-2">
                    {recv ? <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" /> : null}
                    <div>
                      <p className="font-semibold leading-snug">{line.description}</p>
                      {barcode ? (
                        <p className="font-mono text-xs text-muted-foreground break-all">Barkod: {barcode}</p>
                      ) : null}
                      {line.shortageSource ? (
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                          Nadoknada:{" "}
                          {line.shortageSource.missingQty > 0
                            ? `${line.shortageSource.missingQty} nedostaje`
                            : null}
                          {line.shortageSource.missingQty > 0 && line.shortageSource.damagedQty > 0 ? " + " : ""}
                          {line.shortageSource.damagedQty > 0
                            ? `${line.shortageSource.damagedQty} oštećeno`
                            : null}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    <span className="text-muted-foreground">Količina: </span>
                    <span className="font-semibold tabular-nums">{qty}</span>
                    <span className="text-muted-foreground"> {line.unit || "kom"}</span>
                  </div>
                </div>

                <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                  {m?.work_order?.trim() ? (
                    <>
                      <dt className="text-muted-foreground">Radni nalog</dt>
                      <dd className="font-medium">{m.work_order.trim()}</dd>
                    </>
                  ) : null}
                  {m?.position?.trim() ? (
                    <>
                      <dt className="text-muted-foreground">Pozicija</dt>
                      <dd className="font-medium">{m.position.trim()}</dd>
                    </>
                  ) : null}
                  {m?.article_code?.trim() ? (
                    <>
                      <dt className="text-muted-foreground">Šifra artikla</dt>
                      <dd className="font-mono font-medium">{m.article_code.trim()}</dd>
                    </>
                  ) : null}
                  {m?.article?.trim() ? (
                    <>
                      <dt className="text-muted-foreground">Artikal</dt>
                      <dd className="font-medium">{m.article.trim()}</dd>
                    </>
                  ) : null}
                  {m?.color?.trim() ? (
                    <>
                      <dt className="text-muted-foreground">Boja</dt>
                      <dd className="font-medium">{m.color.trim()}</dd>
                    </>
                  ) : null}
                  {m?.uom?.trim() ? (
                    <>
                      <dt className="text-muted-foreground">JM (meta)</dt>
                      <dd className="font-medium">{m.uom.trim()}</dd>
                    </>
                  ) : null}
                  {m?.length_mm != null && Number.isFinite(m.length_mm) ? (
                    <>
                      <dt className="text-muted-foreground">Dužina</dt>
                      <dd className="font-medium tabular-nums">{m.length_mm} mm</dd>
                    </>
                  ) : null}
                  {line.materialType ? (
                    <>
                      <dt className="text-muted-foreground">Tip materijala</dt>
                      <dd className="font-medium">{line.materialType}</dd>
                    </>
                  ) : null}
                </dl>

                {recv ? (
                  <div className="mt-3 rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-xs">
                    <span className="font-medium text-foreground">Lokalni prijem: </span>
                    ispravno {recv.receivedIntact}, nedostaje {recv.missing}, oštećeno {recv.damaged}
                    {recv.notes ? <span className="mt-1 block text-muted-foreground">„{recv.notes}”</span> : null}
                    {recv.photoUrls.length > 0 ? (
                      <span className="mt-1 block text-muted-foreground">{recv.photoUrls.length} fotografija</span>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => setActiveLineIndex(index)}>
                    Unesi prijem
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>

        {isWaitingForDelivery && lines.length > 0 && receivableLineIndices.size > 0 ? (
          <div className="mt-8 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {allLinesRecorded
                ? "Sve prikazane stavke imaju unet prijem. Potvrdite prijem nadoknade."
                : "Unesite prijem za svaku prikazanu stavku, zatim potvrdite prijem."}
            </p>
            <Button
              type="button"
              disabled={!allLinesRecorded || !uploadedBy || finalizeReception.isPending}
              onClick={handleFinalize}
              className="shrink-0 gap-2 sm:min-w-[12rem]"
            >
              {finalizeReception.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Završi prijem porudžbine
            </Button>
          </div>
        ) : null}

        {activeLine && activeLineIndex !== null && order ? (
          <ItemReceptionModal
            key={`${order.id}-${activeLineIndex}`}
            open={modalOpen}
            onOpenChange={(o) => {
              if (!o) setActiveLineIndex(null);
            }}
            line={activeLine}
            expectedQty={activeExpected}
            jobId={order.jobId}
            materialOrderId={order.id}
            uploadedBy={uploadedBy}
            saved={lineReception[activeLineIndex] ?? null}
            onConfirm={(payload) => {
              handleSetLineReception((prev) => ({ ...prev, [activeLineIndex]: payload }));
            }}
          />
        ) : null}

        {cameraScannerOpen ? (
          <CameraBarcodeScanner
            onClose={() => setCameraScannerOpen(false)}
            onScanSuccess={handleCameraScanSuccess}
          />
        ) : null}
      </PageTransition>
    </AppLayout>
  );
}
