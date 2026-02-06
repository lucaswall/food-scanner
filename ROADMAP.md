# Food Scanner - Roadmap

Future features and improvements to tackle after the current foundation is stable.

---

## 1. Re-prompting for Nutrition Editing

### Problem

The current nutrition editing UI (manual number fields) is not useful — the user has no idea whether the AI's calorie estimate is right. Asking someone to manually adjust protein from 12g to 15g is asking them to be a nutritionist.

### Approach

Replace manual number editing with **natural language re-prompting**. The user provides a clarification and Claude does a second pass to adjust the analysis:

- "the glass is 0.5L not 300ml"
- "there are 3 eggs not 2"
- "it also has cheese on top"
- "it's a small portion, about half"

The re-prompt is sent to Claude along with the original image(s), the original analysis, and the user's correction. Claude returns an updated analysis that replaces the previous one. The user can re-prompt multiple times until satisfied.

### UI

The confirmation screen gets a text input field with placeholder text like "Correct something..." and a send button. Submitting triggers a new Claude call and replaces the displayed analysis. The original image(s) and description are preserved across re-prompts.

### Implementation Order

1. Add re-prompt API endpoint (accepts original analysis + correction text + original images)
2. Update Claude prompt to handle correction context
3. Add re-prompt input to confirmation UI
4. Track re-prompt count for analytics (optional)

---

## 2. Food Table Maintenance

_Lower priority — address when the `custom_foods` table grows large enough to affect matching performance or usability._

### Problem

Over months of daily use, `custom_foods` accumulates entries. Some are near-duplicates (the user chose "Log as new" for a slightly different version of a food they've logged before). Others are one-off foods never logged again.

### Potential Approaches

- **Unused food cleanup:** Periodically delete `custom_foods` entries that have no associated `food_log_entries` and are older than N days. These were created but never successfully logged (failed Fitbit calls, abandoned sessions).
- **Staleness archival:** Soft-delete or archive foods not logged in 6+ months so they stop appearing in match candidates. Unarchive automatically if the user logs a matching food again.
- **Duplicate merging:** When two custom foods have very high keyword overlap (>= 0.8) and pass nutrient tolerance, offer to merge them into one. The merged food keeps the most recent nutritional values and the union of all keywords.

### Notes

- The `custom_foods` table is scoped to a single user, so growth is bounded by one person's eating habits. Even logging 10 foods/day for a year is ~3,650 rows — likely not a performance concern for a long time.
- Matching queries can be optimized with a GIN index on the keywords column if needed.

---

## 3. Fitbit API Rate Limit Handling

_Lower priority — address when rate limiting becomes a practical issue._

### Problem

Fitbit enforces a **150 requests/hour** rate limit per user. Each food log currently requires up to 3 API calls: search (optional), create food, create log entry. With smart matching reducing food creation calls, the effective cost drops to 1-2 calls per log. Still, rapid logging (catching up on a full day, meal prep) could hit the limit.

### Potential Approaches

- **Rate tracking:** Store Fitbit API call timestamps in memory (or DB). Before each call, check remaining budget in the current hour window.
- **Graceful degradation:** When approaching the limit (e.g., < 10 remaining), show a warning banner: "Fitbit rate limit approaching — logs will be queued." When at 0, queue food logs locally and retry automatically when the window resets.
- **Queue with retry:** Failed-due-to-rate-limit logs are saved as pending `food_log_entries` (with `fitbit_log_id = NULL`) and retried on next app open or via a background check.
- **Fitbit response headers:** Fitbit returns `Fitbit-Rate-Limit-Remaining` and `Fitbit-Rate-Limit-Reset` headers. Use these directly instead of tracking calls manually.

### Notes

- For a single user logging 5-15 foods/day, rate limiting is unlikely to be a real problem. This is a safety net, not a core feature.
- The smart matching feature (section 1) is the best mitigation — reusing existing foods cuts API calls roughly in half for repeated foods.
