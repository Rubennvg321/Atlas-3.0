import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const deletedAt = () => timestamp("deleted_at", { withTimezone: true });

// ---------------------------------------------------------------------------
// Gebruikers en instellingen
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: text("role").notNull().default("beheerder"), // beheerder | medewerker | monteur (later)
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
  updatedBy: uuid("updated_by").references(() => users.id),
});

export const pipelineStages = pgTable("pipeline_stages", {
  key: text("key").primaryKey(), // vaste sleutel, gebruikt door automatisering
  label: text("label").notNull(),
  position: integer("position").notNull(),
  // open: loopt nog; won: opdracht binnen, nog bezig; done: afgerond; lost: vervallen
  kind: text("kind").notNull(),
  color: text("color").notNull().default("slate"),
  active: boolean("active").notNull().default(true),
});

// ---------------------------------------------------------------------------
// Klanten
// ---------------------------------------------------------------------------

export const customers = pgTable(
  "customers",
  {
    id: id(),
    displayName: text("display_name").notNull(),
    street: text("street"),
    houseNumber: integer("house_number"),
    houseNumberAddition: text("house_number_addition"),
    postcode: text("postcode"),
    city: text("city"),
    country: text("country").notNull().default("NL"),
    streetKey: text("street_key"),
    wefactDebtorCode: text("wefact_debtor_code"),
    source: text("source"), // handmatig | website | import | agenda | wefact
    notes: text("notes"),
    mergedIntoId: uuid("merged_into_id"),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("customers_address_idx").on(t.postcode, t.houseNumber),
    index("customers_street_idx").on(t.streetKey, t.houseNumber),
    uniqueIndex("customers_wefact_debtor_uq").on(t.wefactDebtorCode).where(sql`${t.wefactDebtorCode} is not null`),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    firstName: text("first_name"),
    infix: text("infix"),
    lastName: text("last_name"),
    lastNameKey: text("last_name_key"),
    role: text("role"), // bv. partner
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("contacts_customer_idx").on(t.customerId), index("contacts_last_name_key_idx").on(t.lastNameKey)],
);

export const contactPoints = pgTable(
  "contact_points",
  {
    id: id(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    contactId: uuid("contact_id").references(() => contacts.id),
    kind: text("kind").notNull(), // email | phone
    value: text("value").notNull(), // zoals ingevoerd
    normalized: text("normalized").notNull(),
    label: text("label"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("contact_points_lookup_idx").on(t.kind, t.normalized),
    index("contact_points_customer_idx").on(t.customerId),
    check("contact_points_kind_chk", sql`${t.kind} in ('email','phone')`),
  ],
);

// ---------------------------------------------------------------------------
// Trajecten (kaarten op het bord)
// ---------------------------------------------------------------------------

export const trajects = pgTable(
  "trajects",
  {
    id: id(),
    number: integer("number").generatedAlwaysAsIdentity(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    title: text("title"),
    description: text("description"),
    /** De enige bron van waarheid voor de fase. De kaartpositie wordt hieruit afgeleid. */
    stage: text("stage").notNull().references(() => pipelineStages.key),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
    lostReason: text("lost_reason"), // te_duur | geen_reactie | concurrent | anders
    lostNote: text("lost_note"),
    // Afwijkend montageadres (leeg = klantadres)
    siteStreet: text("site_street"),
    siteHouseNumber: integer("site_house_number"),
    siteHouseNumberAddition: text("site_house_number_addition"),
    sitePostcode: text("site_postcode"),
    siteCity: text("site_city"),
    source: text("source"),
    referral: text("referral"),
    /** Handmatige verkoopprijs excl. btw, alleen gebruikt zolang er geen WeFact-offerte is. */
    saleAmountExclManual: numeric("sale_amount_excl_manual", { precision: 12, scale: 2 }),
    /** Handmatig aantal montagedagen (leeg = afgeleid uit de rode agenda-afspraken). */
    montageDaysManual: integer("montage_days_manual"),
    reviewRequestedAt: timestamp("review_requested_at", { withTimezone: true }),
    reviewReminderAt: timestamp("review_reminder_at", { withTimezone: true }),
    reviewReceivedAt: timestamp("review_received_at", { withTimezone: true }),
    /** Optimistische vergrendeling: voorkomt dat twee apparaten elkaar overschrijven. */
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("trajects_customer_idx").on(t.customerId),
    index("trajects_stage_idx").on(t.stage),
    check(
      "trajects_lost_reason_chk",
      sql`${t.lostReason} is null or ${t.lostReason} in ('te_duur','geen_reactie','concurrent','anders')`,
    ),
  ],
);

export const stageChanges = pgTable(
  "stage_changes",
  {
    id: id(),
    trajectId: uuid("traject_id").notNull().references(() => trajects.id),
    fromStage: text("from_stage"),
    toStage: text("to_stage").notNull(),
    source: text("source").notNull(), // manual | automatic | proposal
    userId: uuid("user_id").references(() => users.id),
    reason: text("reason"),
    refType: text("ref_type"),
    refId: text("ref_id"),
    createdAt: createdAt(),
  },
  (t) => [index("stage_changes_traject_idx").on(t.trajectId, t.createdAt)],
);

export const stageProposals = pgTable(
  "stage_proposals",
  {
    id: id(),
    trajectId: uuid("traject_id").notNull().references(() => trajects.id),
    toStage: text("to_stage").notNull().references(() => pipelineStages.key),
    reason: text("reason").notNull(),
    refType: text("ref_type"),
    refId: text("ref_id"),
    status: text("status").notNull().default("open"), // open | accepted | rejected
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("stage_proposals_ref_uq")
      .on(t.trajectId, t.toStage, t.refType, t.refId)
      .where(sql`${t.refId} is not null`),
  ],
);

export const appointments = pgTable(
  "appointments",
  {
    id: id(),
    trajectId: uuid("traject_id").references(() => trajects.id),
    customerId: uuid("customer_id").references(() => customers.id),
    kind: text("kind").notNull().default("advies"), // advies | inmeting | montage | overig
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    location: text("location"),
    allDay: boolean("all_day").notNull().default(false),
    status: text("status").notNull().default("gepland"), // gepland | geannuleerd
    googleCalendarId: text("google_calendar_id"),
    googleEventId: text("google_event_id"),
    googleEtag: text("google_etag"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("appointments_google_uq").on(t.googleCalendarId, t.googleEventId).where(sql`${t.googleEventId} is not null`),
    index("appointments_traject_idx").on(t.trajectId, t.startsAt),
  ],
);

export const quotes = pgTable(
  "quotes",
  {
    id: id(),
    trajectId: uuid("traject_id").references(() => trajects.id),
    customerId: uuid("customer_id").references(() => customers.id),
    wefactId: text("wefact_id"),
    number: text("number"),
    amountExcl: numeric("amount_excl", { precision: 12, scale: 2 }),
    amountIncl: numeric("amount_incl", { precision: 12, scale: 2 }),
    status: text("status").notNull().default("concept"), // concept | verzonden | geaccepteerd | afgewezen | vervallen
    quoteDate: timestamp("quote_date", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    raw: jsonb("raw"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("quotes_wefact_uq").on(t.wefactId).where(sql`${t.wefactId} is not null`),
    index("quotes_traject_idx").on(t.trajectId),
    index("quotes_number_idx").on(t.number),
  ],
);

/** Inkooporders bij leveranciers (PPC, fedi, ...), uit orderbevestigingen in Gmail of handmatig. */
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: id(),
    trajectId: uuid("traject_id").references(() => trajects.id),
    customerId: uuid("customer_id").references(() => customers.id),
    supplier: text("supplier").notNull(), // PPC | fedi | ...
    orderNumber: text("order_number"),
    commission: text("commission"), // "Fam. Hoedemaker" — gebruikt om aan de klant te koppelen
    /** Vrije omschrijving, bijv. "extra trapneuzen" (vooral bij handmatige extra bestellingen). */
    description: text("description"),
    amountExcl: numeric("amount_excl", { precision: 12, scale: 2 }).notNull(),
    orderDate: timestamp("order_date", { withTimezone: true }),
    source: text("source").notNull().default("handmatig"), // gmail | handmatig
    gmailMessageId: text("gmail_message_id"),
    /** gekoppeld | te_koppelen (geen of meerdere passende trajecten gevonden) */
    status: text("status").notNull().default("gekoppeld"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("purchase_orders_supplier_order_uq").on(t.supplier, t.orderNumber).where(sql`${t.orderNumber} is not null`),
    index("purchase_orders_traject_idx").on(t.trajectId),
    index("purchase_orders_status_idx").on(t.status),
  ],
);

/**
 * Documenten bij een bestelling: orderbevestiging (PDF of de mail zelf) en
 * inkoopfactuur. Automatisch uit Gmail of handmatig geüpload (PDF of foto).
 */
export const purchaseDocuments = pgTable(
  "purchase_documents",
  {
    id: id(),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id),
    kind: text("kind").notNull().default("factuur"), // orderbevestiging | factuur | overig
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    data: bytea("data").notNull(),
    source: text("source").notNull().default("upload"), // gmail | upload
    gmailMessageId: text("gmail_message_id"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("purchase_documents_po_idx").on(t.purchaseOrderId),
    // Idempotent: dezelfde bijlage uit dezelfde mail maar één keer per bestelling.
    uniqueIndex("purchase_documents_gmail_uq").on(t.purchaseOrderId, t.gmailMessageId, t.filename).where(sql`${t.gmailMessageId} is not null`),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    trajectId: uuid("traject_id").references(() => trajects.id),
    customerId: uuid("customer_id").references(() => customers.id),
    title: text("title").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    assigneeId: uuid("assignee_id").references(() => users.id),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("tasks_traject_idx").on(t.trajectId), index("tasks_open_idx").on(t.doneAt, t.dueAt)],
);

export const notes = pgTable(
  "notes",
  {
    id: id(),
    trajectId: uuid("traject_id").references(() => trajects.id),
    customerId: uuid("customer_id").references(() => customers.id),
    body: text("body").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("notes_traject_idx").on(t.trajectId)],
);

export const emails = pgTable(
  "emails",
  {
    id: id(),
    trajectId: uuid("traject_id").references(() => trajects.id),
    customerId: uuid("customer_id").references(() => customers.id),
    gmailMessageId: text("gmail_message_id").notNull().unique(),
    gmailThreadId: text("gmail_thread_id"),
    direction: text("direction").notNull(), // in | uit
    fromAddress: text("from_address"),
    toAddresses: text("to_addresses"),
    subject: text("subject"),
    snippet: text("snippet"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("emails_traject_idx").on(t.trajectId, t.sentAt)],
);

export const timelineEvents = pgTable(
  "timeline_events",
  {
    id: id(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    trajectId: uuid("traject_id").references(() => trajects.id),
    type: text("type").notNull(), // traject_aangemaakt | fase | notitie | taak | aanvraag | mail | afspraak | offerte | samengevoegd | ...
    title: text("title").notNull(),
    body: text("body"),
    payload: jsonb("payload"),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index("timeline_traject_idx").on(t.trajectId, t.occurredAt),
    index("timeline_customer_idx").on(t.customerId, t.occurredAt),
  ],
);

// ---------------------------------------------------------------------------
// Ontdubbeling
// ---------------------------------------------------------------------------

export const duplicateCandidates = pgTable(
  "duplicate_candidates",
  {
    id: id(),
    /** Altijd customerAId < customerBId, zodat elk paar maar één keer bestaat. */
    customerAId: uuid("customer_a_id").notNull().references(() => customers.id),
    customerBId: uuid("customer_b_id").notNull().references(() => customers.id),
    score: integer("score").notNull(),
    signals: jsonb("signals").notNull(),
    status: text("status").notNull().default("open"), // open | merged | not_same
    origin: text("origin"),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("duplicate_pair_uq").on(t.customerAId, t.customerBId),
    index("duplicate_status_idx").on(t.status),
    check("duplicate_order_chk", sql`${t.customerAId} < ${t.customerBId}`),
  ],
);

export const customerMerges = pgTable("customer_merges", {
  id: id(),
  survivorId: uuid("survivor_id").notNull().references(() => customers.id),
  mergedId: uuid("merged_id").notNull().references(() => customers.id),
  /** Per tabel de id's die van merged naar survivor zijn verplaatst. */
  moved: jsonb("moved").notNull(),
  survivorBefore: jsonb("survivor_before").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  undoneAt: timestamp("undone_at", { withTimezone: true }),
  undoneBy: uuid("undone_by").references(() => users.id),
});

// ---------------------------------------------------------------------------
// Intake, sync en audit
// ---------------------------------------------------------------------------

export const inboundItems = pgTable(
  "inbound_items",
  {
    id: id(),
    provider: text("provider").notNull(), // website | handmatig | import | gmail | agenda | wefact
    externalId: text("external_id").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"), // pending | done | error | ignored
    decision: text("decision"), // auto | doubt | none
    customerId: uuid("customer_id").references(() => customers.id),
    trajectId: uuid("traject_id").references(() => trajects.id),
    error: text("error"),
    createdAt: createdAt(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("inbound_provider_external_uq").on(t.provider, t.externalId)],
);

export const integrations = pgTable("integrations", {
  id: id(),
  provider: text("provider").notNull().unique(), // gmail | google_calendar | wefact | google_business
  account: text("account"),
  status: text("status").notNull().default("niet_gekoppeld"), // gekoppeld | verlopen | fout | niet_gekoppeld
  encryptedTokens: text("encrypted_tokens"),
  cursor: text("cursor"),
  config: jsonb("config"),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const externalRefs = pgTable(
  "external_refs",
  {
    id: id(),
    provider: text("provider").notNull(),
    entityType: text("entity_type").notNull(),
    externalId: text("external_id").notNull(),
    localTable: text("local_table").notNull(),
    localId: uuid("local_id").notNull(),
    etag: text("etag"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("external_refs_uq").on(t.provider, t.entityType, t.externalId)],
);

export const syncRuns = pgTable("sync_runs", {
  id: id(),
  provider: text("provider").notNull(),
  kind: text("kind").notNull(), // incremental | full | reconcile | retry
  status: text("status").notNull().default("running"), // running | ok | error
  itemsProcessed: integer("items_processed").notNull().default(0),
  errorMessage: text("error_message"),
  errorDetail: text("error_detail"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    data: jsonb("data"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_entity_idx").on(t.entity, t.entityId)],
);
