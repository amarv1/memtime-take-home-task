# Assumptions

## My approach

- I focused on designing the solution with the mechanisms a production system needs, not only on the three screens. That's why it may look complex for a take-home task.
- The API key and the note that this is not a frontend-only task made me conclude that a server is part of what was asked.
- A lot of the complexity was added to improve the system, because the task asks to imagine it will be used by paying customers next week.
- No deployment setup is needed, running locally for checking is enough.

## The solution

- The API_KEY must stay secure.
- Only time entries can be changed. Clients, projects and tasks are read-only.
- Entries are for time already spent, so future times are not allowed.
- A user has at most a few thousand entries, not millions.
- A design should support acceptable UX for normal use, not abuse.
