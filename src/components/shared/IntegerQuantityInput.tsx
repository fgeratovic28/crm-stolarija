import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { clampIntegerQuantity, parseIntegerQuantityInput } from "@/lib/integer-quantity-input";

export type IntegerQuantityInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "type" | "value" | "onChange" | "inputMode"
> & {
  value: number;
  onValueChange: (value: number) => void;
  max?: number;
};

/** Tekstualno polje za broj komada — bez strelica brojača na `type="number"`. */
export const IntegerQuantityInput = React.forwardRef<HTMLInputElement, IntegerQuantityInputProps>(
  ({ value, onValueChange, max, className, ...props }, ref) => {
    return (
      <Input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className={cn("tabular-nums", className)}
        value={Number.isFinite(value) ? String(Math.max(0, Math.floor(value))) : "0"}
        onChange={(e) => {
          const parsed = parseIntegerQuantityInput(e.target.value);
          onValueChange(clampIntegerQuantity(parsed, max));
        }}
        {...props}
      />
    );
  },
);
IntegerQuantityInput.displayName = "IntegerQuantityInput";
