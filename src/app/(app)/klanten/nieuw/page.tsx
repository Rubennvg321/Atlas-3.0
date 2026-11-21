import { NewCustomerForm } from "@/components/customer-forms";
import { Card, PageHeader } from "@/components/server-ui";

export const metadata = { title: "Nieuwe klant" };

export default function NewCustomerPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Nieuwe klant / lead" />
      <Card>
        <NewCustomerForm />
      </Card>
    </div>
  );
}
