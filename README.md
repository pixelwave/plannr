# PLANNR

Run PLANNR with Docker.

## Arcane

1. Add `https://github.com/pixelwave/plannr.git` as a Git repository. It is public, so no login is required.
2. Create a Pull sync on branch `main`. Set the compose file path to `docker-compose.yml`. Leave Sync Files off.
3. Open the project and choose Build & Deploy.

There is no registry image yet. Build & Deploy builds this repository and starts the container. Open `http://<host>:8080`.

A phone or tablet gets the mobile app. A computer gets the desktop app.

## Command line

```sh
docker compose -f docker-compose.yml up -d --build
```

The compose file builds from `https://github.com/pixelwave/plannr.git#main` and tags the image `plannr:v1.0`. The container listens on port 8080.

## Your calendars

A new container starts empty. The image does not contain any calendars.

Calendars are stored in the `plannr-data` volume. When you update the image, keep that volume. The calendars already there stay. Remove the volume only when you want an empty calendar again.
