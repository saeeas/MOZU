import pdf from "pdf-parse";

/**
 * PDFファイルからテキストを抽出する
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const data = await pdf(buffer);
  return data.text;
}
