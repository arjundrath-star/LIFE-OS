# WP7: Hardening, review, deploy (Fable)

Goal: ship to production safely with no human in the loop except reading the email.

1. Integration gate on feature/stern-tab: gate.sh PASS; migrations applied twice on a fresh .backup of the CURRENT prod DB (not the Sept 4 copy) to catch drift; npm test green.
2. Security review (ultracode workflow, four reviewers plus verify) against: every /api/stern* route behind requireUser; no new public paths in middleware; classifier input is untrusted (prompt via file, schema-only output, sandbox read-only, tmp cwd, no tools, timeout); allowlisted state transitions only; audit and undo cannot be forged from the client (batch ids server-generated); stern-cli only local; Hermes capture allowed users limited to Arjun's number; scope sets minimal; secrets never logged; export endpoints gated; vault-write confined to Stern/. Fix every high and medium finding before deploy.
3. Code review (ultracode) for correctness and the four SQLite gotchas; fix.
4. E2E: gate build, isolated-server.sh start on 3190 with a fresh prod copy, mint a cookie, curl every Stern route for 200, puppeteer screenshots of every screen at 1440x900 and 390 wide into docs/plans/stern/reports/screenshots/ (no personal data in the DB copy yet, so placeholders are fine), stop the server.
5. Backup job: scripts/stern-backup.sh doing sqlite3 .backup of the prod DB into /home/Arjun/stern-build/db/backups/rathworkspace-<date>.db nightly with 14-day retention, installed as a user crontab entry at 03:30 with the ( cd "$REPO" && ... ) pattern; first run verified.
6. Deploy (the only time prod is touched): backup prod DB; in /home/Arjun/rathworkspace: git merge feature/stern-tab into main (no force); append the Stern @stern.nyu.edu account to the allowlist in ~/.config/rathworkspace/secrets.env (keep every existing entry); npm run migrate; npx next build; sudo systemctl restart rathworkspace.service; verify with the minted cookie that /stern returns 200 and /api/stern returns JSON; tail the journal for 2 minutes for errors; confirm the scheduler logged tickStern, tickSternEmail (skipped gracefully with no NYU accounts connected), and tickSternReminders. If anything fails: git checkout main@{1}, rebuild, restart, email "deploy rolled back" with the log.
7. Push feature/stern-tab and main to origin (public repo: code only; verify git status shows no data files).
8. Email "Stern tab is live" with: URL, what works now, what waits on Arjun (Google connect steps with the exact links, Photon steps, design bundle, data load), and the screenshot list. Update PROGRESS.md.

## Acceptance checklist
- [ ] Reviews done, findings fixed, e2e screenshots saved, backup cron installed and verified.
- [ ] Prod on main with 0029+ applied, service healthy, /stern 200, no journal errors.
- [ ] Pushed; final email sent; PROGRESS.md complete.
