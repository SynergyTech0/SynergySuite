# Synergy Shifts

Shift scheduling, the suite's stand-in for Microsoft Shifts.

- **Week grid.** One row per person, a column per day, and the hours each person is scheduled that week. Shifts are coloured by position and carry a location and notes.
- **Drafts and publishing.** New and changed shifts are drafts that only schedulers see; **Publish** makes the week's drafts visible to everyone.
- **Open shifts** have no one assigned. Anyone on the roster can claim a published one, if it is still free, not in the past, and doesn't overlap a shift they already have.
- **No double booking.** A person can't have two shifts that overlap on the same day.
- **Roster.** Schedulers keep the people they schedule and their positions. A person is matched to their suite account by email, which is how they see "My shifts" and claim open shifts. Someone marked inactive keeps their past shifts but gets no new ones.
- **Schedulers** are `SHIFTS_ADMIN_EMAILS`, else `ADMIN_EMAILS`; with neither set, everyone can schedule.
- **Suite search** (`POST /api/search`) finds shifts by person, position, location and notes; drafts only for schedulers.

Shifts keeps its own roster: HR's people and time off are not available to other apps over the internal network yet.

Port 3930, database `shifts`. Tests run against Postgres when `TEST_DATABASE_URL` is set: `npm test --workspace apps/shifts`.
