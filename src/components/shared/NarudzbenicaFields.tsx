import { useFieldArray, useWatch } from "react-hook-form";
import type { Control } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { NarudzbenicaFieldsValues, MaterialOrderLineFormValues } from "@/lib/material-order-form-schema";
import { totalNetFromFormLines } from "@/lib/material-order-form-schema";
import type { MaterialType } from "@/types";
import { formatCurrencyBySettings } from "@/lib/app-settings";

interface NarudzbenicaFieldsProps {
  control: Control<NarudzbenicaFieldsValues>;
  /** Vrste materijala za stavke (npr. filtrirano po izabranom dobavljaču). */
  lineMaterialTypeOptions: { value: MaterialType; label: string }[];
}

const defaultLine = {
  description: "",
  quantity: 1,
  unit: "kom",
  lineNet: 0,
  materialType: undefined as string | undefined,
};

export function NarudzbenicaFields({ control, lineMaterialTypeOptions }: NarudzbenicaFieldsProps) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "nbLines",
  });

  const watchedLines = useWatch({ control, name: "nbLines" }) as MaterialOrderLineFormValues[] | undefined;
  const totalNet = totalNetFromFormLines(watchedLines ?? []);

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <p className="text-sm font-medium text-foreground">Stavke (iznos bez PDV-a po redu)</p>
        {fields.map((field, index) => (
          <div key={field.id} className="rounded-lg border border-border bg-background p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Stavka {index + 1}
              </span>
              {fields.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-destructive hover:text-destructive"
                  onClick={() => remove(index)}
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  Ukloni
                </Button>
              )}
            </div>

            <FormField
              control={control}
              name={`nbLines.${index}.materialType`}
              render={({ field: f }) => (
                <FormItem>
                  <FormLabel>Materijal</FormLabel>
                  <Select
                    onValueChange={(v) => f.onChange(v === "__none__" ? undefined : v)}
                    value={f.value ?? "__none__"}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Izaberite" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">—</SelectItem>
                      {lineMaterialTypeOptions.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={control}
              name={`nbLines.${index}.description`}
              render={({ field: f }) => (
                <FormItem>
                  <FormLabel>Naziv / opis</FormLabel>
                  <FormControl>
                    <Input placeholder="npr. Staklo float 6 mm" {...f} value={f.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <FormField
                control={control}
                name={`nbLines.${index}.quantity`}
                render={({ field: f }) => (
                  <FormItem>
                    <FormLabel>Količina</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="any"
                        min={0.0001}
                        {...f}
                        value={f.value === undefined || f.value === null ? "" : f.value}
                        onChange={(e) => {
                          const v = e.target.value;
                          f.onChange(v === "" ? undefined : Number(v.replace(",", ".")));
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name={`nbLines.${index}.unit`}
                render={({ field: f }) => (
                  <FormItem>
                    <FormLabel>JM</FormLabel>
                    <FormControl>
                      <Input placeholder="kom, m²…" {...f} value={f.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name={`nbLines.${index}.lineNet`}
                render={({ field: f }) => (
                  <FormItem>
                    <FormLabel>Iznos (bez PDV)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="any"
                        min={0}
                        {...f}
                        value={f.value === undefined || f.value === null ? "" : f.value}
                        onChange={(e) => {
                          const v = e.target.value;
                          f.onChange(v === "" ? undefined : Number(v.replace(",", ".")));
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full sm:w-auto gap-1"
          onClick={() => append(defaultLine)}
        >
          <Plus className="w-4 h-4" />
          Dodaj stavku
        </Button>

        <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm font-semibold text-foreground">Ukupno bez PDV-a</span>
          <span className="text-base font-semibold tabular-nums">{formatCurrencyBySettings(totalNet)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 border-t border-border pt-4">
        <FormField
          control={control}
          name="nbVatRatePercent"
          render={({ field }) => (
            <FormItem>
              <FormLabel>PDV % (na ukupan iznos)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  placeholder="20"
                  {...field}
                  value={field.value === undefined || field.value === null ? "" : field.value}
                  onChange={(e) => {
                    const v = e.target.value;
                    field.onChange(v === "" ? undefined : Number(v.replace(",", ".")));
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          control={control}
          name="nbBuyerBankAccount"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>Žiro račun naručioca</FormLabel>
              <FormControl>
                <Input placeholder="Za prikaz na porudžbenici" {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="nbShippingMethod"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>Način otpreme / isporuke</FormLabel>
              <FormControl>
                <Input placeholder="npr. sopstveni prevoz, kurir…" {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="nbPaymentDueDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Rok plaćanja</FormLabel>
              <FormControl>
                <Input type="date" {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="nbLegalReference"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Pravni osnov</FormLabel>
              <FormControl>
                <Input placeholder="npr. Ugovor br. …" {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="nbPaymentNote"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>Napomena o plaćanju</FormLabel>
              <FormControl>
                <Textarea placeholder="Dodatni uslovi plaćanja (ako nisu pokriveni rokom)" rows={2} {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="nbDeliveryAddressOverride"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>Adresa isporuke (druga od kupca u poslu)</FormLabel>
              <FormControl>
                <Textarea placeholder="Ostavite prazno da se koristi adresa kupca iz posla" rows={2} {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  );
}
