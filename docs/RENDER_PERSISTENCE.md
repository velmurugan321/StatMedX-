# Persistent Render storage

StatMedX writes its SQLite database and uploaded dataset pickles under the storage root configured by `STATMEDX_STORAGE_DIR`. The default keeps local development files in `backend/` and `backend/data/` as before.

## Render configuration

1. Upgrade the existing API web service from Free to Starter.
2. Attach a 1 GB persistent disk at `/var/data`.
3. Set `STATMEDX_STORAGE_DIR=/var/data`.
4. Set `STATMEDX_ENV=production` and configure `STATMEDX_SECRET` using Render's generated secret option.
5. Deploy and verify that the database file is `/var/data/statmedx.db` and uploaded datasets are under `/var/data/data/`.

The app creates these paths on startup. Both the SQLite database and uploaded files therefore stay on the disk across restarts and deploys. Existing ephemeral data is not automatically migrated to a newly attached disk.

## Cost and tradeoffs

Render's current pricing lists Starter web compute at $7/month and SSD storage at $0.25 per GB-month. A 1 GB disk plus Starter compute is about $7.25/month before bandwidth or other usage. Free web services cannot attach disks. Disk-backed services run a single instance and have a brief interruption during deploys. See [Render pricing](https://render.com/pricing), [free service limitations](https://render.com/docs/free), and [persistent disk behavior](https://render.com/docs/disks).
