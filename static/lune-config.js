/* Lune site settings.
 *
 * Accounts: create a free project at https://supabase.com, run
 * supabase/schema.sql in its SQL editor, then paste the project's URL and
 * "anon public" key below (Project Settings → API). The anon key is meant to
 * be public — row-level security keeps every account's data private.
 * Leave both empty and Lune keeps everything in the visitor's own browser.
 */
window.LUNE_CONFIG = {
  supabaseUrl: "https://ggxbkynudklihxovqedv.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdneGJreW51ZGtsaWh4b3ZxZWR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEwMTI3ODEsImV4cCI6MjEwNjU4ODc4MX0.aBrUJsPWU1iz2Z7DVCqDrLIW1R0YV6PZ7OKdmgm4xLE",
  /** Owner-only stats (user count). Must match the signed-in email. */
  ownerEmail: "verushkapatel@icloud.com",
  /** Inbox for replies / feedback (also used as mailto on the site). */
  feedbackEmail: "info@lune.page",
  /** Form-to-email relay for the Feedback form: answers are posted to
   *  <relay><feedbackEmail> and arrive as an email. Empty string turns it off. */
  feedbackRelay: "https://formsubmit.co/ajax/",
  /** Lune AI for account holders: the address of the Cloudflare Worker in
   *  workers/lune-ai. scripts/deploy_lune_ai.sh fills it in. Empty = off. */
  aiServer: "https://lune-ai.verushkapatel4.workers.dev",
  aiModelName: "Llama 3.1 8B Instruct",
  /** Auth / OTP sender identity (Supabase SMTP From). */
  authEmail: "login@lune.page",
};
