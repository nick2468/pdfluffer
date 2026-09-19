// Generates the test PDFs in samples/ (spec section 14).
// Run with `npm run samples`. Node 24 runs this file directly by stripping the types.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "samples");

// Fixed dates keep the output the same from run to run.
const FIXED_DATE = new Date("2026-01-01T00:00:00Z");

async function newDoc(title: string): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer("PDFluffer make-samples");
  doc.setCreator("PDFluffer make-samples");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  return doc;
}

async function formBasic(): Promise<Uint8Array> {
  const doc = await newDoc("Form basic");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();

  const label = (text: string, y: number) =>
    page.drawText(text, { x: 60, y, size: 12, font });

  page.drawText("Sample form", { x: 60, y: 720, size: 20, font });

  label("Full name", 660);
  form.createTextField("fullName").addToPage(page, { x: 180, y: 652, width: 300, height: 22, font });

  label("Email", 620);
  form.createTextField("email").addToPage(page, { x: 180, y: 612, width: 300, height: 22, font });

  label("Subscribe", 580);
  form.createCheckBox("subscribe").addToPage(page, { x: 180, y: 576, width: 16, height: 16 });

  label("Country", 540);
  const country = form.createDropdown("country");
  country.addOptions(["Australia", "New Zealand", "United Kingdom", "Other"]);
  country.addToPage(page, { x: 180, y: 532, width: 200, height: 22, font });

  label("Contact by", 500);
  const contact = form.createRadioGroup("contactBy");
  const options = ["Phone", "Email", "Post"];
  options.forEach((option, i) => {
    const x = 180 + i * 100;
    contact.addOptionToPage(option, page, { x, y: 496, width: 16, height: 16 });
    page.drawText(option, { x: x + 22, y: 499, size: 11, font });
  });

  return doc.save();
}

async function flatForm(): Promise<Uint8Array> {
  const doc = await newDoc("Flat form");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);

  page.drawText("Application (no form fields)", { x: 60, y: 720, size: 20, font });

  const rows = ["Full name", "Address", "Phone", "Date", "Signature"];
  rows.forEach((text, i) => {
    const y = 660 - i * 50;
    page.drawText(text, { x: 60, y, size: 12, font });
    page.drawLine({
      start: { x: 160, y: y - 2 },
      end: { x: 540, y: y - 2 },
      thickness: 1,
      color: rgb(0, 0, 0),
    });
  });

  return doc.save();
}

async function threePages(): Promise<Uint8Array> {
  const doc = await newDoc("Three pages");
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let n = 1; n <= 3; n++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${n}`, { x: 150, y: 400, size: 96, font });
  }
  return doc.save();
}

function fakeSigned(threePagesBytes: Uint8Array): Uint8Array {
  const tail = new TextEncoder().encode("\n% /ByteRange [0 0 0 0]\n");
  const out = new Uint8Array(threePagesBytes.length + tail.length);
  out.set(threePagesBytes, 0);
  out.set(tail, threePagesBytes.length);
  return out;
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const three = await threePages();
  const files: [string, Uint8Array][] = [
    ["form-basic.pdf", await formBasic()],
    ["flat-form.pdf", await flatForm()],
    ["three-pages.pdf", three],
    ["fake-signed.pdf", fakeSigned(three)],
  ];
  for (const [name, bytes] of files) {
    writeFileSync(join(outDir, name), bytes);
    console.log(`wrote samples/${name} (${bytes.length} bytes)`);
  }
}

await main();
