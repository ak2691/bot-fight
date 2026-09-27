# Frontend asset deployment

The repository's frontend container serves `index.html` with `no-store, no-cache,
must-revalidate` and serves content-hashed files with a one-year immutable cache
policy. Other non-hashed files are revalidated rather than cached indefinitely.

If production serves the frontend through a CDN, object store, or separate web
server, configure that layer to apply the same policies. Deploy new hashed assets
before publishing the matching `index.html`, and retain prior hashed assets for
at least the maximum expected lifetime of open browser tabs and cached documents.
The application repository cannot retain old assets in external deployment
infrastructure; that retention must be configured by the production deployment.
