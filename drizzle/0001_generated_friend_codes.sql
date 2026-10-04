ALTER TABLE "turnip_private"."players" DROP CONSTRAINT "players_friend_code_format";--> statement-breakpoint
-- Replace legacy Nintendo codes without changing any existing profile names or data.
DO $$
DECLARE
  existing_player record;
  candidate text;
BEGIN
  FOR existing_player IN SELECT id FROM turnip_private.players LOOP
    LOOP
      candidate := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
      candidate := substr(candidate, 1, 4) || '-' || substr(candidate, 5, 4) || '-' || substr(candidate, 9, 4);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM turnip_private.players WHERE friend_code = candidate);
    END LOOP;
    UPDATE turnip_private.players SET friend_code = candidate WHERE id = existing_player.id;
  END LOOP;
END
$$;--> statement-breakpoint
ALTER TABLE "turnip_private"."players" ALTER COLUMN "friend_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "turnip_private"."players" ADD CONSTRAINT "players_friend_code_unique" UNIQUE("friend_code");--> statement-breakpoint
ALTER TABLE "turnip_private"."players" ADD CONSTRAINT "players_friend_code_format" CHECK ("turnip_private"."players"."friend_code" ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$');
