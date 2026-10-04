CREATE SCHEMA "turnip_private";
--> statement-breakpoint
CREATE TABLE "turnip_private"."devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "devices_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "devices_id_player_unique" UNIQUE("id","player_id"),
	CONSTRAINT "devices_name_length" CHECK (char_length("turnip_private"."devices"."name") between 1 and 60),
	CONSTRAINT "devices_token_hash_format" CHECK ("turnip_private"."devices"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "devices_expiry" CHECK ("turnip_private"."devices"."expires_at" > "turnip_private"."devices"."created_at")
);
--> statement-breakpoint
ALTER TABLE "turnip_private"."devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnip_private"."groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_code" text NOT NULL,
	"name" text,
	CONSTRAINT "groups_share_code_unique" UNIQUE("share_code")
);
--> statement-breakpoint
ALTER TABLE "turnip_private"."groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnip_private"."memberships" (
	"group_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	CONSTRAINT "memberships_group_id_player_id_pk" PRIMARY KEY("group_id","player_id")
);
--> statement-breakpoint
ALTER TABLE "turnip_private"."memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnip_private"."mutations" (
	"player_id" uuid NOT NULL,
	"mutation_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"resulting_revision" integer NOT NULL,
	CONSTRAINT "mutations_player_id_mutation_id_pk" PRIMARY KEY("player_id","mutation_id"),
	CONSTRAINT "mutations_revision_nonnegative" CHECK ("turnip_private"."mutations"."resulting_revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "turnip_private"."mutations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnip_private"."pairing_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"claim_hash" text NOT NULL,
	"device_name" text NOT NULL,
	"player_id" uuid,
	"approved_by_device_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pairing_challenges_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "pairing_challenges_claim_hash_unique" UNIQUE("claim_hash"),
	CONSTRAINT "pairing_approval_consistency" CHECK (("turnip_private"."pairing_challenges"."player_id" is null) = ("turnip_private"."pairing_challenges"."approved_by_device_id" is null)),
	CONSTRAINT "pairing_device_name_length" CHECK (char_length("turnip_private"."pairing_challenges"."device_name") between 1 and 60),
	CONSTRAINT "pairing_code_hash_format" CHECK ("turnip_private"."pairing_challenges"."code_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "pairing_claim_hash_format" CHECK ("turnip_private"."pairing_challenges"."claim_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "turnip_private"."pairing_challenges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnip_private"."players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"island_name" text,
	"friend_code" text,
	CONSTRAINT "players_display_name_length" CHECK (char_length("turnip_private"."players"."display_name") between 1 and 40),
	CONSTRAINT "players_island_name_length" CHECK ("turnip_private"."players"."island_name" is null or char_length("turnip_private"."players"."island_name") between 1 and 40),
	CONSTRAINT "players_friend_code_format" CHECK ("turnip_private"."players"."friend_code" is null or "turnip_private"."players"."friend_code" ~ '^SW-[0-9]{4}-[0-9]{4}-[0-9]{4}$')
);
--> statement-breakpoint
ALTER TABLE "turnip_private"."players" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnip_private"."price_entries" (
	"week_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"day" integer NOT NULL,
	"slot" text NOT NULL,
	"price" integer NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "price_entries_week_id_day_slot_pk" PRIMARY KEY("week_id","day","slot"),
	CONSTRAINT "prices_selling_day" CHECK ("turnip_private"."price_entries"."day" between 1 and 6),
	CONSTRAINT "prices_slot" CHECK ("turnip_private"."price_entries"."slot" in ('AM', 'PM')),
	CONSTRAINT "prices_range" CHECK ("turnip_private"."price_entries"."price" between 1 and 660),
	CONSTRAINT "prices_revision_nonnegative" CHECK ("turnip_private"."price_entries"."revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "turnip_private"."price_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnip_private"."recovery_credentials" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	CONSTRAINT "recovery_credentials_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "recovery_hash_format" CHECK ("turnip_private"."recovery_credentials"."code_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "turnip_private"."recovery_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnip_private"."weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"purchase_price" integer,
	"first_buy" boolean,
	"previous_pattern" text,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "weeks_player_start_unique" UNIQUE("player_id","week_start"),
	CONSTRAINT "weeks_id_player_unique" UNIQUE("id","player_id"),
	CONSTRAINT "weeks_start_sunday" CHECK (extract(dow from "turnip_private"."weeks"."week_start") = 0),
	CONSTRAINT "weeks_purchase_range" CHECK ("turnip_private"."weeks"."purchase_price" is null or "turnip_private"."weeks"."purchase_price" between 90 and 110),
	CONSTRAINT "weeks_previous_pattern" CHECK ("turnip_private"."weeks"."previous_pattern" is null or "turnip_private"."weeks"."previous_pattern" in ('fluctuating', 'large-spike', 'decreasing', 'small-spike')),
	CONSTRAINT "weeks_revision_nonnegative" CHECK ("turnip_private"."weeks"."revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "turnip_private"."weeks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "turnip_private"."devices" ADD CONSTRAINT "devices_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "turnip_private"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnip_private"."memberships" ADD CONSTRAINT "memberships_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "turnip_private"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnip_private"."memberships" ADD CONSTRAINT "memberships_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "turnip_private"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnip_private"."mutations" ADD CONSTRAINT "mutations_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "turnip_private"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnip_private"."pairing_challenges" ADD CONSTRAINT "pairing_challenges_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "turnip_private"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnip_private"."pairing_challenges" ADD CONSTRAINT "pairing_challenges_approved_by_device_id_player_id_devices_id_player_id_fk" FOREIGN KEY ("approved_by_device_id","player_id") REFERENCES "turnip_private"."devices"("id","player_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnip_private"."price_entries" ADD CONSTRAINT "price_entries_week_id_player_id_weeks_id_player_id_fk" FOREIGN KEY ("week_id","player_id") REFERENCES "turnip_private"."weeks"("id","player_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnip_private"."recovery_credentials" ADD CONSTRAINT "recovery_credentials_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "turnip_private"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnip_private"."weeks" ADD CONSTRAINT "weeks_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "turnip_private"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devices_player_idx" ON "turnip_private"."devices" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "memberships_player_group_idx" ON "turnip_private"."memberships" USING btree ("player_id","group_id");--> statement-breakpoint
CREATE INDEX "pairing_expiry_idx" ON "turnip_private"."pairing_challenges" USING btree ("expires_at");
--> statement-breakpoint
-- Only the backend database owner may access application credentials and data.
-- RLS intentionally has no client policies. Never expose this schema in Data API.
REVOKE ALL ON SCHEMA "turnip_private" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "turnip_private" FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA turnip_private FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA turnip_private FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA turnip_private REVOKE ALL ON TABLES FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
