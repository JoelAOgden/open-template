import type { ImportFile } from "../../../shared/imports";

export async function readImportFiles(files: File[]): Promise<ImportFile[]> {
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      base64: await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () =>
          reject(new Error(`Could not read ${file.name}.`));
        reader.onabort = () =>
          reject(new Error(`Reading ${file.name} was cancelled.`));
        reader.readAsDataURL(file);
      }),
    })),
  );
}
