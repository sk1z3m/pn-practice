-- Players can opt out of leaderboards; lb_prompted records that the explainer window has been shown
ALTER TABLE players ADD COLUMN leaderboard_opt_out INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN lb_prompted INTEGER NOT NULL DEFAULT 0;
