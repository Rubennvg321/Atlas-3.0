import { Card, PageHeader } from "@/components/server-ui";
import { ImportForm } from "@/components/import-form";

export const metadata = { title: "Import" };

export default function ImportPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Bestaande klanten importeren" />
      <Card>
        <p className="mb-3 text-sm text-stone-600">
          Upload een CSV-bestand (bijvoorbeeld opgeslagen vanuit Excel). Herkende kolommen: <em>Naam</em> (of Voornaam / Tussenvoegsel / Achternaam), <em>Telefoon</em>, <em>Mobiel</em>, <em>E-mail</em>, <em>Adres</em> (of Straat / Huisnummer / Toevoeging), <em>Postcode</em>, <em>Plaats</em>, <em>Fase</em>, <em>Omschrijving</em>, <em>Debiteurnummer</em>.
          Elke regel gaat door dezelfde herkenning als nieuwe aanvragen, dus dubbele klanten worden gekoppeld of als &lsquo;Mogelijk dubbel&rsquo; gemeld. Met een <em>Fase</em> (bijv. Afgerond) wordt ook een traject aangemaakt. Nog een keer importeren maakt geen dubbelen.
        </p>
        <ImportForm />
      </Card>
    </div>
  );
}
