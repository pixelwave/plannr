# PLANNR

Run PLANNR with Docker.

## Arcane

1. Add `https://github.com/pixelwave/plannr.git` as a Git repository. It is public, so no login is required.
2. Create a Pull sync. Set the compose file path to `docker-compose.yml`.
3. Build and deploy that project.

Arcane clones the repository, builds the image, and starts the container. Open `http://<host>:8080`.

A phone or tablet gets the mobile app. A computer gets the desktop app.

## Command line

```sh
docker compose -f docker-compose.yml up -d
```

The compose file builds from this public repository. The image is tagged `plannr:v1.0`.

## Your calendars

A new container starts empty. The image does not contain any calendars.

Calendars are stored in the `plannr-data` volume. When you update the image, keep that volume. The calendars already there stay. Remove the volume only when you want an empty calendar again.
