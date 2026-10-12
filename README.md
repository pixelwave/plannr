# PLANNR

Run PLANNR with Docker.

## Arcane

1. Add `https://github.com/pixelwave/plannr.git` as a Git repository. It is public, so no login is required.
2. Create a Pull sync on branch `main`. Set the compose file path to `docker-compose.yml`. Leave Sync Files off.
3. Deploy the project.

Arcane pulls `ghcr.io/pixelwave/plannr:latest` and starts the container. Open `http://<host>:8080`.

A phone or tablet gets the mobile app. A computer gets the desktop app.

## Command line

```sh
docker compose -f docker-compose.yml up -d
```

The compose file pulls `ghcr.io/pixelwave/plannr:latest`. That tag tracks the newest release. This release is also `ghcr.io/pixelwave/plannr:v1.0`. The container listens on port 8080.

## Your calendars

A new container starts empty. The image does not contain any calendars.

Calendars are stored in the `plannr-data` volume. When you update the image, keep that volume. The calendars already there stay. Remove the volume only when you want an empty calendar again.

## Version history

Newer releases are added above. Each one is also published on the Releases page.

### v1.0

- First public release. The image is `ghcr.io/pixelwave/plannr:v1.0`, and `latest` points at it.
- One address serves both apps. A computer gets the desktop year view. A phone or tablet gets the mobile app.
- Desktop focus is month, week, or day, with Center and Today. Content zoom, theme, undo, and redo are included.
- Projects can be created, browsed, imported, and exported as `.plannr` files. The calendar range can be edited.
- A new container starts with an empty calendar named Unnamed Calendar, covering this year and the next, opened at month zoom on today.
- Calendars stay in the `plannr-data` volume when the image is updated.
- The mobile app shows what is in motion now, and can open the desktop app.

## License

PLANNR is free software under the GNU Affero General Public License,
version 3 only. See `LICENSE` and `COPYRIGHT`.

You can download it and run it for yourself, and a company can run it
for its own planning. If you modify PLANNR and let other people use that
modified version over a network, the AGPL requires you to offer them the
corresponding source.

A calendar you export, including a `.plannr` file, is your data. The
license applies to the program, not to your calendars.

The corresponding source for an official container tag is the git tag
that built it.

Contributions are welcome under `CLA.md`. See `CONTRIBUTING.md`.

