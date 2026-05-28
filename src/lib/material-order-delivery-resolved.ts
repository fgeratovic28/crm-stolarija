/** Usklađeno sa PostgreSQL funkcijom `material_order_delivery_resolved`. */
export function materialOrderDeliveryResolved(status: string): boolean {
  return (
    status === "delivered" ||
    status === "partial" ||
    status === "materials_received" ||
    status === "received_with_issues"
  );
}
