# ltc-faucet

Litecoin testnet faucet built on [`@nexusocean/litecoin-rpc`](https://github.com/nexusocean/litecoin-rpc),
Fastify, MongoDB and Nunjucks.

Each claim sends `FAUCET_AMOUNT` tLTC. An IP or address can claim once per
`COOLDOWN_HOURS`: claims are stored in MongoDB with unique indexes on `ip` and
`address`, and a TTL index deletes them when the cooldown ends. The faucet
refuses to start against a mainnet node.

## Tests

`pnpm test` runs unit tests with MongoDB and the RPC client stubbed; they need
neither a node nor a database.
