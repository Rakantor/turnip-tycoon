CREATE TABLE "turnip_private"."trades" (
	"week_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"quantity" integer NOT NULL,
	"price" integer NOT NULL,
	"day" integer,
	"slot" text,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "trades_week_id_id_pk" PRIMARY KEY("week_id","id"),
	CONSTRAINT "trades_week_position_unique" UNIQUE("week_id","position"),
	CONSTRAINT "trades_kind" CHECK ("turnip_private"."trades"."kind" in ('buy', 'sell')),
	CONSTRAINT "trades_position" CHECK ("turnip_private"."trades"."position" between 0 and 39),
	CONSTRAINT "trades_quantity" CHECK ("turnip_private"."trades"."quantity" between 10 and 100000 and "turnip_private"."trades"."quantity" % 10 = 0),
	CONSTRAINT "trades_price" CHECK (("turnip_private"."trades"."kind" = 'buy' and "turnip_private"."trades"."price" between 90 and 110) or ("turnip_private"."trades"."kind" = 'sell' and "turnip_private"."trades"."price" between 9 and 660)),
	CONSTRAINT "trades_half_day" CHECK (("turnip_private"."trades"."kind" = 'buy' and "turnip_private"."trades"."day" is null and "turnip_private"."trades"."slot" is null) or ("turnip_private"."trades"."kind" = 'sell' and "turnip_private"."trades"."day" is not null and "turnip_private"."trades"."slot" is not null and "turnip_private"."trades"."day" between 1 and 6 and "turnip_private"."trades"."slot" in ('AM', 'PM'))),
	CONSTRAINT "trades_revision_nonnegative" CHECK ("turnip_private"."trades"."revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "turnip_private"."trades" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "turnip_private"."trades" ADD CONSTRAINT "trades_week_id_player_id_weeks_id_player_id_fk" FOREIGN KEY ("week_id","player_id") REFERENCES "turnip_private"."weeks"("id","player_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trades_player_idx" ON "turnip_private"."trades" USING btree ("player_id");