import { NewCustomerForm, type NewCustomerDefaults } from "@/components/customer-forms";
import { Card, PageHeader } from "@/components/server-ui";

export const metadata = { title: "Nieuwe klant" };

const KEYS = ["appointmentId", "lastName", "postcode", "houseNumber", "addition", "street", "city", "message"] as const;

/** Velden kunnen vooraf ingevuld worden via de link, bijv. vanuit "Afspraken zonder klant" op het dashboard. */
export default async function NewCustomerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const defaults: NewCustomerDefaults = {};
  for (const k of KEYS) if (typeof sp[k] === "string") defaults[k] = sp[k];
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Nieuwe klant / lead" />
      <Card>
        <NewCustomerForm defaults={defaults} />
      </Card>
    </div>
  );
}
