CREATE TABLE "turnip_private"."friend_links" (
	"player_id" uuid NOT NULL,
	"friend_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friend_links_player_id_friend_id_pk" PRIMARY KEY("player_id","friend_id"),
	CONSTRAINT "friend_links_not_self" CHECK ("turnip_private"."friend_links"."player_id" <> "turnip_private"."friend_links"."friend_id")
);
--> statement-breakpoint
ALTER TABLE "turnip_private"."friend_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "turnip_private"."friend_links" ADD CONSTRAINT "friend_links_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "turnip_private"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnip_private"."friend_links" ADD CONSTRAINT "friend_links_friend_id_players_id_fk" FOREIGN KEY ("friend_id") REFERENCES "turnip_private"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "friend_links_friend_player_idx" ON "turnip_private"."friend_links" USING btree ("friend_id","player_id");