# PLANNR

Run PLANNR with Docker. This is a first draft.

## Start

From this directory:

```sh
docker compose up -d --build
```

Open `http://localhost:8080`.

A phone or tablet gets the mobile app. A computer gets the desktop app.

## Your calendars

A new container starts empty. The image does not contain any calendars.

Calendars are stored in the `plannr-data` volume. When you update the image, keep that volume. The calendars already there stay. Remove the volume only when you want an empty calendar again.

```sh
docker compose up -d --build
```

## Published image

Once published, the same container is `ghcr.io/pixelwave/plannr:v1.0`. `:latest` tracks the newest published version. Replace the `build` and `image` lines with:

```yaml
image: ghcr.io/pixelwave/plannr:v1.0
```
