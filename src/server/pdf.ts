import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Tekst uit een PDF met pdftotext (poppler), met behoud van de opmaak. */
export async function pdfToText(buf: Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "atlas-pdf-"));
  const file = path.join(dir, "in.pdf");
  try {
    await writeFile(file, buf);
    return await new Promise<string>((resolve, reject) =>
      execFile("pdftotext", ["-layout", "-enc", "UTF-8", file, "-"], { maxBuffer: 10 * 1024 * 1024, timeout: 30000 }, (err, stdout) =>
        err ? reject(new Error(`pdftotext mislukt: ${err.message}`)) : resolve(stdout),
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
