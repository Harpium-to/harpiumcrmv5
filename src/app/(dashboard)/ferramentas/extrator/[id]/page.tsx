import { ExtractionView } from "@/components/extractor/extraction-view";

/** One extraction: its results and what to do with them (migration 073). */
export default async function ExtractionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ExtractionView id={id} />;
}
