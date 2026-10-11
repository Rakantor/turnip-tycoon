CREATE TABLE "turnip_private"."friend_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"player_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "friend_invites_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "friend_invites_code_hash_format" CHECK ("turnip_private"."friend_invites"."code_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "friend_invites_expiry" CHECK ("turnip_private"."friend_invites"."expires_at" > "turnip_private"."friend_invites"."created_at")
);
--> statement-breakpoint
ALTER TABLE "turnip_private"."friend_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "turnip_private"."friend_invites" ADD CONSTRAINT "friend_invites_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "turnip_private"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "friend_invites_player_idx" ON "turnip_private"."friend_invites" USING btree ("player_id");