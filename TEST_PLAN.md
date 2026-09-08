# TEST_PLAN — SIH Copilot

Practical verification, not a formal QA process. Each item should be checkable manually or with a small script.

## DOM extraction
- On the live portal, verify all expected columns (PS ID, title, organization, category, theme) are captured for a sample of rows, including edge cases (long titles, missing organization field, special characters).
- Verify extraction still works if the table is sorted, filtered, or paginated via the portal's own UI.
- Confirm the sanity check correctly warns when extraction returns zero or abnormally few rows (simulate by testing against a saved/modified copy of the page).
- If the table loads asynchronously, confirm the `MutationObserver`/retry logic reliably catches the populated table rather than reading it empty.

## Persistent storage
- Set a status/note on a PS, close the browser fully, reopen later, and confirm the status/note persists.
- Confirm status/notes survive an extension update (new version loaded via "Load unpacked" or a store update) without being wiped.
- If using `chrome.storage.sync`, confirm data appears on a second device signed into the same Chrome account, and that note length doesn't hit the per-item quota unexpectedly.

## Historical detection
- Verify the extension correctly fetches and caches the static historical dataset, and does not refetch on every single page load.
- Spot-check a handful of known-similar PS pairs across years and confirm the similarity score is reasonably high; check a handful of clearly unrelated PS pairs and confirm the score is low.
- Confirm the UI only surfaces similarity flags above the defined threshold, not noise from marginal scores.

## Team-fit scoring
- Verify the score changes predictably when the skill matrix is edited.
- Confirm a PS with no matching domain/theme against the skill matrix produces a low, not misleadingly high, score.

## Extension packaging and permissions
- Confirm `host_permissions` in the manifest are scoped only to the SIH portal domain.
- Confirm the extension requests no permissions beyond what's actually used (storage, the scoped host permission).
- Load unpacked and manually walk through the full workflow: browse → tag status → filter → view similarity → view fit score → add note.

## Chrome Web Store readiness
- Confirm the privacy practices disclosure accurately reflects that user data stays local and only the non-personal static dataset is fetched.
- Confirm icon and screenshot assets meet size requirements before submission.
- Do a final check of the SIH portal's terms of use for automated data access before submitting publicly.
