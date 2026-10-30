# Improvements

The biggest things I would do next, grouped by area, most important first.

## Solution design

### 1. Move all state to Redis

Today sessions, caches, the rate-limit budget and sign-in limits live in the memory of one server. I would move them, together with a queue, to Redis. The server then keeps no state of its own, so it can restart without signing anyone out and can run as many copies as needed behind a load balancer. API keys would be stored encrypted.

### 2. Suggest changes to the Memtime API

A few additions on Memtime's side would remove most of the workarounds in this solution:

- Filter time entries by task, date range and last change.
- Tell us when an entry changes, by sending an event to a webhook or by providing a change feed.
- Look up a task's client and project in one call.
- A higher or per-user rate limit.
- Leave the API key out of task responses.

With these, much of the caching, syncing and rate-limit handling could be deleted, and data changed outside the app would show up right away.

### 3. Load data in the background

Today a page view can wait while the server loads data from Memtime. I would move that loading into background workers that take jobs from the Redis queue and keep the data fresh using the spare rate limit. Requests would then only read from Redis, so pages stay fast even for big accounts.

## UI/UX

### 1. Find tasks faster

In big accounts a task can be several pages deep. A search box, recently used tasks, and links that open a deep task directly would save a lot of scrolling.

### 2. Show progress on long loads

The first load of a big account takes a while because of the rate limit, and the user mostly sees a countdown. Showing how much is loaded and what comes next would make the wait feel shorter and clearer.
