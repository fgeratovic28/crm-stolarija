import * as XLSX from 'xlsx';

export interface ExcelImportResult<T> {
  data: T[];
  errors: string[];
}

export async function parseExcelFile<T>(file: File, columnMap: Record<string, keyof T>): Promise<ExcelImportResult<T>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as Record<string, unknown>[];

        const results: T[] = [];
        const errors: string[] = [];

        jsonData.forEach((row, index) => {
          const item: Partial<T> = {};

          for (const [excelCol, targetKey] of Object.entries(columnMap)) {
            if (row[excelCol] !== undefined) {
              item[targetKey as keyof T] = row[excelCol] as T[keyof T];
            }
          }

          if (Object.keys(item).length > 0) {
            results.push(item as T);
          } else {
            errors.push(`Red ${index + 2}: Nema prepoznatih kolona.`);
          }
        });

        resolve({ data: results, errors });
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
}
