import { sqliteTable, text, integer, primaryKey, check, unique } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const entries = sqliteTable("entries", {
  owner: text("owner").notNull(),
  id: text("id").notNull(),
  version: integer("version").notNull(),
  data: text("data").notNull(),
}, (t) => [primaryKey({columns: [t.owner, t.id]})]);

export const history = sqliteTable("history", {
  owner: text("owner").notNull(),
  id: text("id").notNull(),
  entryId: text("entry_id").notNull(),
  data: text("data").notNull(),
}, (t) => [primaryKey({columns: [t.owner, t.id]})]);

export const settings = sqliteTable("settings", {
  owner: text("owner").primaryKey(),
  lastExport: text("last_export"),
});
export const personalProfiles=sqliteTable("personal_profiles",{owner:text("owner").primaryKey(),version:integer("version").notNull(),data:text("data").notNull()});
export const recordReferences = sqliteTable("record_references", {
  owner:text("owner").notNull(), entryId:text("entry_id").notNull(), number:integer("number").notNull(),
}, t=>[primaryKey({columns:[t.owner,t.entryId]}),unique("record_references_owner_number_unique").on(t.owner,t.number)]);
export const mutationGuard = sqliteTable("mutation_guard", {valid:integer("valid").notNull()}, t=>[check("one_changed_row",sql`${t.valid} = 1`)]);
export const topicDirectories = sqliteTable("topic_directories", {
  owner:text("owner").primaryKey(),
  revision:integer("revision").notNull(),
  data:text("data").notNull(),
});
