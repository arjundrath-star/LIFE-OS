# WP8: Data load and dry run (Arjun with Fable)

Starts Saturday afternoon or as soon as WP1 and WP2 are merged, on an isolated server if prod is not yet deployed (isolated-server.sh on 3180 with the integration DB copy) and re-run on prod after WP7.

1. Clubs: Arjun marks interested clubs and priorities in the Add-clubs dialog, or sends a list by iMessage or email; the orchestrator applies it through the API or stern-cli. Verify programs and checklists appear with the Fall 2026 windows.
2. People: Arjun provides the people he has met (name, club, role, E-board, contact handles, how met) via the quick-add sheet, iMessage capture, or a private JSON at ~/.openclaw/workspace/stern/data/people.json imported with people.import. Never commit that file.
3. Courses: confirm the four courses, fill professors, times, rooms, syllabus links, grading categories and weights, and the first assignment dates.
4. Google: connect the @stern.nyu.edu account with the stern scope set from the Automation page, then the @nyu.edu account, then personal. Run "Scan now"; review the audit log and suggestions; undo anything wrong; tune thresholds if needed.
5. Live test: Arjun sends one real coffee-chat request email from the Stern account; within one scan the person exists, the chat is Requested, and the touchpoint shows. When the reply arrives, the reply-owed nudge lands on his phone.
6. Memo: npm run stern:memo -- --send-now once; confirm both channels.
7. Photon project for the stern Hermes profile when Arjun has time; switch kv stern.hermes_alias to stern and test capture with "new contact ...".
