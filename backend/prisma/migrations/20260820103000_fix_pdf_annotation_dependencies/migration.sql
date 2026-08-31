CREATE TABLE IF NOT EXISTS "PdfAnnotation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "page" INTEGER NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'HIGHLIGHT',
  "quote" TEXT,
  "note" TEXT,
  "color" TEXT NOT NULL DEFAULT '#facc15',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PdfAnnotation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PdfAnnotation_userId_documentId_page_idx" ON "PdfAnnotation"("userId", "documentId", "page");
ALTER TABLE "PdfAnnotation" ADD CONSTRAINT "PdfAnnotation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PdfAnnotation" ADD CONSTRAINT "PdfAnnotation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "PdfDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
