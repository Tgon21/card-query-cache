# card-query-cache

Prebuilt MLB The Show marketplace cache for **Card Query**.

`build-cache.js` fetches the public theshow.com card + price data and writes
`cache.json`; the GitHub Action rebuilds it every 6h. The hosted Card Query
server pulls `cache.json` from this repo's raw URL (theshow.com 403s the server's
datacenter IP, so the build runs here instead). Card/price data is public.
