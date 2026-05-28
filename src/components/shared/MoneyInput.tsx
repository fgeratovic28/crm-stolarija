import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  formatMoneyInputOnBlur,
  sanitizeMoneyInputTyping,
} from "@/lib/money-input";

export type MoneyInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "type" | "value" | "onChange" | "inputMode"
> & {
  value: string;
  onValueChange: (value: string) => void;
};

/**
 * Tekstualno polje za iznose u RSD: zarez ili tačka, bez strelica brojača,
 * posle blur-a format `12.345,67`.
 */
export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ value, onValueChange, className, onBlur, placeholder = "0,00", ...props }, ref) => {
    return (
      <Input
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        className={cn("tabular-nums", className)}
        value={value}
        onChange={(e) => onValueChange(sanitizeMoneyInputTyping(e.target.value))}
        onBlur={(e) => {
          onValueChange(formatMoneyInputOnBlur(e.target.value));
          onBlur?.(e);
        }}
        {...props}
      />
    );
  },
);
MoneyInput.displayName = "MoneyInput";
