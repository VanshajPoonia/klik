-- The email that closes the loop, and the record of whether it was sent.
--
-- Until now, activation was silent. A superadmin assigned a plan, `activated_at`
-- was set, the dashboard unlocked, and nobody told the customer. That was
-- survivable while the promise was "about 5 minutes", because the person who had
-- just paid plausibly still had the tab open and would reload it. The promise is
-- now "within 24 hours" (lib/support.ts), so they will have closed the laptop,
-- and an unlocked dashboard nobody is looking at is the same as no dashboard.
--
-- Why this is a column rather than a log line. The most likely support call on
-- this product is "I paid and never heard anything", and answering it needs one
-- fact: did we send, and when. Without somewhere to put that, the superadmin
-- cannot tell "sent, check your spam folder" from "never sent", and the second
-- needs a different action than the first. There is no audit log to put it in
-- yet; that is ROADMAP ADM-4, and this is one timestamp, not a reason to wait.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "activation_email_sent_at" timestamp with time zone;

-- Deliberately NOT backfilled, which is the opposite of what 0013 did with
-- `activated_at` and for the opposite reason. 0013 backfilled because a null
-- there would have locked out every existing organizer, so null had to mean
-- "new". Here null means "we have no evidence this person was ever told", which
-- is the literal truth for every row that exists today: the email being added in
-- this change has never been sent to anybody. Writing now() would be a claim
-- about an email that does not exist yet, and the /admin panel reads this column
-- to decide whether to offer the send button.
