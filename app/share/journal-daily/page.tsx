import SharedJournalLoader from "./SharedJournalLoader";

export const preferredRegion = ["bom1", "sin1"];

export default function JournalDailySharePage({
  searchParams
}: {
  searchParams?: { data?: string; s?: string; id?: string };
}) {
  const id = searchParams?.id ?? "";
  const raw = searchParams?.s ?? searchParams?.data ?? "";

  return <SharedJournalLoader id={id} raw={raw} />;
}
