# VP migration

This directory is the imported snapshot of `tarematsu/VP`.

- Source commit: `9984a5db4104019a2537a3018aa7b754f9ad4228`
- Imported into HP as: `video/`
- Video Worker: `videoscraper`
- HomePanel Worker: `homepanel-cloud`
- Workers, D1 databases, queues, assets, bindings, cron schedules, and deployments remain separate.

Original VP workflows are retained under `video/.github/workflows` as migration references. Active monorepo workflows belong under the HP root `.github/workflows/` directory.
