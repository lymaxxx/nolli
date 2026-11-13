# Project fixtures

- `macos-v7.json` was generated on macOS with the repository's native `Codable` model definitions and an unconfigured Swift `JSONEncoder`. Its ids, names and coordinates are fabricated.
- `macos-v6-sparse.json` was derived from that fixture by setting version 6 and removing fields. It exercises shallow default filling, the v7 margin migration, generated sign/sub-layer ids and optional manual-edit dictionaries. It is not presented as a file written by a historical app release.

Neither file contains user project data. During implementation, both web-saved outputs were also decoded successfully as version 7 projects by the native Swift `JSONDecoder`; that macOS-only check is not part of the Linux web CI job.

M1 was also closed against a real version 6 `.mapcraft` project supplied by a user: it loaded, saved and re-opened, and the native Swift decoder accepted the web-saved `.nolli`. That project is not committed. Real user projects must remain untracked as required by the root `.gitignore`.
