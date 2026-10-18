# Synergy Learn

Courses, lessons and quizzes, assigned training and certificates (the suite's Viva Learning). Port 3950.

- **Catalog:** published courses by category. Anyone signed in can add a course to My learning.
- **Lessons:** reading or video (a link to Stream, Drive or any https address; video files play in the page), in order. A lesson can end in a multiple-choice quiz; passing it (`LEARN_PASS_MARK`, default 70%) completes the lesson. Learners never receive the right answers.
- **My learning:** each course's progress, due date and who assigned it, with overdue courses flagged.
- **Assigning:** authors assign a course to a list of people with an optional due date and follow each person's progress on the course's People tab.
- **Certificates:** finishing every lesson unlocks a printable certificate.
- **Search:** suite search finds published courses and lessons (every course for authors).

## Who does what

- Authors (`LEARN_AUTHOR_EMAILS`, default `ADMIN_EMAILS`) write courses, publish them and assign them.
- Everyone signed in can take published courses. Drafts can't be opened, taken or found by learners.
- People can leave a course they chose themselves; an assigned course can only be removed by an author.

## Settings

| Variable | Meaning |
| --- | --- |
| `LEARN_AUTHOR_EMAILS` | Course authors, comma-separated (default `ADMIN_EMAILS`; the older `LEARN_AUTHORS` still works). |
| `LEARN_PASS_MARK` | Quiz pass mark in percent (default 70). |
| `LEARN_ORG_NAME` | Organization name printed on certificates (optional). |
