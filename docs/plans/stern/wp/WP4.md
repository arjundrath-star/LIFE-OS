# WP4: Tasks, Classes, Career (Codex)

Goal: the unified task list, the Google-Classroom-style classes area with a grade book, and the Career sub-tab that hosts the existing endeavors read-mostly. Runs in parallel with WP3; do not edit lib/stern/apply.ts, gmail-scan.ts, or lib/sources/google.

## Tasks
- Data: stern_tasks (0029). Domain lib/stern/tasks.ts: createTask (dedupe_key optional; auto sources must pass one), updateTask (EDITABLE allowlist), complete, reopen, drop, listTasks(filters: domain[], status, due bucket today|week|later|none, linked entity), groupForUi(), tasksSnapshot() (due today, overdue, per domain counts). Audit rows for every write. Linked entity labels resolved in SQL joins (course code, club name, person display_name).
- Migration db/migrations/0031_stern_todos_migrate.sql: copy rows from the legacy todos table into stern_tasks (domain professional, source seed, dedupe_key "legacy-todo:<id>"), idempotent.
- API app/api/stern/tasks/route.ts: GET snapshot and list; POST task.create, task.update, task.complete, task.reopen, task.drop. Broadcast "stern".
- UI app/stern/tasks/page.tsx -> components/stern/tasks/TasksView.tsx exactly per the design brief (domain chips, Due grouping, TaskRows with linked chips, priority dot, SourceBadge, inline composer, "Done today" collapsed). testids stern-tasks-view, stern-task-row, stern-task-composer.

## Classes
- Data: courses, course_meetings, grade_categories, assignments (0029). Domain lib/stern/classes.ts: course CRUD, meetings CRUD, categories CRUD (weights validated to sum <= 100), assignment CRUD with dedupe_key = lower(code)+":"+normalized title, upsertAssignmentFromEmail(courseCode, {title, kind, dueAt, points}) used by WP3 (export it; if WP3 wrote a temporary helper in apply.ts the orchestrator swaps it at merge), computeStanding(courseId): weighted percentage over graded categories with earned/possible, plus an unweighted fallback; nextMeeting(now) and weeklySchedule() in America/New_York; classesSnapshot() (next class, due soon, standings).
- Seed scripts/seed-stern-courses.ts reading docs/plans/stern/seeds/courses-fall-2026.json (create this file with the four Fall 2026 courses: STAT-UB 103 Statistics and Regression; TECH-UB 1 Information Technology in Business and Society; MKTG-UB 1 Introduction to Marketing, section 006, Prof. Raluca Ursu, MW 14:00 to 15:15, Tisch UC04; CAMS-UA 110 Science of Happiness, Tue/Thu 09:30 to 10:45 plus Fri 15:45 recitation, Tisch UC50; 4 credits each; leave unknown professors, rooms, and times blank, never invent). Idempotent by (code, term). npm run seed:stern-courses.
- API app/api/stern/classes/route.ts: GET snapshot, GET ?course=<id>; POST course.upsert, meeting.upsert, meeting.remove, category.upsert, category.remove, assignment.create, assignment.update, assignment.set_status, assignment.grade. Broadcast "stern".
- UI app/stern/classes/page.tsx -> ClassesIndex (weekly schedule strip Mon to Fri with class blocks and room codes in mono, four CourseCards per the brief) and app/stern/classes/[courseId]/page.tsx -> CourseDetail (CourseHeader with links; tabs Assignments, Exams, Grades, Notes; AssignmentRows grouped by status with type chip, due mono, points, SourceBadge; GradeBookTable with weights, earned, computed standing, and the curve note from grading_notes). Add/edit dialogs for assignments and categories. testids stern-classes-index, stern-course-card, stern-course-detail, stern-assignment-row, stern-gradebook.

## Career sub-tab
- app/stern/career/page.tsx renders the existing components/career/CareerWorkspace.tsx inside SternPage with a header note chip "Dormant until club season ends". Verify it reads correctly under .stern-mode (add remaps in the .stern-mode CSS scope only if a class is unreadable; do not fork the component). No changes to lib/career.ts, the career API, or its scheduler ticks.

## Tests
tests/stern-tasks.test.ts (dedupe, buckets in EDT, legacy migration idempotent, audit), tests/stern-classes.test.ts (standing math with partial grades, weights validation, upsertAssignmentFromEmail dedupe and update, nextMeeting across week boundary, seed idempotent).

## Acceptance checklist
- [ ] Tasks view and API complete; legacy todos migrated once.
- [ ] Classes index, course detail, grade book, seeds, and email upsert helper complete; standing math tested.
- [ ] Career page renders the existing workspace in the light theme without forking it.
- [ ] Gate PASS; report; committed.
