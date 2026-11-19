# SupaDashboard plugins

Plugins for [SupaDashboard](https://github.com/McFck/SupaDashboard), built and signed by CI and published to the
in-app Market.

| Folder                 | Plugin                     |
| ---------------------- | -------------------------- |
| `plugins/discord`      | Discord                    |
| `plugins/haptics`      | Android compatibility      |
| `plugins/spotify`      | Spotify                    |
| `plugins/subway`       | Subway                     |
| `plugins/webcompanion` | SupaDashboard WebCompanion |

Each plugin folder holds `plugin.json` (manifest), `market.json` (Market listing), `guide.md` (user guide) and
`ui/src` (the plugin code, written against `@supadashboard/kit`).

## Develop

The `supadashboard` submodule provides the plugin kit.

```sh
git submodule update --init
pnpm install
pnpm check
pnpm test
pnpm build        # stages every plugin in dist/<id>
```

A push to `main` that changes `plugins/**` releases every plugin whose version has no release tag yet.

## Licence

GPL-3.0-or-later, see [LICENSE](LICENSE).
